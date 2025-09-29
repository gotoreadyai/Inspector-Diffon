import * as vscode from 'vscode';
import * as path from 'path';

interface FileNode {
  uri: vscode.Uri;
  name: string;
  type: 'file' | 'folder';
  children?: Map<string, FileNode>;
}

export class LLMFileTreeProvider implements vscode.TreeDataProvider<FileNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private root: FileNode = { uri: vscode.Uri.file(''), name: '', type: 'folder', children: new Map() };
  private fileMap = new Map<string, FileNode>();
  private selectedPaths = new Set<string>();
  private savedSets = new Map<string, string[]>();
  private globPattern = 'src/**/*.{ts,tsx,js,jsx}';
  private watcher?: vscode.FileSystemWatcher;
  private treeView?: vscode.TreeView<FileNode>;

  constructor(
    private workspaceRoot: string,
    private context?: vscode.ExtensionContext
  ) {
    this.loadSavedSets();
    this.loadFiles();
    this.setupFileWatcher();
  }

  private setupFileWatcher() {
    // Przekonfiguruj watcher pod bieżący wzorzec
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(this.globPattern);
    this.watcher.onDidCreate(() => this.loadFiles());
    this.watcher.onDidDelete(() => this.loadFiles());
    this.watcher.onDidChange(() => this.loadFiles());
    this.context?.subscriptions.push(this.watcher);
  }

  setTreeView(treeView: vscode.TreeView<FileNode>) {
    this.treeView = treeView;
  }

  async refresh(): Promise<void> {
    await this.loadFiles();
  }

  async setGlobPattern(pattern: string) {
    this.globPattern = pattern;
    this.setupFileWatcher(); // <- natychmiast przełącz watcher na nowy glob
    await this.loadFiles();
    vscode.window.setStatusBarMessage(`Wzorzec ustawiony: ${pattern}`, 2000);
  }

  private async loadFiles() {
    try {
      const files = await vscode.workspace.findFiles(
        this.globPattern,
        '**/{node_modules,dist,.next,.git,build,out,coverage}/**',
        1000
      );

      // Preserve existing selections
      const oldSelection = new Set(this.selectedPaths);
      this.selectedPaths.clear();
      this.fileMap.clear();
      this.root.children = new Map();

      files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

      for (const file of files) {
        const relativePath = vscode.workspace.asRelativePath(file);
        const parts = relativePath.split(path.sep);
        
        // Build tree structure
        let currentNode = this.root;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const isFile = i === parts.length - 1;
          
          if (!currentNode.children!.has(part)) {
            const node: FileNode = {
              uri: isFile ? file : vscode.Uri.file(path.join(this.workspaceRoot, ...parts.slice(0, i + 1))),
              name: part,
              type: isFile ? 'file' : 'folder',
              children: isFile ? undefined : new Map()
            };
            
            currentNode.children!.set(part, node);
            if (isFile) {
              this.fileMap.set(file.fsPath, node);
              // Restore selection
              if (oldSelection.has(file.fsPath)) {
                this.selectedPaths.add(file.fsPath);
              }
            }
          }
          
          if (!isFile) {
            currentNode = currentNode.children!.get(part)!;
          }
        }
      }

      vscode.window.setStatusBarMessage(`Znaleziono ${files.length} plików`, 2000);
      this._onDidChangeTreeData.fire();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Błąd ładowania plików: ${error?.message ?? String(error)}`);
    }
  }

  getTreeItem(element: FileNode): vscode.TreeItem {
    const isSelected = this.selectedPaths.has(element.uri.fsPath);
    const item = new vscode.TreeItem(
      element.name + (isSelected && element.type === 'file' ? ' 🟢' : ''),
      element.type === 'folder' 
        ? vscode.TreeItemCollapsibleState.Collapsed 
        : vscode.TreeItemCollapsibleState.None
    );
    
    item.id = `${element.type}:${element.uri.fsPath}`;
    item.tooltip = vscode.workspace.asRelativePath(element.uri);
    item.iconPath = element.type === 'folder' ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    item.contextValue = element.type === 'file' ? (isSelected ? 'fileSelected' : 'file') : 'folder';
    
    if (element.type === 'file') {
      item.command = {
        command: 'llmDiff.onItemClicked',
        title: 'Toggle selection',
        arguments: [element.uri.fsPath]
      };
    }
    
    return item;
  }

  async getChildren(element?: FileNode): Promise<FileNode[]> {
    if (!this.workspaceRoot) return [];
    
    if (!element) {
      if (this.fileMap.size === 0) await this.loadFiles();
      return Array.from(this.root.children?.values() || []);
    }
    
    return Array.from(element.children?.values() || []);
  }

  // Selection management
  toggleFileSelection(filePath: string) {
    if (this.selectedPaths.has(filePath)) {
      this.selectedPaths.delete(filePath);
    } else {
      this.selectedPaths.add(filePath);
    }
    this._onDidChangeTreeData.fire();
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  selectAll() {
    this.fileMap.forEach((_, path) => this.selectedPaths.add(path));
    vscode.window.showInformationMessage(`Zaznaczono wszystkie ${this.fileMap.size} pliki.`);
    this._onDidChangeTreeData.fire();
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  deselectAll() {
    this.selectedPaths.clear();
    vscode.window.showInformationMessage('Odznaczono wszystkie pliki.');
    this._onDidChangeTreeData.fire();
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  selectFolder(folderPath: string) {
    const folderFiles = Array.from(this.fileMap.entries())
      .filter(([filePath]) => {
        const rel = vscode.workspace.asRelativePath(filePath);
        return rel.startsWith(folderPath + path.sep) || path.dirname(rel) === folderPath;
      })
      .map(([filePath]) => filePath);

    if (!folderFiles.length) {
      vscode.window.showInformationMessage(`Brak plików w folderze „${folderPath}".`);
      return;
    }

    const selectedInFolder = folderFiles.filter(f => this.selectedPaths.has(f));
    const shouldSelect = selectedInFolder.length < folderFiles.length;
    
    folderFiles.forEach(f => shouldSelect ? this.selectedPaths.add(f) : this.selectedPaths.delete(f));
    
    vscode.window.setStatusBarMessage(
      `${shouldSelect ? 'Zaznaczono' : 'Odznaczono'} ${folderFiles.length} plików w „${folderPath}".`,
      1500
    );
    
    this._onDidChangeTreeData.fire();
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  getSelectedFiles(): vscode.Uri[] {
    const fromState = Array.from(this.selectedPaths)
      .map(path => this.fileMap.get(path))
      .filter(node => node)
      .map(node => node!.uri);
    
    // Merge with native TreeView selection if available
    if (this.treeView) {
      const fromTreeView = this.treeView.selection
        .filter(node => node.type === 'file')
        .map(node => node.uri);
      
      const combined = new Map<string, vscode.Uri>();
      [...fromState, ...fromTreeView].forEach(uri => combined.set(uri.fsPath, uri));
      return Array.from(combined.values());
    }
    
    return fromState;
  }

  // Selection sets management
  saveCurrentSet(name: string) {
    const selected = Array.from(this.selectedPaths);
    if (!selected.length) {
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
    
    this.selectedPaths.clear();
    let loadedCount = 0;
    
    paths.forEach(filePath => {
      if (this.fileMap.has(filePath)) {
        this.selectedPaths.add(filePath);
        loadedCount++;
      }
    });
    
    this._onDidChangeTreeData.fire();
    vscode.window.showInformationMessage(`Wczytano zestaw „${name}" (${loadedCount}/${paths.length} plików).`);
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
  }

  getSavedSets(): string[] {
    return Array.from(this.savedSets.keys());
  }

  private persistSavedSets() {
    this.context?.workspaceState.update('llmDiff.savedSets', Array.from(this.savedSets.entries()));
  }

  private loadSavedSets() {
    const saved = this.context?.workspaceState.get('llmDiff.savedSets') as [string, string[]][] | undefined;
    if (saved) this.savedSets = new Map(saved);
  }
}

// Simplified exports - no longer need separate FileItem and FolderItem classes
export type { FileNode };