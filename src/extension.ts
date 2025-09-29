import * as vscode from 'vscode';
import * as path from 'path';
import { UnifiedTreeProvider } from './project-manager/TreeProvider';
import { instantiateTemplate, loadTemplates, ProjectStore } from './project-manager/storage';
import { Module, Project, Task, Template } from './project-manager/types';
import { PMTerminal } from './llm-terminal/terminal';
import { buildMilestonePrompt, buildContinuationPrompt, buildAddFilesPrompt } from './llm-terminal/promptBuilder';
import { OperationsParser, OperationsExecutor } from './llm-terminal/operations';

let treeView: vscode.TreeView<any>;
let statusBar: vscode.StatusBarItem;
let provider: UnifiedTreeProvider;
let store: ProjectStore;
let outputChannel: vscode.OutputChannel;
let terminalInstance: vscode.Terminal | undefined;
let pty: PMTerminal | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage('Open a workspace to use Project Manager');
    return;
  }

  // Initialize
  store = new ProjectStore(context);
  await store.loadLast();

  outputChannel = vscode.window.createOutputChannel('Project Manager');
  context.subscriptions.push(outputChannel);

  provider = new UnifiedTreeProvider(root.fsPath, () => store.getActive(), context);
  
  // Load templates
  const templates = await loadTemplates();
  provider.setTemplates(templates);

  // Watch templates
  const templatePattern = new vscode.RelativePattern(root, '.inspector-diff/templates/*.json');
  const watcher = vscode.workspace.createFileSystemWatcher(templatePattern);
  watcher.onDidCreate(async () => provider.setTemplates(await loadTemplates()));
  watcher.onDidChange(async () => provider.setTemplates(await loadTemplates()));
  watcher.onDidDelete(async () => provider.setTemplates(await loadTemplates()));
  context.subscriptions.push(watcher);

  // Tree view
  treeView = vscode.window.createTreeView('pmExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBar);
  updateStatus();

  // Context
  await vscode.commands.executeCommand('setContext', 'pm.hasActiveProject', !!store.getActive());

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pm.openProject', async () => {
      const project = await store.openFromFile();
      if (!project) return;
      
      provider.setActiveModule(null);
      provider.refresh();
      updateStatus();
      await vscode.commands.executeCommand('setContext', 'pm.hasActiveProject', true);
      vscode.window.setStatusBarMessage(`✓ Loaded project "${project.name}"`, 2000);
    }),

    vscode.commands.registerCommand('pm.startFromTemplate', async (template: Template) => {
      if (!template) return;

      const name = await vscode.window.showInputBox({
        title: `Start from template: ${template.name}`,
        prompt: 'Project name',
        value: template.name
      });

      if (!name?.trim()) return;

      const project = instantiateTemplate(template, name.trim());
      const path = await store.saveAs(project, name.trim());
      
      provider.setActiveModule(null);
      provider.refresh();
      updateStatus();
      await vscode.commands.executeCommand('setContext', 'pm.hasActiveProject', true);
      vscode.window.setStatusBarMessage(`✓ Created project "${name}" • ${path}`, 3000);
    }),

    vscode.commands.registerCommand('pm.selectModule', async (module: Module) => {
      provider.setActiveModule(module);
      updateStatus();
      
      const count = module.files.length;
      const msg = count > 0 
        ? `Selected module "${module.name}" with ${count} file${count === 1 ? '' : 's'}`
        : `Selected module "${module.name}" (no files yet)`;
      vscode.window.setStatusBarMessage(msg, 2000);
    }),

    vscode.commands.registerCommand('pm.toggleTask', async (task: Task) => {
      if (!task) return;
      
      const goingToDone = task.status !== 'done';
      
      if (goingToDone && task.children?.some(c => c.status !== 'done')) {
        vscode.window.setStatusBarMessage(
          `⚠ Cannot mark "${task.title}" as done - it has unfinished subtasks`,
          2500
        );
        return;
      }

      task.status = goingToDone ? 'done' : 'todo';
      await store.save();
      provider.refresh();
      updateStatus();
    }),

    vscode.commands.registerCommand('pm.toggleFile', async (uri: vscode.Uri) => {
      if (!uri) return;
      
      const project = store.getActive();
      if (!project) {
        vscode.window.showWarningMessage('No active project');
        return;
      }

      const module = provider.getActiveModule();
      if (!module) {
        vscode.window.showWarningMessage('Select a module first');
        return;
      }

      const wasSelected = provider.toggleFileSelection(uri.fsPath);
      await store.save();
      
      const fileName = path.basename(uri.fsPath);
      const msg = wasSelected 
        ? `✓ Added "${fileName}" to module "${module.name}"`
        : `✗ Removed "${fileName}" from module "${module.name}"`;
      vscode.window.setStatusBarMessage(msg, 2000);
      
      updateStatus();
    }),

    vscode.commands.registerCommand('pm.openTerminal', () => {
      if (terminalInstance) {
        terminalInstance.show(true);
        return;
      }

      pty = new PMTerminal(store, provider);
      terminalInstance = vscode.window.createTerminal({
        name: 'Project Manager',
        pty
      });
      pty.attach(terminalInstance);
      terminalInstance.show(true);
    }),

    vscode.commands.registerCommand('pm.sendPrompt', async (continuation?: string) => {
      const project = store.getActive();
      const module = provider.getActiveModule();

      if (!project) {
        vscode.window.showWarningMessage('No active project');
        return;
      }

      if (!module) {
        vscode.window.showWarningMessage('Select a milestone first');
        return;
      }

      const prompt = continuation
        ? await buildContinuationPrompt(project, module, continuation)
        : await buildMilestonePrompt(project, module);

      await showPrompt('Milestone Prompt', prompt);
    }),

    vscode.commands.registerCommand('pm.addFiles', async () => {
      const project = store.getActive();
      const module = provider.getActiveModule();

      if (!project || !module) {
        vscode.window.showWarningMessage('No active project or module');
        return;
      }

      const selected = provider.getSelectedFiles();
      if (selected.length === 0) {
        vscode.window.showInformationMessage('No files selected');
        return;
      }

      const selectedRel = selected.map(f => vscode.workspace.asRelativePath(f));
      const newFiles = selectedRel.filter(f => !module.files.includes(f));

      if (newFiles.length === 0) {
        vscode.window.showInformationMessage('All selected files already in context');
        return;
      }

      module.files.push(...newFiles);
      await store.save();
      provider.refresh();
      updateStatus();

      const prompt = await buildAddFilesPrompt(module, newFiles);
      await showPrompt('Added Files Context', prompt);
    }),

    vscode.commands.registerCommand('pm.applyOperations', async (source: 'editor' | 'clipboard') => {
      const project = store.getActive();
      if (!project) {
        vscode.window.showWarningMessage('No active project');
        return;
      }

      let raw: string;
      if (source === 'clipboard') {
        raw = await vscode.env.clipboard.readText();
        if (!raw?.trim()) {
          vscode.window.showWarningMessage('Clipboard is empty');
          return;
        }
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No active editor');
          return;
        }
        raw = editor.document.getText();
      }

      const match = raw.match(/```([\s\S]*?)```/);
      const text = match ? match[1] : raw;

      let ops;
      try {
        ops = OperationsParser.parse(text);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to parse operations: ${e?.message || String(e)}`);
        return;
      }

      if (ops.length === 0) {
        vscode.window.showWarningMessage(`No operations found in ${source}`);
        return;
      }

      const executor = new OperationsExecutor(outputChannel);
      const result = await executor.executeAll(ops);

      if (source === 'editor') {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      }

      const sourceName = source === 'clipboard' ? 'clipboard' : 'editor';
      if (result.errors === 0) {
        vscode.window.showInformationMessage(`Applied ${result.success} operations from ${sourceName}`);
      } else {
        vscode.window.showWarningMessage(`Operations: ${result.success} OK, ${result.errors} errors. Check Output.`);
        outputChannel.show();
      }
    })
  );
}

export function deactivate() {}

function updateStatus() {
  const project = store.getActive();
  const module = provider.getActiveModule();
  const fileCount = provider.getSelectedFiles().length;

  if (!project) {
    statusBar.text = '$(package) No Project';
    statusBar.tooltip = 'Click to open a project';
    statusBar.show();
    return;
  }

  const counts = countAll(project);
  const summary = `${counts.modules} modules • ${counts.total} tasks (⏳${counts.todo} ✅${counts.done})`;
  
  if (module) {
    statusBar.text = `$(package) ${project.name} • $(milestone) ${module.name} • $(file) ${fileCount}`;
    statusBar.tooltip = `${project.name}\nModule: ${module.name}\nFiles: ${fileCount}\n\n${summary}`;
  } else {
    statusBar.text = `$(package) ${project.name}  ${summary}`;
    statusBar.tooltip = project.description || project.name;
  }
  
  statusBar.show();
}

function countAll(project: Project) {
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

async function showPrompt(title: string, content: string) {
  await vscode.env.clipboard.writeText(content);
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(`${title} — copied to clipboard`);
}