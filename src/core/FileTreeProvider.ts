import * as vscode from 'vscode';
import * as path from 'path';

export interface FileNode {
  uri: vscode.Uri;
  name: string;
  isFile: boolean;
  children?: FileNode[];
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private rootPath: string;
  private selectedFiles = new Set<string>();
  private globPattern = '**/*.{ts,tsx,js,jsx}';
  
  constructor(workspaceRoot: string) {
    this.rootPath = workspaceRoot;
  }
  
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  
  getTreeItem(element: FileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.name,
      element.isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    );
    
    item.id = element.uri.fsPath;
    item.resourceUri = element.uri;
    item.tooltip = vscode.workspace.asRelativePath(element.uri);
    
    if (element.isFile) {
      item.iconPath = new vscode.ThemeIcon('file');
      item.contextValue = 'file';
      
      // Dodaj komendę do zaznaczania plików
      item.command = {
        command: 'pm.toggleFileSelection',
        title: 'Toggle file selection',
        arguments: [element.uri]
      };
    } else {
      item.iconPath = new vscode.ThemeIcon('folder');
    }
    
    return item;
  }
  
  async getChildren(element?: FileNode): Promise<FileNode[]> {
    if (!element) {
      return this.getRootNodes();
    }
    
    if (element.isFile) {
      return [];
    }
    
    return this.getChildrenNodes(element.uri);
  }
  
  private async getRootNodes(): Promise<FileNode[]> {
    const files = await vscode.workspace.findFiles(
      this.globPattern,
      '**/{node_modules,dist,.git}/**'
    );
    
    const folders = new Map<string, FileNode>();
    
    for (const file of files) {
      const relativePath = vscode.workspace.asRelativePath(file);
      const parts = relativePath.split(path.sep);
      
      // Build folder structure
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        currentPath = currentPath ? path.join(currentPath, part) : part;
        
        if (!folders.has(currentPath)) {
          const folderUri = vscode.Uri.file(path.join(this.rootPath, currentPath));
          folders.set(currentPath, {
            uri: folderUri,
            name: part,
            isFile: false
          });
        }
      }
      
      // Add file
      const fileUri = vscode.Uri.file(path.join(this.rootPath, relativePath));
      const parentFolder = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : '';
      
      if (!folders.has(relativePath)) {
        folders.set(relativePath, {
          uri: fileUri,
          name: parts[parts.length - 1],
          isFile: true
        });
      }
    }
    
    // Only return top-level folders and files
    const topLevel = Array.from(folders.values()).filter(node => {
      const relative = vscode.workspace.asRelativePath(node.uri);
      return !relative.includes(path.sep);
    });
    
    return topLevel;
  }
  
  private async getChildrenNodes(folderUri: vscode.Uri): Promise<FileNode[]> {
    const folderPath = vscode.workspace.asRelativePath(folderUri);
    const files = await vscode.workspace.findFiles(
      path.join(folderPath, '*'),
      '**/{node_modules,dist,.git}/**'
    );
    
    return files.map(file => ({
      uri: file,
      name: path.basename(file.fsPath),
      isFile: true
    }));
  }
  
  // Public methods
  getSelectedFiles(): string[] {
    return Array.from(this.selectedFiles);
  }
  
  clearSelection(): void {
    this.selectedFiles.clear();
    this.refresh();
  }
  
  toggleFileSelection(filePath: string): boolean {
    if (this.selectedFiles.has(filePath)) {
      this.selectedFiles.delete(filePath);
      this.refresh();
      return false;
    } else {
      this.selectedFiles.add(filePath);
      this.refresh();
      return true;
    }
  }
}