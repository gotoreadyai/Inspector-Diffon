import * as vscode from 'vscode';
import { PMModule, PMProject, PMTask, NodeKind, TaskStatus } from './types';
import { counts, ensureArrays } from './utils';
import { PMTemplate, templates } from './templates';

export class PMExplorerProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private getProject: () => PMProject | null, private setProject: (p: PMProject | null) => void) {}

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const collapsible =
      element.kind === 'project'
        ? vscode.TreeItemCollapsibleState.Expanded
        : element.kind === 'task' && !element.task?.children?.length
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed;

    const item = new vscode.TreeItem(element.label, collapsible);
    item.id = stableId(element);
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.icon;
    item.contextValue = element.kind;

    if (element.kind === 'task') {
      item.iconPath = iconForTask(element.task!.status);
      item.command = { command: 'pm.toggleTaskDone', title: 'Toggle done', arguments: [element] };
    }
    if (element.kind === 'template') item.iconPath = new vscode.ThemeIcon('rocket');
    if (element.kind === 'templatesRoot') item.iconPath = new vscode.ThemeIcon('symbol-structure');

    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const p = this.getProject();
    const nodes: TreeNode[] = [];

    if (!element) {
      nodes.push({ kind: 'templatesRoot', label: 'Templates', icon: new vscode.ThemeIcon('symbol-structure') });
      if (p) {
        ensureArrays(p);
        const c = counts(p);
        nodes.push({
          kind: 'project',
          label: p.name,
          description: `${c.modules} modułów • ${c.total} zadań (⏳${c.todo} ✅${c.done})`,
          icon: new vscode.ThemeIcon('project'),
          project: p,
          tooltip: p.description || ''
        });
      }
      return nodes;
    }

    if (element.kind === 'templatesRoot') return templates.map(nodeTemplate);

    if (element.kind === 'template') {
      return element.template!.modules.map(m => ({
        kind: 'templateModule' as const,
        label: m.name,
        description: `${(m.tasks || []).length} zadań`,
        icon: new vscode.ThemeIcon('library'),
        template: element.template
      }));
    }

    if (element.kind === 'templateModule') {
      const mod = element.template!.modules.find(m => m.name === element.label);
      if (!mod) return [];
      return (mod.tasks || []).map(t => ({
        kind: 'templateTask' as const,
        label: t.title,
        description: (t.status as TaskStatus) || 'todo',
        icon: iconForTask((t.status as TaskStatus) || 'todo'),
        template: element.template
      }));
    }

    if (element.kind === 'project') return element.project!.modules.map(nodeModule);
    if (element.kind === 'module') return element.module!.tasks.map(nodeTask);
    if (element.kind === 'task') return (element.task!.children || []).map(nodeTask);
    return [];
  }

  toggleTaskDone = (node: TreeNode) => {
    if (node.kind !== 'task') return;

    const task = node.task!;
    const goingToDone = task.status !== 'done';

    if (goingToDone) {
      if (!allDescendantsDone(task)) {
        vscode.window.setStatusBarMessage(
          `Nie można oznaczyć „${task.title}” jako done — posiada niedokończone podzadania.`,
          2500
        );
        return;
      }
      task.status = 'done';
    } else {
      task.status = 'todo';
    }

    const p = this.getProject(); if (!p) return;
    this.setProject(p);
    this.refresh();
  };
}

export interface TreeNode {
  kind: NodeKind | 'templatesRoot' | 'template' | 'templateModule' | 'templateTask';
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  project?: PMProject;
  module?: PMModule;
  task?: PMTask;
  template?: PMTemplate;
}

function nodeModule(m: PMModule): TreeNode {
  return { kind: 'module', label: m.name, description: `${countTasks(m)} zadań`, icon: new vscode.ThemeIcon('library'), module: m };
}
function nodeTask(t: PMTask): TreeNode {
  return { kind: 'task', label: t.title, description: t.status, tooltip: t.description, icon: iconForTask(t.status), task: t };
}
function nodeTemplate(tpl: PMTemplate): TreeNode {
  return { kind: 'template', label: tpl.name, description: tpl.description, icon: new vscode.ThemeIcon('rocket'), template: tpl };
}
function iconForTask(status: TaskStatus) {
  return status === 'done'
    ? new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'))
    : new vscode.ThemeIcon('circle-large-outline');
}
function countTasks(m: PMModule) {
  let n = 0; const walk = (ts: PMTask[]) => { for (const t of ts) { n++; if (t.children?.length) walk(t.children); } }; walk(m.tasks); return n;
}
function stableId(node: TreeNode): string {
  if (node.kind === 'task' && node.task) return `task:${node.task.id}`;
  if (node.kind === 'module' && node.module) return `module:${node.module.id}`;
  if (node.kind === 'project' && node.project) return `project:${node.project.id}`;
  if (node.kind === 'template' && node.template) return `template:${node.template.id}`;
  return `${node.kind}:${node.label}`;
}
function allDescendantsDone(t: PMTask): boolean {
  if (!t.children || t.children.length === 0) return true;
  for (const c of t.children) {
    if (c.status !== 'done') return false;
    if (!allDescendantsDone(c)) return false;
  }
  return true;
}
