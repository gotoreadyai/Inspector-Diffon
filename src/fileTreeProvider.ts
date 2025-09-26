import * as vscode from 'vscode';
import * as path from 'path';

// Typ dla elementu - może być folder lub plik
type TreeElement = FolderItem | FileItem;

export class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(folderName, collapsibleState);
    
    this.iconPath = vscode.ThemeIcon.Folder;
    this.contextValue = 'folder';
    this.tooltip = folderPath;
  }
}

export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public isSelected: boolean = false
  ) {
    super(resourceUri, collapsibleState);
    
    const fileName = path.basename(resourceUri.fsPath);
    this.label = fileName;
    this.tooltip = vscode.workspace.asRelativePath(resourceUri);
    
    // Checkbox jako ikona
    this.iconPath = new vscode.ThemeIcon(
      isSelected ? 'pass-filled' : 'circle-outline'
    );
    
    // Komenda przy kliknięciu
    this.command = {
      command: 'llmDiff.onItemClicked',
      title: 'Toggle',
      arguments: [this]
    };
    
    this.contextValue = isSelected ? 'fileSelected' : 'fileUnselected';
  }

  toggleSelection() {
    this.isSelected = !this.isSelected;
    this.iconPath = new vscode.ThemeIcon(
      this.isSelected ? 'pass-filled' : 'circle-outline'
    );
    this.contextValue = this.isSelected ? 'fileSelected' : 'fileUnselected';
  }
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

  constructor(
    private workspaceRoot: string,
    context?: vscode.ExtensionContext
  ) {
    this.context = context;
    this.loadSavedSets();
    this.loadFiles();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async setGlobPattern(pattern: string) {
    this.globPattern = pattern;
    await this.loadFiles();
    this.refresh();
    vscode.window.showInformationMessage(`Wzorzec ustawiony: ${pattern}`);
  }

  private async loadFiles() {
    try {
      const files = await vscode.workspace.findFiles(
        this.globPattern,
        '**/{node_modules,dist,.next,.git,build,out,coverage}/**',
        500
      );
      
      this.fileItems.clear();
      this.rootStructure = { folders: new Map(), files: [] };
      
      // Sortuj pliki według ścieżki
      files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
      
      for (const file of files) {
        const item = new FileItem(file, vscode.TreeItemCollapsibleState.None);
        this.fileItems.set(file.fsPath, item);
        
        // Dodaj do struktury drzewa
        const relativePath = vscode.workspace.asRelativePath(file);
        const parts = relativePath.split(path.sep);
        
        let currentStructure = this.rootStructure;
        
        // Nawiguj/twórz strukturę folderów
        for (let i = 0; i < parts.length - 1; i++) {
          const folderName = parts[i];
          
          if (!currentStructure.folders.has(folderName)) {
            currentStructure.folders.set(folderName, {
              folders: new Map(),
              files: []
            });
          }
          
          const nextStructure = currentStructure.folders.get(folderName);
          if (!nextStructure) {
            // To nie powinno się zdarzyć, ale TypeScript tego nie wie
            continue;
          }
          currentStructure = nextStructure;
        }
        
        // Dodaj plik do odpowiedniego folderu
        currentStructure.files.push(item);
      }
      
      vscode.window.showInformationMessage(`Znaleziono ${files.length} plików`);
    } catch (error) {
      vscode.window.showErrorMessage(`Błąd ładowania plików: ${error}`);
    }
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    // Root level
    if (!element) {
      if (this.fileItems.size === 0) {
        await this.loadFiles();
      }
      
      const result: TreeElement[] = [];
      
      // Dodaj foldery z roota
      this.rootStructure.folders.forEach((structure, folderName) => {
        result.push(new FolderItem(
          folderName,
          folderName,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      });
      
      // Dodaj pliki z roota
      result.push(...this.rootStructure.files);
      
      return result;
    }
    
    // Jeśli element to folder
    if (element instanceof FolderItem) {
      const parts = element.folderPath.split(path.sep);
      
      // Znajdź strukturę tego folderu
      let currentStructure = this.rootStructure;
      for (const part of parts) {
        const nextStructure = currentStructure.folders.get(part);
        if (!nextStructure) {
          return [];
        }
        currentStructure = nextStructure;
      }
      
      const result: TreeElement[] = [];
      
      // Dodaj podfoldery
      currentStructure.folders.forEach((structure, folderName) => {
        const fullPath = path.join(element.folderPath, folderName);
        result.push(new FolderItem(
          folderName,
          fullPath,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      });
      
      // Dodaj pliki
      result.push(...currentStructure.files);
      
      return result;
    }
    
    return [];
  }

  toggleFileSelection(file: FileItem) {
    file.toggleSelection();
    this.refresh();
    
    const selected = this.getSelectedFiles();
    vscode.window.setStatusBarMessage(`Zaznaczono: ${selected.length} plików`, 3000);
  }

  selectAll() {
    this.fileItems.forEach(item => {
      item.isSelected = true;
      item.iconPath = new vscode.ThemeIcon('pass-filled');
      item.contextValue = 'fileSelected';
    });
    this.refresh();
    vscode.window.showInformationMessage(`Zaznaczono wszystkie ${this.fileItems.size} plików`);
  }

  deselectAll() {
    this.fileItems.forEach(item => {
      item.isSelected = false;
      item.iconPath = new vscode.ThemeIcon('circle-outline');
      item.contextValue = 'fileUnselected';
    });
    this.refresh();
    vscode.window.showInformationMessage('Odznaczono wszystkie pliki');
  }

  selectFolder(folderPath: string) {
    let count = 0;
    this.fileItems.forEach((item, filePath) => {
      const relativePath = vscode.workspace.asRelativePath(filePath);
      if (relativePath.startsWith(folderPath + path.sep) || path.dirname(relativePath) === folderPath) {
        item.isSelected = true;
        item.iconPath = new vscode.ThemeIcon('pass-filled');
        item.contextValue = 'fileSelected';
        count++;
      }
    });
    this.refresh();
    vscode.window.showInformationMessage(`Zaznaczono ${count} plików w folderze ${folderPath}`);
  }

  getSelectedFiles(): vscode.Uri[] {
    return Array.from(this.fileItems.values())
      .filter(item => item.isSelected)
      .map(item => item.resourceUri);
  }

  saveCurrentSet(name: string) {
    const selected = this.getSelectedFiles().map(uri => uri.fsPath);
    if (selected.length === 0) {
      vscode.window.showWarningMessage('Brak zaznaczonych plików do zapisania');
      return;
    }
    this.savedSets.set(name, selected);
    this.persistSavedSets();
    vscode.window.showInformationMessage(`Zapisano zestaw "${name}" (${selected.length} plików)`);
  }

  loadSet(name: string) {
    const paths = this.savedSets.get(name);
    if (!paths) {
      vscode.window.showErrorMessage(`Nie znaleziono zestawu: ${name}`);
      return;
    }

    this.deselectAll();
    let loadedCount = 0;
    
    paths.forEach(filePath => {
      const item = this.fileItems.get(filePath);
      if (item) {
        item.isSelected = true;
        item.iconPath = new vscode.ThemeIcon('pass-filled');
        item.contextValue = 'fileSelected';
        loadedCount++;
      }
    });
    
    this.refresh();
    vscode.window.showInformationMessage(`Wczytano zestaw "${name}" (${loadedCount}/${paths.length} plików)`);
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