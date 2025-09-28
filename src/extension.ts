import * as vscode from 'vscode';
import { LLMFileTreeProvider } from './fileTreeProvider';
import { TaskManager } from './taskManager';
import { TaskInputPanel } from './taskInputPanel';
import { TaskInfoProvider } from './taskInfoProvider';
import { CommandRegistry } from './commands';
import { LLMDiffTerminal } from './terminal';

export function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage('Otwórz folder roboczy, aby korzystać z LLM Diff.');
    return;
  }

  // Core services
  const outputChannel = vscode.window.createOutputChannel('LLM Diff');
  const taskManager = new TaskManager(root.fsPath, outputChannel);
  const fileTree = new LLMFileTreeProvider(root.fsPath, context);
  const taskInfo = new TaskInfoProvider(taskManager);
  
  // Task panel with inline callback
  const taskPanel = new TaskInputPanel(root, taskManager, (name, description) => {
    taskManager.startTask(name, description);
    taskPanel.updateView();
    taskInfo.refresh();
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
    vscode.window.showInformationMessage(`Utworzono zadanie „${name}".`);
  });

  // Register views
  const views = [
    vscode.window.registerWebviewViewProvider('llmDiffTaskInput', taskPanel, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    
    vscode.window.createTreeView('llmDiffFiles', {
      treeDataProvider: fileTree,
      showCollapseAll: true,
      canSelectMany: true
    }),
    
    vscode.window.createTreeView('llmDiffTaskInfo', {
      treeDataProvider: taskInfo,
      showCollapseAll: false
    })
  ];

  // Set up tree view reference and selection listener
  const filesTreeView = views[1] as vscode.TreeView<any>;
  fileTree.setTreeView(filesTreeView);
  
  filesTreeView.onDidChangeSelection(e => {
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
    if (e.selection.length > 0) {
      vscode.window.setStatusBarMessage(`Zaznaczono: ${e.selection.length} plików`, 1500);
    }
  });

  // Register all commands through the registry
  const commandRegistry = new CommandRegistry({
    fileTree,
    taskManager,
    taskPanel,
    taskInfo,
    outputChannel
  });
  
  commandRegistry.registerAll(context.subscriptions);

  // Terminal UI
  let terminalInstance: vscode.Terminal | undefined;
  let pty: LLMDiffTerminal | undefined;

  const openTerminal = () => {
    if (terminalInstance) {
      terminalInstance.show(true);
      return;
    }
    pty = new LLMDiffTerminal(taskManager, taskPanel);
    terminalInstance = vscode.window.createTerminal({ name: 'LLM Diff', pty });
    // attach to pass terminal ref (opcjonalne)
    pty.attach(terminalInstance);
    terminalInstance.show(true);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.openTerminal', openTerminal),
    { dispose: () => terminalInstance?.dispose() }
  );
  
  // Add views to subscriptions
  context.subscriptions.push(...views, outputChannel);
  
  // Initialize UI
  taskPanel.updateView();
  vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
}

export function deactivate() {}