import * as vscode from 'vscode';
import * as path from 'path';
import { Project, Module, Task, Template } from './types';

interface TreeNode {
  kind: 'project' | 'module' | 'task' | 'template' | 'templateRoot' | 'file' | 'folder' | 'info' | 'separator' | 'filesHeader';
  label: string;
  uri?: vscode.Uri;
  data?: Project | Module | Task | Template;
  description?: string;
  children?: TreeNode[];
}

export class UnifiedTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<TreeNode | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private selectedFiles = new Set<string>();
  private fileCache: Map<string, TreeNode> | null = null;
  private activeModule: Module | null = null;
  private templates: Template[] = [];

  constructor(
    private workspaceRoot: string,
    private getProject: () => Project | null,
    private context: vscode.ExtensionContext
  ) {}

  refresh = () => {
    this.fileCache = null;
    this._onDidChange.fire();
  };

  setTemplates = (templates: Template[]) => {
    this.templates = templates;
    this.refresh();
  };

  setActiveModule = (module: Module | null) => {
    this.activeModule = module;
    this.selectedFiles.clear();
    if (module) module.files.forEach(f => this.selectedFiles.add(f));
    this.refresh();
  };

  getActiveModule = () => this.activeModule;
  getSelectedFiles = () => [...this.selectedFiles];

  toggleFileSelection = (filePath: string): boolean => {
    if (!this.activeModule) return false;
    
    const module = this.activeModule;
    const idx = module.files.indexOf(filePath);
    
    if (idx >= 0) {
      module.files.splice(idx, 1);
      this.selectedFiles.delete(filePath);
    } else {
      module.files.push(filePath);
      this.selectedFiles.add(filePath);
    }
    
    this.refresh();
    return idx < 0; // true if selected
  };

  getTreeItem(node: TreeNode): vscode.TreeItem {
    // Separator - visual divider
    if (node.kind === 'separator') {
      const item = new vscode.TreeItem('┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈', vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'separator';
      item.description = '';
      return item;
    }

    // Files Header - section title
    if (node.kind === 'filesHeader') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('files', new vscode.ThemeColor('charts.purple'));
      item.contextValue = 'filesHeader';
      item.description = node.description;
      return item;
    }

    const item = new vscode.TreeItem(
      node.label,
      node.kind === 'task' && !(node.data as Task)?.children?.length
        ? vscode.TreeItemCollapsibleState.None
        : node.kind === 'info'
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    item.description = node.description;
    item.resourceUri = node.uri;
    item.contextValue = node.kind;

    // Icons with colors
    if (node.kind === 'project') {
      item.iconPath = new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.blue'));
    } else if (node.kind === 'module') {
      item.iconPath = new vscode.ThemeIcon('milestone', new vscode.ThemeColor('charts.yellow'));
      item.command = { command: 'pm.selectModule', title: 'Select', arguments: [node.data] };
    } else if (node.kind === 'task') {
      const task = node.data as Task;
      item.iconPath = task.status === 'done'
        ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('circle-outline');
      item.command = { command: 'pm.toggleTask', title: 'Toggle', arguments: [task] };
    } else if (node.kind === 'template') {
      item.iconPath = new vscode.ThemeIcon('rocket', new vscode.ThemeColor('charts.orange'));
      item.command = { command: 'pm.startFromTemplate', title: 'Start', arguments: [node.data] };
    } else if (node.kind === 'file') {
      const isSelected = this.selectedFiles.has(node.uri!.fsPath);
      item.iconPath = isSelected
        ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('file');
      item.description = isSelected ? '(selected)' : '';
      if (this.activeModule) {
        item.command = { command: 'pm.toggleFile', title: 'Toggle', arguments: [node.uri] };
      }
    } else if (node.kind === 'folder') {
      item.iconPath = new vscode.ThemeIcon('folder');
    } else if (node.kind === 'info') {
      item.iconPath = new vscode.ThemeIcon('info');
    }

    return item;
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (!node) return this.getRootNodes();

    if (node.kind === 'templateRoot') {
      return this.templates.map(t => ({
        kind: 'template' as const,
        label: t.name,
        description: t.description,
        data: t
      }));
    }

    if (node.kind === 'project') {
      const project = node.data as Project;
      return project.modules.map(m => ({
        kind: 'module' as const,
        label: m.name,
        description: `${this.countTasks(m.tasks)} tasks, ${m.files.length} files`,
        data: m
      }));
    }

    if (node.kind === 'module') {
      const module = node.data as Module;
      return module.tasks.map(t => this.taskToNode(t));
    }

    if (node.kind === 'task') {
      const task = node.data as Task;
      return (task.children || []).map(t => this.taskToNode(t));
    }

    if (node.kind === 'folder') {
      return this.getFileChildren(node.uri!);
    }

    return [];
  }

  private async getRootNodes(): Promise<TreeNode[]> {
    const nodes: TreeNode[] = [];

    // Templates section
    nodes.push({ kind: 'templateRoot', label: 'Templates' });

    // Project section
    const project = this.getProject();
    if (project) {
      const counts = this.countAll(project);
      nodes.push({
        kind: 'project',
        label: project.name,
        description: `${counts.modules} modules • ${counts.total} tasks (⏳${counts.todo} ✅${counts.done})`,
        data: project
      });
    }

    // Visual separator + Files section (only if module selected)
    if (this.activeModule) {
      // Add separator line
      nodes.push({ 
        kind: 'separator', 
        label: '┈'
      });

      // Add files header
      const fileCount = this.selectedFiles.size;
      nodes.push({
        kind: 'filesHeader',
        label: 'Milestone Files',
        description: fileCount > 0 ? `${fileCount} selected` : 'click to select'
      });

      // Add file tree
      if (!this.fileCache) await this.buildFileCache();
      
      const roots: TreeNode[] = [];
      for (const [, node] of this.fileCache!) {
        const rel = vscode.workspace.asRelativePath(node.uri!);
        if (!rel.includes(path.sep)) roots.push(node);
      }
      
      nodes.push(...roots.sort((a, b) => 
        a.kind === b.kind ? a.label.localeCompare(b.label) : (a.kind === 'file' ? 1 : -1)
      ));
    } else if (!project) {
      // Show info when no project
      nodes.push({
        kind: 'info',
        label: '📝 Open a project or start from template'
      });
    }

    return nodes;
  }

  private taskToNode(task: Task): TreeNode {
    return {
      kind: 'task',
      label: task.title,
      description: task.status,
      data: task
    };
  }

  private async buildFileCache() {
    this.fileCache = new Map();
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx}',
      '**/{node_modules,dist,.git,build,out}/**',
      1000
    );

    const folderMap = new Map<string, TreeNode>();

    for (const file of files) {
      const rel = vscode.workspace.asRelativePath(file);
      const parts = rel.split(path.sep);

      // Create folder nodes
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        acc = acc ? path.join(acc, part) : part;
        const full = path.join(this.workspaceRoot, acc);

        if (!folderMap.has(acc)) {
          const node: TreeNode = {
            kind: 'folder',
            label: part,
            uri: vscode.Uri.file(full)
          };
          folderMap.set(acc, node);
          this.fileCache.set(full, node);
        }
      }

      // Create file node
      const fileNode: TreeNode = {
        kind: 'file',
        label: parts[parts.length - 1],
        uri: file
      };
      this.fileCache.set(file.fsPath, fileNode);
    }
  }

  private async getFileChildren(folderUri: vscode.Uri): Promise<TreeNode[]> {
    if (!this.fileCache) return [];
    
    const folderPath = vscode.workspace.asRelativePath(folderUri);
    const depth = folderPath.split(path.sep).length;
    const children: TreeNode[] = [];

    for (const [filePath, node] of this.fileCache) {
      const rel = vscode.workspace.asRelativePath(filePath);
      if (rel.startsWith(folderPath + path.sep) && rel.split(path.sep).length === depth + 1) {
        children.push(node);
      }
    }

    return children.sort((a, b) => 
      a.kind === b.kind ? a.label.localeCompare(b.label) : (a.kind === 'file' ? 1 : -1)
    );
  }

  private countTasks(tasks: Task[]): number {
    let count = 0;
    const walk = (list: Task[]) => {
      for (const t of list) {
        count++;
        if (t.children) walk(t.children);
      }
    };
    walk(tasks);
    return count;
  }

  private countAll(project: Project) {
    let total = 0, todo = 0, done = 0;
    const walk = (tasks: Task[]) => {
      for (const t of tasks) {
        total++;
        t.status === 'done' ? done++ : todo++;
        if (t.children) walk(t.children);
      }
    };
    for (const m of project.modules) walk(m.tasks);
    return { modules: project.modules.length, total, todo, done };
  }
}