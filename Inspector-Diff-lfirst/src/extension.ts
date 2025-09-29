// path: src/extension.ts
import * as vscode from 'vscode';
import { LLMFileTreeProvider } from './fileTreeProvider';
import { TaskManager } from './taskManager';
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

  // Widoki: Files + Task Info (bez webview Task)
  const views: vscode.Disposable[] = [];

  const filesTreeView = vscode.window.createTreeView('llmDiffFiles', {
    treeDataProvider: fileTree,
    showCollapseAll: true,
    canSelectMany: true
  });
  views.push(filesTreeView);

  const taskInfoView = vscode.window.createTreeView('llmDiffTaskInfo', {
    treeDataProvider: taskInfo,
    showCollapseAll: false
  });
  views.push(taskInfoView);

  // Referencja do TreeView i reakcja na zmianę zaznaczenia
  fileTree.setTreeView(filesTreeView);
  filesTreeView.onDidChangeSelection(e => {
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
    if (e.selection.length > 0) {
      vscode.window.setStatusBarMessage(`Zaznaczono: ${e.selection.length} plików`, 1500);
    }
  });

  // Rejestr komend
  const commandRegistry = new CommandRegistry({
    fileTree,
    taskManager,
    taskInfo,
    outputChannel
  });
  commandRegistry.registerAll(context.subscriptions);

  // Komenda do tworzenia zadania (zastępuje formularz z panelu)
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.createTask', async () => {
      const name = (await vscode.window.showInputBox({
        prompt: 'Nazwa zadania',
        placeHolder: 'Task'
      }))?.trim();
      if (!name) return;

      const description = (await vscode.window.showInputBox({
        prompt: 'Opis (opcjonalnie)',
        placeHolder: 'Krótki opis zmian'
      }))?.trim();

      taskManager.startTask(name, description);
      taskInfo.refresh();
      vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
      vscode.window.showInformationMessage(`Utworzono zadanie „${name}”.`);
    })
  );

  // Terminal UI
  let terminalInstance: vscode.Terminal | undefined;
  let pty: LLMDiffTerminal | undefined;

  const openTerminal = () => {
    if (terminalInstance) {
      terminalInstance.show(true);
      return;
    }
    pty = new LLMDiffTerminal(taskManager);
    terminalInstance = vscode.window.createTerminal({ name: 'LLM Diff', pty });
    pty.attach?.(terminalInstance);
    terminalInstance.show(true);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.openTerminal', openTerminal),
    { dispose: () => terminalInstance?.dispose() }
  );

  // Subskrypcje i inicjalizacja
  context.subscriptions.push(...views, outputChannel);

  taskInfo.refresh();
  vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
}

export function deactivate() {}
