// path: src/fileTreeProvider.ts
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

    // STABILNE ID → VS Code zachowuje stan ekspandowania przy refreshu
    this.id = `folder:${folderPath}`;

    this.iconPath = vscode.ThemeIcon.Folder;
    this.contextValue = 'folder';
    this.tooltip = folderPath;

    // Klik w etykietę folderu = toggle zaznaczenia jego plików
    this.command = {
      command: 'llmDiff.selectFolder',
      title: 'Przełącz zaznaczenie folderu',
      arguments: [this.folderPath]
    };
  }
}

export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public isSelected: boolean = false
  ) {
    super(resourceUri, collapsibleState);

    // STABILNE ID dla plików
    this.id = `file:${resourceUri.fsPath}`;

    const fileName = path.basename(resourceUri.fsPath);
    this.label = fileName;
    this.tooltip = vscode.workspace.asRelativePath(resourceUri);

    // Ikony
    this.iconPath = new vscode.ThemeIcon(
      isSelected ? 'check' : 'circle-large-outline'
    );

    // Klik = toggle
    this.command = {
      command: 'llmDiff.onItemClicked',
      title: 'Przełącz zaznaczenie',
      arguments: [this]
    };

    this.contextValue = isSelected ? 'fileSelected' : 'fileUnselected';
  }

  toggleSelection() {
    this.isSelected = !this.isSelected;
    this.iconPath = new vscode.ThemeIcon(
      this.isSelected ? 'check' : 'circle-large-outline'
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

  refresh(): void { this._onDidChangeTreeData.fire(); }

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

      this.fileItems.clear();
      this.rootStructure = { folders: new Map(), files: [] };

      files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

      for (const file of files) {
        const item = new FileItem(file, vscode.TreeItemCollapsibleState.None);
        this.fileItems.set(file.fsPath, item);

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

      // Status bar zamiast modala (mniej „mrygania” UI)
      vscode.window.setStatusBarMessage(`Znaleziono ${files.length} plików`, 2000);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Błąd ładowania plików: ${error?.message ?? String(error)}`);
    }
  }

  getTreeItem(element: TreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!this.workspaceRoot) return [];

    if (!element) {
      if (this.fileItems.size === 0) { await this.loadFiles(); }
      const result: TreeElement[] = [];
      this.rootStructure.folders.forEach((_s, folderName) => {
        result.push(new FolderItem(folderName, folderName, vscode.TreeItemCollapsibleState.Collapsed));
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
        result.push(new FolderItem(folderName, fullPath, vscode.TreeItemCollapsibleState.Collapsed));
      });
      result.push(...currentStructure.files);
      return result;
    }

    return [];
  }

  private notifySelectionChanged() {
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  toggleFileSelection(file: FileItem) {
    file.toggleSelection();
    // Odśwież tylko zmieniony element → mniej migotania
    this._onDidChangeTreeData.fire(file);
    const selected = this.getSelectedFiles();
    vscode.window.setStatusBarMessage(`Zaznaczono: ${selected.length} plików`, 1500);
    this.notifySelectionChanged();
  }

  selectAll() {
    this.fileItems.forEach(item => {
      item.isSelected = true;
      item.iconPath = new vscode.ThemeIcon('check');
      item.contextValue = 'fileSelected';
    });
    this.refresh();
    vscode.window.showInformationMessage(`Zaznaczono wszystkie ${this.fileItems.size} pliki.`);
    this.notifySelectionChanged();
  }

  deselectAll() {
    this.fileItems.forEach(item => {
      item.isSelected = false;
      item.iconPath = new vscode.ThemeIcon('circle-large-outline');
      item.contextValue = 'fileUnselected';
    });
    this.refresh();
    vscode.window.showInformationMessage('Odznaczono wszystkie pliki.');
    this.notifySelectionChanged();
  }

  // TOGGLE: jeśli nie wszystkie w folderze są zaznaczone → zaznacz wszystkie; inaczej → odznacz wszystkie
  selectFolder(folderPath: string) {
    const affected: Array<[string, FileItem]> = [];
    let total = 0;
    let selected = 0;

    this.fileItems.forEach((item, filePath) => {
      const relativePath = vscode.workspace.asRelativePath(filePath);
      const inFolder =
        relativePath.startsWith(folderPath + path.sep) ||
        path.dirname(relativePath) === folderPath;

      if (inFolder) {
        total++;
        if (item.isSelected) selected++;
        affected.push([filePath, item]);
      }
    });

    if (total === 0) {
      vscode.window.showInformationMessage(`Brak plików w folderze „${folderPath}”.`);
      return;
    }

    const shouldSelect = selected < total; // jeśli są jakieś nie-zaznaczone → zaznacz wszystkie

    for (const [, item] of affected) {
      item.isSelected = shouldSelect;
      item.iconPath = new vscode.ThemeIcon(shouldSelect ? 'check' : 'circle-large-outline');
      item.contextValue = shouldSelect ? 'fileSelected' : 'fileUnselected';
      // precyzyjny, częściowy refresh zamiast pełnego
      this._onDidChangeTreeData.fire(item);
    }

    // Status bar zamiast modala (eliminuje skoki layoutu)
    vscode.window.setStatusBarMessage(
      shouldSelect
        ? `Zaznaczono ${total} plików w „${folderPath}”.`
        : `Odznaczono ${total} plików w „${folderPath}”.`,
      1500
    );
    this.notifySelectionChanged();
  }

  getSelectedFiles(): vscode.Uri[] {
    return Array.from(this.fileItems.values())
      .filter(item => item.isSelected)
      .map(item => item.resourceUri);
  }

  saveCurrentSet(name: string) {
    const selected = this.getSelectedFiles().map(uri => uri.fsPath);
    if (selected.length === 0) {
      vscode.window.showWarningMessage('Brak zaznaczonych plików do zapisania.');
      return;
    }
    this.savedSets.set(name, selected);
    this.persistSavedSets();
    vscode.window.showInformationMessage(`Zapisano zestaw „${name}” (${selected.length} plików).`);
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
        item.iconPath = new vscode.ThemeIcon('check');
        item.contextValue = 'fileSelected';
        loadedCount++;
      }
    });
    this.refresh();
    vscode.window.showInformationMessage(`Wczytano zestaw „${name}” (${loadedCount}/${paths.length} plików).`);
    this.notifySelectionChanged();
  }

  getSavedSets(): string[] { return Array.from(this.savedSets.keys()); }

  private persistSavedSets() {
    if (this.context) {
      const data = Array.from(this.savedSets.entries());
      this.context.workspaceState.update('llmDiff.savedSets', data);
    }
  }

  private loadSavedSets() {
    if (this.context) {
      const saved = this.context.workspaceState.get('llmDiff.savedSets') as [string, string[]][] | undefined;
      if (saved) { this.savedSets = new Map(saved); }
    }
  }
}
