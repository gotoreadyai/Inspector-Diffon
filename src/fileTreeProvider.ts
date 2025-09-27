// path: src/fileTreeProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';

// Typ dla elementu - może być folder lub plik  
type TreeElement = FolderItem | FileItem;

export class FolderItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string
  ) {}
}

export class FileItem {
  constructor(
    public readonly resourceUri: vscode.Uri
  ) {}
}

interface FolderStructure {
  folders: Map<string, FolderStructure>;
  files: FileItem[];
}

export class LLMFileTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private fileItems: Map<string, FileItem> = new Map();
  private rootStructure: FolderStructure = { folders: new Map(), files: [] };
  private globPattern: string = 'src/**/*.{ts,tsx,js,jsx}';
  private savedSets: Map<string, string[]> = new Map();
  private context: vscode.ExtensionContext | undefined;
  
  // Trzymamy referencję do TreeView
  private treeView: vscode.TreeView<TreeElement> | undefined;
  
  // Własny stan zaznaczenia - bo VSCode selection jest read-only
  private selectedPaths: Set<string> = new Set();

  constructor(
    private workspaceRoot: string,
    context?: vscode.ExtensionContext
  ) {
    this.context = context;
    this.loadSavedSets();
    this.loadFiles();
    
    // Watcher na zmiany plików - automatyczny refresh
    const watcher = vscode.workspace.createFileSystemWatcher(this.globPattern);
    watcher.onDidCreate(() => this.loadFiles());
    watcher.onDidDelete(() => this.loadFiles());
    watcher.onDidChange(() => this.loadFiles());
    
    if (context) {
      context.subscriptions.push(watcher);
    }
  }

  // Ustawiamy TreeView po utworzeniu
  setTreeView(treeView: vscode.TreeView<TreeElement>) {
    this.treeView = treeView;
  }

  async refresh(): Promise<void> { 
    await this.loadFiles(); // Przeładuj listę plików i poczekaj
  }

  async setGlobPattern(pattern: string) {
    this.globPattern = pattern;
    await this.loadFiles();
    this.refresh();
    vscode.window.setStatusBarMessage(`Wzorzec ustawiony: ${pattern}`, 2000);
  }

  private async loadFiles() {
    try {
      const files = await vscode.workspace.findFiles(
        this.globPattern,
        '**/{node_modules,dist,.next,.git,build,out,coverage}/**',
        1000
      );

      // Zachowaj obecne zaznaczenia dla plików które nadal istnieją
      const oldSelection = new Set(this.selectedPaths);
      this.selectedPaths.clear();

      this.fileItems.clear();
      this.rootStructure = { folders: new Map(), files: [] };

      files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

      for (const file of files) {
        const item = new FileItem(file);
        this.fileItems.set(file.fsPath, item);

        // Przywróć zaznaczenie jeśli plik był wcześniej zaznaczony
        if (oldSelection.has(file.fsPath)) {
          this.selectedPaths.add(file.fsPath);
        }

        const relativePath = vscode.workspace.asRelativePath(file);
        const parts = relativePath.split(path.sep);

        let currentStructure = this.rootStructure;

        for (let i = 0; i < parts.length - 1; i++) {
          const folderName = parts[i];
          if (!currentStructure.folders.has(folderName)) {
            currentStructure.folders.set(folderName, { folders: new Map(), files: [] });
          }
          const nextStructure = currentStructure.folders.get(folderName);
          if (!nextStructure) continue;
          currentStructure = nextStructure;
        }

        currentStructure.files.push(item);
      }

      vscode.window.setStatusBarMessage(`Znaleziono ${files.length} plików`, 2000);
      
      // WAŻNE: Odśwież TreeView po załadowaniu plików
      this._onDidChangeTreeData.fire();
      
    } catch (error: any) {
      vscode.window.showErrorMessage(`Błąd ładowania plików: ${error?.message ?? String(error)}`);
    }
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element instanceof FolderItem) {
      const item = new vscode.TreeItem(element.folderName, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `folder:${element.folderPath}`;
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = 'folder';
      item.tooltip = element.folderPath;
      // Folder nie ma komendy - tylko rozwija/zwija się
      return item;
    } else {
      const item = new vscode.TreeItem(element.resourceUri);
      item.id = `file:${element.resourceUri.fsPath}`;
      
      // Dodajemy zieloną kropkę na końcu nazwy jeśli plik jest zaznaczony
      const fileName = path.basename(element.resourceUri.fsPath);
      const isSelected = this.selectedPaths.has(element.resourceUri.fsPath);
      item.label = isSelected ? `${fileName} 🟢` : fileName;
      
      item.tooltip = vscode.workspace.asRelativePath(element.resourceUri);
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = isSelected ? 'fileSelected' : 'file';
      
      // Komenda do toggle pojedynczego pliku
      item.command = {
        command: 'llmDiff.onItemClicked',
        title: 'Toggle selection',
        arguments: [element.resourceUri.fsPath]
      };
      
      return item;
    }
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!this.workspaceRoot) return [];

    if (!element) {
      if (this.fileItems.size === 0) { 
        await this.loadFiles(); 
      }
      const result: TreeElement[] = [];
      this.rootStructure.folders.forEach((_s, folderName) => {
        result.push(new FolderItem(folderName, folderName));
      });
      result.push(...this.rootStructure.files);
      return result;
    }

    if (element instanceof FolderItem) {
      const parts = element.folderPath.split(path.sep);
      let currentStructure = this.rootStructure;
      for (const part of parts) {
        const nextStructure = currentStructure.folders.get(part);
        if (!nextStructure) return [];
        currentStructure = nextStructure;
      }

      const result: TreeElement[] = [];
      currentStructure.folders.forEach((_s, folderName) => {
        const fullPath = path.join(element.folderPath, folderName);
        result.push(new FolderItem(folderName, fullPath));
      });
      result.push(...currentStructure.files);
      return result;
    }

    return [];
  }

  // METODY SELECTION - używamy własnego stanu bo VSCode.selection jest read-only

  selectAll() {
    // Zaznaczamy wszystkie pliki w naszym stanie
    this.fileItems.forEach((item, path) => {
      this.selectedPaths.add(path);
    });
    
    vscode.window.showInformationMessage(`Zaznaczono wszystkie ${this.fileItems.size} pliki.`);
    this.refresh(); // Odświeżamy drzewo żeby pokazać zmiany
    this.notifySelectionChanged();
  }

  deselectAll() {
    // Czyścimy nasz stan
    this.selectedPaths.clear();
    
    vscode.window.showInformationMessage('Odznaczono wszystkie pliki.');
    this.refresh();
    this.notifySelectionChanged();
  }

  selectFolder(folderPath: string) {
    const folderFiles: string[] = [];
    
    this.fileItems.forEach((item, filePath) => {
      const relativePath = vscode.workspace.asRelativePath(filePath);
      const inFolder =
        relativePath.startsWith(folderPath + path.sep) ||
        path.dirname(relativePath) === folderPath;

      if (inFolder) {
        folderFiles.push(filePath);
      }
    });

    if (folderFiles.length === 0) {
      vscode.window.showInformationMessage(`Brak plików w folderze „${folderPath}".`);
      return;
    }

    // Sprawdzamy czy jakieś pliki z tego folderu są już zaznaczone
    const selectedInFolder = folderFiles.filter(f => this.selectedPaths.has(f));
    
    // Toggle logic: jeśli nie wszystkie są zaznaczone → zaznacz wszystkie
    const shouldSelect = selectedInFolder.length < folderFiles.length;
    
    if (shouldSelect) {
      // Dodajemy pliki z folderu
      folderFiles.forEach(f => this.selectedPaths.add(f));
    } else {
      // Usuwamy pliki z folderu
      folderFiles.forEach(f => this.selectedPaths.delete(f));
    }
    
    vscode.window.setStatusBarMessage(
      shouldSelect
        ? `Zaznaczono ${folderFiles.length} plików w „${folderPath}".`
        : `Odznaczono ${folderFiles.length} plików w „${folderPath}".`,
      1500
    );
    
    this.refresh();
    this.notifySelectionChanged();
  }

  toggleFileSelection(filePath: string) {
    if (this.selectedPaths.has(filePath)) {
      this.selectedPaths.delete(filePath);
    } else {
      this.selectedPaths.add(filePath);
    }
    this.refresh();
    this.notifySelectionChanged();
  }

  getSelectedFiles(): vscode.Uri[] {
    // Połączenie: własny stan + natywna selekcja z TreeView (jeśli używamy canSelectMany)
    const fromState = Array.from(this.selectedPaths)
      .map(path => this.fileItems.get(path))
      .filter(item => item !== undefined)
      .map(item => item!.resourceUri);
    
    // Jeśli mamy TreeView z natywną selekcją, łączymy oba źródła
    if (this.treeView) {
      const fromTreeView = (this.treeView.selection as FileItem[])
        .filter(item => item instanceof FileItem)
        .map(item => item.resourceUri);
      
      // Deduplikacja - łączymy oba źródła
      const combined = new Map<string, vscode.Uri>();
      [...fromState, ...fromTreeView].forEach(uri => {
        combined.set(uri.fsPath, uri);
      });
      return Array.from(combined.values());
    }
    
    return fromState;
  }

  private notifySelectionChanged() {
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  // ZARZĄDZANIE ZESTAWAMI

  saveCurrentSet(name: string) {
    const selected = this.getSelectedFiles().map(uri => uri.fsPath);
    if (selected.length === 0) {
      vscode.window.showWarningMessage('Brak zaznaczonych plików do zapisania.');
      return;
    }
    this.savedSets.set(name, selected);
    this.persistSavedSets();
    vscode.window.showInformationMessage(`Zapisano zestaw „${name}" (${selected.length} plików).`);
  }

  loadSet(name: string) {
    const paths = this.savedSets.get(name);
    if (!paths) {
      vscode.window.showErrorMessage(`Nie znaleziono zestawu: ${name}`);
      return;
    }
    
    // Czyścimy obecną selekcję i ładujemy zestaw
    this.selectedPaths.clear();
    let loadedCount = 0;
    
    paths.forEach(filePath => {
      if (this.fileItems.has(filePath)) {
        this.selectedPaths.add(filePath);
        loadedCount++;
      }
    });
    
    this.refresh();
    vscode.window.showInformationMessage(`Wczytano zestaw „${name}" (${loadedCount}/${paths.length} plików).`);
    this.notifySelectionChanged();
  }

  getSavedSets(): string[] { 
    return Array.from(this.savedSets.keys()); 
  }

  private persistSavedSets() {
    if (this.context) {
      const data = Array.from(this.savedSets.entries());
      this.context.workspaceState.update('llmDiff.savedSets', data);
    }
  }

  private loadSavedSets() {
    if (this.context) {
      const saved = this.context.workspaceState.get('llmDiff.savedSets') as [string, string[]][] | undefined;
      if (saved) { 
        this.savedSets = new Map(saved); 
      }
    }
  }
}