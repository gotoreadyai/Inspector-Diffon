import * as vscode from 'vscode';
import { PMExplorerProvider, TreeNode } from './projectTreeProvider';
import { PMProject } from './types';
import { PMStorage } from './storage';
import { counts } from './utils';
import { instantiateTemplate } from './templates';

let statusItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<TreeNode>;

export function activate(context: vscode.ExtensionContext) {
  const storage = new PMStorage(context);
  const provider = new PMExplorerProvider(
    () => storage.activeProject,
    (p) => { storage.activeProject = p; updateStatusBar(p); }
  );

  const cmdToggle = vscode.commands.registerCommand('pm.toggleTaskDone', (node?: TreeNode) => {
    if (node?.kind === 'task') provider.toggleTaskDone(node);
  });
  const cmdOpen = vscode.commands.registerCommand('pm.openProject', async () => {
    const p = await storage.openFromFile();
    if (!p) return;
    storage.activeProject = p;
    provider.refresh();
    await revealProjectRoot(p);
    vscode.window.setStatusBarMessage(`Wczytano projekt „${p.name}”.`, 2000);
  });
  const cmdStart = vscode.commands.registerCommand('pm.startFromTemplate', async (node?: any) => {
    const templateName: string | undefined = node?.template?.name;
    if (!templateName) return;
    const name = (await vscode.window.showInputBox({
      title: `Start z szablonu: ${templateName}`,
      prompt: 'Nazwa projektu',
      value: templateName
    }))?.trim();
    if (!name) return;

    const project: PMProject = instantiateTemplate(templateName);
    project.name = name;
    const savedPath = await storage.saveToWorkspaceFile(project);

    storage.activeProject = project;
    provider.refresh();
    await revealProjectRoot(project);

    vscode.window.setStatusBarMessage(`Utworzono projekt „${name}” • ${savedPath}`, 3000);
  });

  context.subscriptions.push(cmdToggle, cmdOpen, cmdStart);

  vscode.window.registerTreeDataProvider('pmExplorer', provider);
  treeView = vscode.window.createTreeView('pmExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: false
  });
  context.subscriptions.push(treeView);

  treeView.onDidChangeSelection(e => {
    const node = e.selection?.[0];
    if (node?.kind === 'task') vscode.commands.executeCommand('pm.toggleTaskDone', node);
  });

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusItem);
  updateStatusBar(storage.activeProject);
}

export function deactivate() {}

async function revealProjectRoot(project: PMProject) {
  try {
    const c = counts(project);
    const element = {
      kind: 'project',
      label: project.name,
      description: `${c.modules} modułów • ${c.total} zadań (⏳${c.todo} ✅${c.done})`,
      project
    } as any;
    await treeView.reveal(element, { expand: true, focus: true, select: true });
  } catch {}
}

function updateStatusBar(project: PMProject | null) {
  if (!project) {
    statusItem.text = '$(project) No Project';
    statusItem.tooltip = 'Brak aktywnego projektu';
    statusItem.show();
    return;
  }
  const c = counts(project);
  statusItem.text = `$(project) ${project.name}  $(library)${c.modules}  $(list-ordered)${c.total}  ⏳${c.todo} ✅${c.done}`;
  statusItem.tooltip = project.description || 'Project';
  statusItem.show();
}
