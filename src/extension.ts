// path: src/extension.ts
import * as vscode from 'vscode';
import { PMExplorerProvider, TreeNode } from './projectTreeProvider';
import { PMProject } from './types';
import { PMStorage } from './storage';
import { counts } from './utils';
import { PMTemplate, instantiateTemplate } from './templates';

let statusItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<TreeNode>;

export async function activate(context: vscode.ExtensionContext) {
  const storage = new PMStorage(context);
  await storage.loadLastProjectIfAny();

  const provider = new PMExplorerProvider(
    () => storage.activeProject,
    async (p) => { storage.activeProject = p; await storage.saveActive(); updateStatusBar(p); }
  );

  // Komendy MUSZĄ być zarejestrowane przed tworzeniem widoku
  const cmdToggle = vscode.commands.registerCommand('pm.toggleTaskDone', async (node?: TreeNode) => {
    if (node?.kind === 'task') await provider.toggleTaskDone(node);
  });
  const cmdOpen = vscode.commands.registerCommand('pm.openProject', async () => {
    const p = await storage.openFromFile();
    if (!p) return;
    provider.refresh();
    await revealProjectRoot(p);
    updateStatusBar(storage.activeProject);
    vscode.window.setStatusBarMessage(`Wczytano projekt „${p.name}”.`, 2000);
  });
  const cmdStart = vscode.commands.registerCommand('pm.startFromTemplate', async (node?: any) => {
    const tpl: PMTemplate | undefined = node?.template as PMTemplate | undefined;
    if (!tpl) return;

    const name = (await vscode.window.showInputBox({
      title: `Start z szablonu: ${tpl.name}`,
      prompt: 'Nazwa projektu',
      value: tpl.name
    }))?.trim();
    if (!name) return;

    const project: PMProject = instantiateTemplate(tpl);
    project.name = name;

    const savedPath = await storage.createFromTemplateAndSave(project);
    provider.refresh();
    await revealProjectRoot(project);
    updateStatusBar(storage.activeProject);
    vscode.window.setStatusBarMessage(`Utworzono projekt „${name}” • ${savedPath}`, 3000);
  });

  context.subscriptions.push(cmdToggle, cmdOpen, cmdStart);

  // Widok
  vscode.window.registerTreeDataProvider('pmExplorer', provider);
  treeView = vscode.window.createTreeView('pmExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: false
  });
  context.subscriptions.push(treeView);

  // StatusBar
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
    statusItem.text = '$(briefcase) No Project';
    statusItem.tooltip = 'Brak aktywnego projektu';
    statusItem.show();
    return;
  }
  const c = counts(project);
  statusItem.text = `$(briefcase) ${project.name}  $(library)${c.modules}  $(list-ordered)${c.total}  ⏳${c.todo} ✅${c.done}`;
  statusItem.tooltip = project.description || 'Project';
  statusItem.show();
}
