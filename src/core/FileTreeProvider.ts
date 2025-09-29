// src/core/FileTreeProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { COMMANDS, WS_KEYS } from '../constants';
import { MSG } from '../ui/messages';

export interface FileNode {
  uri: vscode.Uri;
  name: string;
  isFile: boolean;
  children?: FileNode[];
  /** Internal: info node when no module is selected */
  kind?: 'info' | 'node';
}

const GLOB_PATTERN = '**/*.{ts,tsx,js,jsx}';
const EXCLUDE_PATTERN = '**/{node_modules,dist,.git,build,out,coverage}/**';

export class FileTreeProvider implements vscode.TreeDataProvider<FileNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FileNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly rootPath: string;
  private readonly context: vscode.ExtensionContext;

  private readonly selectedFiles = new Set<string>();
  private readonly fileCache = new Map<string, FileNode>();
  private readonly expandedNodes: Set<string>;

  private cacheBuilt = false;
  private activeModuleName: string | null = null;

  constructor(workspaceRoot: string, context: vscode.ExtensionContext) {
    this.rootPath = workspaceRoot;
    this.context = context;
    this.expandedNodes = new Set(
      this.context.workspaceState.get<string[]>(WS_KEYS.expandedFileNodes, [])
    );
  }

  // -------- Public API
  refresh = (): void => this._onDidChangeTreeData.fire();

  setActiveModuleName = (name: string | null) => { this.activeModuleName = name; this.refresh(); };
  getActiveModuleName = (): string | null => this.activeModuleName;

  getSelectedFiles = (): string[] => [...this.selectedFiles];

  clearSelection = (): void => { this.selectedFiles.clear(); this.refresh(); };
  clearSelectionWithoutRefresh = (): void => { this.selectedFiles.clear(); };

  selectFiles = (filePaths: string[]): void => {
    this.clearSelectionWithoutRefresh();
    const valid = (filePaths || []).filter(Boolean) as string[];
    valid.forEach(fp => this.selectedFiles.add(fp));
    this.refresh();

    const msg = valid.length === 1
      ? MSG.statusSelectedOne(path.basename(valid[0]!))
      : MSG.statusSelectedMany(valid.length);
    vscode.window.setStatusBarMessage(msg, 2000);
  };

  toggleFileSelection = (filePath: string): boolean => {
    if (!filePath) return false;
    const name = path.basename(filePath);
    const wasSelected = this.selectedFiles.delete(filePath);
    if (!wasSelected) this.selectedFiles.add(filePath);

    vscode.window.setStatusBarMessage(
      wasSelected ? MSG.statusDeselected(name) : MSG.statusSelectedOne(name),
      2000
    );

    this.refresh();
    return !wasSelected;
  };

  setExpanded = (nodeId: string, expanded: boolean): void => {
    expanded ? this.expandedNodes.add(nodeId) : this.expandedNodes.delete(nodeId);
    this.context.workspaceState.update(WS_KEYS.expandedFileNodes, [...this.expandedNodes]);
  };

  getExpandedNodes = (): string[] => [...this.expandedNodes];

  rebuildCache = async (): Promise<void> => {
    this.cacheBuilt = false;
    this.fileCache.clear();
    this.refresh();
  };

  // -------- TreeDataProvider
  getTreeItem = (el: FileNode): vscode.TreeItem => {
    if (el.kind === 'info') {
      const item = new vscode.TreeItem(el.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'info';
      item.tooltip = MSG.infoActivateSelection;
      return item;
    }

    const isSelected = this.selectedFiles.has(el.uri.fsPath);
    const isExpanded = this.expandedNodes.has(el.uri.fsPath);

    const item = new vscode.TreeItem(
      el.name,
      el.isFile
        ? vscode.TreeItemCollapsibleState.None
        : (isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
    );

    item.id = el.uri.fsPath;
    item.resourceUri = el.uri;
    item.tooltip = vscode.workspace.asRelativePath(el.uri);

    const moduleHint = this.activeModuleName ? MSG.treeModuleHint(this.activeModuleName) : undefined;

    if (el.isFile) {
      item.iconPath = isSelected
        ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('file');

      item.description = isSelected
        ? (moduleHint ? `(selected) • ${moduleHint}` : '(selected)')
        : moduleHint;

      item.contextValue = isSelected ? 'fileSelected' : 'file';

      if (this.activeModuleName) {
        item.command = {
          command: COMMANDS.TOGGLE_FILE_SELECTION,
          title: isSelected ? 'Deselect file' : 'Select file',
          arguments: [el.uri],
        };
      }
    } else {
      item.iconPath = new vscode.ThemeIcon('folder');
    }

    return item;
  };

  getChildren = async (el?: FileNode): Promise<FileNode[]> => {
    // Show info node when no module is active
    if (!this.activeModuleName && !el) {
      return [{
        uri: vscode.Uri.file(this.rootPath),
        name: MSG.infoSelectMilestone,
        isFile: false,
        kind: 'info',
      }];
    }

    if (!this.cacheBuilt) { await this.buildFileCache(); this.cacheBuilt = true; }

    if (!el) return this.getRootNodes();
    if (el.isFile) return [];

    return this.getChildrenNodes(el.uri);
  };

  // -------- Internals
  private getRootNodes = async (): Promise<FileNode[]> => {
    const roots: FileNode[] = [];
    for (const [filePath, node] of this.fileCache) {
      const rel = vscode.workspace.asRelativePath(filePath);
      if (!rel.includes(path.sep)) roots.push(node);
    }
    return roots.sort(compareFoldersFirstByName);
  };

  private buildFileCache = async (): Promise<void> => {
    this.fileCache.clear();

    const files = await vscode.workspace.findFiles(GLOB_PATTERN, EXCLUDE_PATTERN, 1000);
    files.sort((a, b) => a.fsPath.localeCompare(b.fsPath)); // stable order

    const folderMap = new Map<string, FileNode>();

    for (const file of files) {
      const rel = vscode.workspace.asRelativePath(file);
      const parts = rel.split(path.sep);

      // ensure folder nodes
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        acc = acc ? path.join(acc, part) : part;
        const full = path.join(this.rootPath, acc);

        if (!folderMap.has(acc)) {
          const folderNode: FileNode = {
            uri: vscode.Uri.file(full),
            name: part,
            isFile: false,
            children: [],
            kind: 'node',
          };
          folderMap.set(acc, folderNode);
          this.fileCache.set(full, folderNode);
        }
      }

      // file node
      const fileNode: FileNode = {
        uri: file,
        name: parts.at(-1)!,
        isFile: true,
        kind: 'node',
      };
      this.fileCache.set(file.fsPath, fileNode);

      // attach to parent folder
      const parentKey = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : '';
      const parent = folderMap.get(parentKey);
      parent?.children?.push(fileNode);
    }
  };

  private getChildrenNodes = async (folderUri: vscode.Uri): Promise<FileNode[]> => {
    const folderPath = vscode.workspace.asRelativePath(folderUri);
    const depth = folderPath.split(path.sep).length;

    const children: FileNode[] = [];
    for (const [filePath, node] of this.fileCache) {
      const rel = vscode.workspace.asRelativePath(filePath);
      if (rel.startsWith(folderPath + path.sep) && rel.split(path.sep).length === depth + 1) {
        children.push(node);
      }
    }
    return children.sort(compareFoldersFirstByName);
  };
}

/** Folders first, then files; alphabetical within groups */
const compareFoldersFirstByName = (a: FileNode, b: FileNode): number =>
  a.isFile === b.isFile ? a.name.localeCompare(b.name) : (a.isFile ? 1 : -1);
