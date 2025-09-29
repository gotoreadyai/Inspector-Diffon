// src/core/FileTreeProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';

export interface FileNode {
  uri: vscode.Uri;
  name: string;
  isFile: boolean;
  children?: FileNode[];
  // Wewnętrzne: węzeł-informacja, gdy nie wybrano modułu
  kind?: 'info' | 'node';
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private rootPath: string;
  private selectedFiles = new Set<string>();
  private readonly GLOB_PATTERN = '**/*.{ts,tsx,js,jsx}';
  private readonly EXCLUDE_PATTERN = '**/{node_modules,dist,.git,build,out,coverage}/**';
  private fileCache = new Map<string, FileNode>();
  private cacheBuilt = false; // Flaga czy cache jest już zbudowany
  
  // Zarządzanie stanem rozwinięcia
  private expandedNodes = new Set<string>();
  private context: vscode.ExtensionContext;

  // NOWE: aktywny moduł (nazwa); gdy null — drzewo nieaktywne
  private activeModuleName: string | null = null;
  
  constructor(workspaceRoot: string, context: vscode.ExtensionContext) {
    this.rootPath = workspaceRoot;
    this.context = context;
    
    // Wczytaj zapisany stan rozwinięcia
    const savedExpandedNodes = this.context.workspaceState.get<string[]>('pm.expandedFileNodes', []);
    this.expandedNodes = new Set(savedExpandedNodes);
  }
  
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** NOWE: ustawianie aktywnego modułu (null = brak) */
  setActiveModuleName(name: string | null) {
    this.activeModuleName = name;
    this.refresh();
  }
  getActiveModuleName(): string | null { return this.activeModuleName; }
  
  getTreeItem(element: FileNode): vscode.TreeItem {
    // Informacyjny węzeł, gdy nie wybrano modułu
    if (element.kind === 'info') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'info';
      item.tooltip = 'Wybierz moduł w drzewie „Projects”, aby aktywować wybór plików.';
      return item;
    }

    const isSelected = this.selectedFiles.has(element.uri.fsPath);
    const isExpanded = this.expandedNodes.has(element.uri.fsPath);
    
    const item = new vscode.TreeItem(
      element.name,
      element.isFile 
        ? vscode.TreeItemCollapsibleState.None 
        : (isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
    );
    
    item.id = element.uri.fsPath;
    item.resourceUri = element.uri;
    item.tooltip = vscode.workspace.asRelativePath(element.uri);

    // Opis: pokaż (zaznaczony) i do którego modułu dodajemy pliki
    const moduleHint = this.activeModuleName ? `→ moduł: ${this.activeModuleName}` : undefined;
    
    if (element.isFile) {
      if (isSelected) {
        item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        item.description = moduleHint ? `(zaznaczony) • ${moduleHint}` : '(zaznaczony)';
      } else {
        item.iconPath = new vscode.ThemeIcon('file');
        item.description = moduleHint;
      }
      
      item.contextValue = isSelected ? 'fileSelected' : 'file';

      // Aktywuj komendę tylko, gdy wybrano moduł
      if (this.activeModuleName) {
        item.command = {
          command: 'pm.toggleFileSelection',
          title: isSelected ? 'Deselect file' : 'Select file',
          arguments: [element.uri]
        };
      }
    } else {
      item.iconPath = new vscode.ThemeIcon('folder');
      // Foldery nie mają komendy, ale są normalnie nawigowalne
    }
    
    return item;
  }
  
  async getChildren(element?: FileNode): Promise<FileNode[]> {
    // Jeśli nie wybrano modułu — pokaż pojedynczy węzeł-informację
    if (!this.activeModuleName && !element) {
      return [{
        uri: vscode.Uri.file(this.rootPath),
        name: 'Wybierz moduł w drzewie Projektów, aby przypisywać pliki',
        isFile: false,
        kind: 'info'
      }];
    }

    // Zbuduj cache tylko raz przy pierwszym użyciu
    if (!this.cacheBuilt) {
      await this.buildFileCache();
      this.cacheBuilt = true;
    }
    
    if (!element) {
      return this.getRootNodes();
    }
    
    if (element.isFile) {
      return [];
    }
    
    return this.getChildrenNodes(element.uri);
  }
  
  private async getRootNodes(): Promise<FileNode[]> {
    const rootNodes: FileNode[] = [];
    
    for (const [filePath, node] of this.fileCache.entries()) {
      const relativePath = vscode.workspace.asRelativePath(filePath);
      if (!relativePath.includes(path.sep)) {
        rootNodes.push(node);
      }
    }
    
    // FOLDERY NAJPIERW, potem pliki — w obu grupach alfabetycznie
    return rootNodes.sort(compareFoldersFirstByName);
  }
  
  private async buildFileCache(): Promise<void> {
    this.fileCache.clear();
    
    const files = await vscode.workspace.findFiles(
      this.GLOB_PATTERN,
      this.EXCLUDE_PATTERN,
      1000
    );
    
    // Sortuj pliki po ścieżce dla stabilności
    files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    
    const folderMap = new Map<string, FileNode>();
    
    for (const file of files) {
      const relativePath = vscode.workspace.asRelativePath(file);
      const parts = relativePath.split(path.sep);
      
      // Build folder structure
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        currentPath = currentPath ? path.join(currentPath, part) : part;
        const fullPath = path.join(this.rootPath, currentPath);
        
        if (!folderMap.has(currentPath)) {
          const folderNode: FileNode = {
            uri: vscode.Uri.file(fullPath),
            name: part,
            isFile: false,
            children: [],
            kind: 'node'
          };
          folderMap.set(currentPath, folderNode);
          this.fileCache.set(fullPath, folderNode);
        }
      }
      
      // Add file
      const fileNode: FileNode = {
        uri: file,
        name: parts[parts.length - 1],
        isFile: true,
        kind: 'node'
      };
      this.fileCache.set(file.fsPath, fileNode);
      
      // Add file to parent folder
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : '';
      if (folderMap.has(parentPath)) {
        const parent = folderMap.get(parentPath)!;
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(fileNode);
      }
    }
  }
  
  private async getChildrenNodes(folderUri: vscode.Uri): Promise<FileNode[]> {
    const folderPath = vscode.workspace.asRelativePath(folderUri);
    const children: FileNode[] = [];
    
    // Znajdź dzieci w cache'u
    for (const [filePath, node] of this.fileCache.entries()) {
      const relativePath = vscode.workspace.asRelativePath(filePath);
      if (relativePath.startsWith(folderPath + path.sep) && 
          relativePath.split(path.sep).length === folderPath.split(path.sep).length + 1) {
        children.push(node);
      }
    }
    
    // FOLDERY NAJPIERW, potem pliki — w obu grupach alfabetycznie
    return children.sort(compareFoldersFirstByName);
  }
  
  // Public methods
  getSelectedFiles(): string[] {
    return Array.from(this.selectedFiles);
  }
  
  clearSelection(): void {
    this.selectedFiles.clear();
    this.refresh();
    vscode.window.setStatusBarMessage('Wyczyszczono zaznaczenie plików', 2000);
  }
  
  clearSelectionWithoutRefresh(): void {
    this.selectedFiles.clear();
  }
  
  selectFiles(filePaths: string[]): void {
    this.clearSelectionWithoutRefresh();
    const validFilePaths = filePaths.filter(p => p != null);
    validFilePaths.forEach(filePath => this.selectedFiles.add(filePath));
    this.refresh();
    
    if (validFilePaths.length === 1) {
      vscode.window.setStatusBarMessage(`Zaznaczono plik: ${path.basename(validFilePaths[0])}`, 2000);
    } else {
      vscode.window.setStatusBarMessage(`Zaznaczono ${validFilePaths.length} plików`, 2000);
    }
  }
  
  toggleFileSelection(filePath: string): boolean {
    if (!filePath) return false;
    const wasSelected = this.selectedFiles.has(filePath);
    
    if (wasSelected) {
      this.selectedFiles.delete(filePath);
      vscode.window.setStatusBarMessage(`Odznaczono plik: ${path.basename(filePath)}`, 2000);
    } else {
      this.selectedFiles.add(filePath);
      vscode.window.setStatusBarMessage(`Zaznaczono plik: ${path.basename(filePath)}`, 2000);
    }
    
    this.refresh();
    return !wasSelected;
  }
  
  // Stan rozwinięcia
  setExpanded(nodeId: string, expanded: boolean): void {
    if (expanded) this.expandedNodes.add(nodeId);
    else this.expandedNodes.delete(nodeId);
    this.context.workspaceState.update('pm.expandedFileNodes', Array.from(this.expandedNodes));
  }
  
  getExpandedNodes(): string[] {
    return Array.from(this.expandedNodes);
  }
  
  async rebuildCache(): Promise<void> {
    this.cacheBuilt = false;
    this.fileCache.clear();
    this.refresh();
  }
}

/** Foldery najpierw, potem pliki; w ramach grupy po nazwie */
function compareFoldersFirstByName(a: FileNode, b: FileNode): number {
  if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
  return a.name.localeCompare(b.name);
}
