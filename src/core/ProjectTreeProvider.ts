import * as vscode from 'vscode';
import { Module, Project, Task, TaskStatus } from '../models';
import { counts, ensureArrays, formatProjectSummary } from '../utils';
import { Template, loadTemplates } from '../templates';

const COLOR = {
  project: new vscode.ThemeColor('charts.blue'),
  templatesRoot: new vscode.ThemeColor('charts.purple'),
  template: new vscode.ThemeColor('charts.orange'),
  module: new vscode.ThemeColor('charts.yellow'),
  taskDone: new vscode.ThemeColor('terminal.ansiGreen'),
  taskTodo: new vscode.ThemeColor('descriptionForeground'),
  templateTaskDone: new vscode.ThemeColor('charts.green'),
  templateTaskTodo: new vscode.ThemeColor('descriptionForeground'),
};

const TEMPLATES_GLOB = '.inspector-diff/templates/*.json';

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private templates: Template[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private getProject: () => Project | null,
    private setProject: (p: Project | null) => Promise<void>
  ) {
    this.refreshTemplates();
    this.setupTemplatesWatcher();
  }

  refresh = () => this._onDidChangeTreeData.fire();

  private async refreshTemplates() {
    this.templates = await loadTemplates();
    this.refresh();
  }

  private setupTemplatesWatcher() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return;
    const pattern = new vscode.RelativePattern(root, TEMPLATES_GLOB);
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidCreate(() => this.refreshTemplates());
    this.watcher.onDidChange(() => this.refreshTemplates());
    this.watcher.onDidDelete(() => this.refreshTemplates());
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    let collapsible = vscode.TreeItemCollapsibleState.Collapsed;

    if (element.kind === 'project') {
      collapsible = vscode.TreeItemCollapsibleState.Expanded;
    } else if (element.kind === 'task' && !element.task?.children?.length) {
      collapsible = vscode.TreeItemCollapsibleState.None;
    } else if (element.kind === 'templateTask') {
      collapsible = vscode.TreeItemCollapsibleState.None;
    }

    const item = new vscode.TreeItem(element.label, collapsible);
    item.id = stableId(element);
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.contextValue = element.kind;

    if (element.kind === 'task') {
      item.iconPath = iconForTask(element.task!.status);
      item.command = {
        command: 'pm.toggleTaskDone',
        title: 'Toggle',
        arguments: [element],
      };
    } else if (element.kind === 'templateTask') {
      item.iconPath = iconForTemplateTask(element.description as TaskStatus);
    } else if (element.kind === 'templatesRoot') {
      item.iconPath = new vscode.ThemeIcon('symbol-structure', COLOR.templatesRoot);
    } else if (element.kind === 'template') {
      item.iconPath = new vscode.ThemeIcon('rocket', COLOR.template);
      item.command = {
        command: 'pm.startFromTemplate',
        title: 'Start from template',
        arguments: [element],
      };
    } else if (element.kind === 'project') {
      item.iconPath = new vscode.ThemeIcon('package', COLOR.project);
    } else if (element.kind === 'module') {
      item.iconPath = new vscode.ThemeIcon('milestone', COLOR.module);
      item.command = {
        command: 'pm.selectModule',
        title: 'Select module',
        arguments: [element.module],
      };
    }

    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const p = this.getProject();
    const nodes: TreeNode[] = [];

    if (!element) {
      nodes.push({ kind: 'templatesRoot', label: 'Templates' });
      if (p) {
        ensureArrays(p);
        const c = counts(p);
        nodes.push({
          kind: 'project',
          label: p.name,
          description: formatProjectSummary(c),
          project: p,
          tooltip: p.description || '',
        });
      }
      return nodes;
    }

    if (element.kind === 'templatesRoot') return this.templates.map(nodeTemplate);
    if (element.kind === 'template') {
      return element.template!.modules.map(m => ({
        kind: 'templateModule' as const,
        label: m.name,
        description: `${(m.tasks || []).length} tasks`,
        template: element.template,
      }));
    }
    if (element.kind === 'templateModule') {
      const mod = element.template!.modules.find(m => m.name === element.label);
      if (!mod) return [];
      return (mod.tasks || []).map(t => ({
        kind: 'templateTask' as const,
        label: t.title,
        description: (t.status as TaskStatus) || 'todo',
        template: element.template,
      }));
    }

    if (element.kind === 'project') return element.project!.modules.map(nodeModule);
    if (element.kind === 'module') return element.module!.tasks.map(nodeTask);
    if (element.kind === 'task') return (element.task!.children || []).map(nodeTask);
    return [];
  }

  toggleTaskDone = async (node: TreeNode) => {
    if (node.kind !== 'task') return;
    const task = node.task!;
    const goingToDone = task.status !== 'done';

    if (goingToDone) {
      if (!allDescendantsDone(task)) {
        vscode.window.setStatusBarMessage(
          `You cannot mark “${task.title}” as done — it has unfinished subtasks.`,
          2500
        );
        return;
      }
      task.status = 'done';
    } else {
      task.status = 'todo';
    }

    const p = this.getProject();
    if (!p) return;
    await this.setProject(p);
    this.refresh();
  };
}

export interface TreeNode {
  kind: NodeKind | 'templatesRoot' | 'template' | 'templateModule' | 'templateTask';
  label: string;
  description?: string;
  tooltip?: string;
  project?: Project;
  module?: Module;
  task?: Task;
  template?: Template;
}

type NodeKind = 'project' | 'module' | 'task';

const nodeModule = (m: Module): TreeNode => {
  const fileCount = m.files?.length || 0;
  return {
    kind: 'module',
    label: m.name,
    description: `${countTasks(m)} tasks, ${fileCount} files`,
    module: m,
  };
};

const nodeTask = (t: Task): TreeNode => ({
  kind: 'task',
  label: t.title,
  description: t.status,
  tooltip: t.description,
  task: t,
});

const nodeTemplate = (tpl: Template): TreeNode => ({
  kind: 'template',
  label: tpl.name,
  description: tpl.description,
  template: tpl,
  tooltip: tpl.description,
});

const iconForTask = (status: TaskStatus) =>
  status === 'done'
    ? new vscode.ThemeIcon('check', COLOR.taskDone)
    : new vscode.ThemeIcon('circle-outline', COLOR.taskTodo);

const iconForTemplateTask = (status: TaskStatus) =>
  status === 'done'
    ? new vscode.ThemeIcon('pass', COLOR.templateTaskDone)
    : new vscode.ThemeIcon('circle-outline', COLOR.templateTaskTodo);

const countTasks = (m: Module) => {
  let n = 0;
  const walk = (ts: Task[]) => {
    for (const t of ts) {
      n++;
      if (t.children?.length) walk(t.children);
    }
  };
  walk(m.tasks);
  return n;
};

const stableId = (node: TreeNode): string => {
  if (node.kind === 'task' && node.task) return `task:${node.task.id}`;
  if (node.kind === 'module' && node.module) return `module:${node.module.id}`;
  if (node.kind === 'project' && node.project) return `project:${node.project.id}`;
  if (node.kind === 'template' && node.template) return `template:${node.template.id}`;
  return `${node.kind}:${node.label}`;
};

const allDescendantsDone = (t: Task): boolean =>
  !t.children?.length || t.children.every(c => c.status === 'done' && allDescendantsDone(c));
