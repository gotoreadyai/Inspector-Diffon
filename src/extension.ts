import * as vscode from 'vscode';
import { LLMFileTreeProvider } from './fileTreeProvider';
import { TaskInputPanel } from './taskInputPanel';
import { OperationsParser, OperationsExecutor } from './operations';
import { TaskManager } from './taskManager';
import { buildPrompt } from './promptBuilder';

const outputChannel = vscode.window.createOutputChannel('Inspector Diff');

let taskManager: TaskManager | null = null;
let taskInputPanel: TaskInputPanel | null = null;
let statusBarItem: vscode.StatusBarItem;

async function applyDiffCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Paste LLM response and select it');
    return;
  }

  // Check if there's an active task
  if (!taskManager?.getCurrentTask()) {
    vscode.window.showErrorMessage(
      'No active task. Use "Generate LLM Prompt" to start a task first'
    );
    return;
  }

  const text = editor.selection && !editor.selection.isEmpty
    ? editor.document.getText(editor.selection)
    : editor.document.getText();

  // Parse all operations
  const operations = OperationsParser.parse(text);
  
  if (operations.length === 0) {
    vscode.window.showErrorMessage('No valid operation blocks found');
    outputChannel.show();
    return;
  }

  // Show current task in status
  const currentTask = taskManager.getCurrentTask()!;
  vscode.window.setStatusBarMessage(
    `Applying to task: ${currentTask.name}`,
    3000
  );

  // Execute operations
  const executor = new OperationsExecutor(outputChannel);
  const { success, errors } = await executor.executeAll(operations);
  
  // Add to current task
  taskManager.addOperations(operations);
  const summary = taskManager.getTaskSummary();
  vscode.window.setStatusBarMessage(summary, 5000);
  updateStatusBar();
  taskInputPanel?.updateView();

  // Show results
  if (success > 0 && errors === 0) {
    vscode.window.showInformationMessage(
      `Applied ${success} operations to "${currentTask.name}"`,
      'Commit Task',
      'Continue Task'
    ).then(selection => {
      if (selection === 'Commit Task' && taskManager) {
        taskManager.commitTask();
      }
    });
  } else if (errors > 0) {
    vscode.window.showWarningMessage(
      `Applied ${success} operations, ${errors} errors - check Output`,
      'Undo Task',
      'View Output'
    ).then(selection => {
      if (selection === 'Undo Task' && taskManager) {
        taskManager.undoTask();
      } else if (selection === 'View Output') {
        outputChannel.show();
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  
  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'llmDiff.showTaskHistory';
  context.subscriptions.push(statusBarItem);
  
  // Initialize task manager if workspace is open
  if (rootPath) {
    taskManager = new TaskManager(rootPath, outputChannel);
    updateStatusBar();
    
    // Create webview provider for task input
    taskInputPanel = new TaskInputPanel(
      context.extensionUri,
      taskManager,
      (name: string, description: string) => {
        // Callback when task is created from panel
        const existingTask = taskManager?.findTaskByName(name);
        if (existingTask) {
          taskManager?.setCurrentTask(existingTask);
        } else {
          taskManager?.startTask(name, description);
        }
        updateStatusBar();
        taskInputPanel?.updateView();
      }
    );
    
    // Register webview provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        TaskInputPanel.viewType,
        taskInputPanel
      )
    );
    
    // Tree view for file selection
    const treeProvider = new LLMFileTreeProvider(rootPath);
    
    const treeView = vscode.window.createTreeView('llmDiffFiles', {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
      canSelectMany: false
    });

    // Tree view commands
    context.subscriptions.push(
      vscode.commands.registerCommand('llmDiff.toggleFile', (file) =>
        treeProvider.toggleFileSelection(file)
      ),
      vscode.commands.registerCommand('llmDiff.onItemClicked', (file) => {
        treeProvider.toggleFileSelection(file);
      }),
      vscode.commands.registerCommand('llmDiff.setGlobPattern', async () => {
        const pattern = await vscode.window.showInputBox({
          prompt: 'Enter file pattern (glob)',
          value: 'src/**/*.{ts,tsx,js,jsx}',
          placeHolder: 'e.g. src/**/*.ts'
        });
        if (pattern) {
          await treeProvider.setGlobPattern(pattern);
        }
      }),
      vscode.commands.registerCommand('llmDiff.generatePromptFromPanel', async (taskName: string, taskDescription: string) => {
        const selected = treeProvider.getSelectedFiles();
        if (selected.length === 0) {
          vscode.window.showWarningMessage('Select files in the Files panel first');
          return;
        }
        
        // Create or switch task
        const existingTask = taskManager?.findTaskByName(taskName);
        if (existingTask) {
          taskManager?.setCurrentTask(existingTask);
        } else {
          taskManager?.startTask(taskName, taskDescription);
        }
        updateStatusBar();
        taskInputPanel?.updateView();

        const promptText = await buildPrompt(taskDescription, selected, taskName);

        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: promptText,
        });
        await vscode.window.showTextDocument(doc);
        await vscode.env.clipboard.writeText(promptText);
        
        vscode.window.showInformationMessage(`Prompt copied (Task: ${taskName})`);
      }),
      vscode.commands.registerCommand('llmDiff.generatePrompt', async () => {
        // This command now just focuses the panel
        vscode.commands.executeCommand('llmDiffTaskInput.focus');
        vscode.window.showInformationMessage('Enter task details in the Task Details panel');
      })
    );
  }

  // Main commands
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.insertDiff', applyDiffCommand),
    
    vscode.commands.registerCommand('llmDiff.switchTask', async () => {
      if (!taskManager) return;
      
      const tasks = taskManager.loadRecentTasks(20);
      if (tasks.length === 0) {
        vscode.window.showInformationMessage('No tasks found. Start a new task by generating a prompt.');
        return;
      }
      
      const items = tasks.map(t => ({
        label: t.name,
        description: t.status === 'applied' ? '$(circle-filled) Active' : t.status,
        detail: `${t.operations.length} operations, ${t.affectedFiles.length} files affected`,
        task: t
      }));
      
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select task to switch to'
      });
      
      if (selected) {
        taskManager.setCurrentTask(selected.task);
        updateStatusBar();
        taskInputPanel?.updateView();
        vscode.window.showInformationMessage(`Switched to task: ${selected.task.name}`);
      }
    }),
    
    vscode.commands.registerCommand('llmDiff.startTask', async () => {
      if (!taskManager) return;
      
      const name = await vscode.window.showInputBox({
        prompt: 'Enter task name',
        placeHolder: 'e.g., Refactor auth module'
      });
      
      if (name) {
        taskManager.startTask(name);
        vscode.window.showInformationMessage(`Started task: ${name}`);
      }
    }),
    
    vscode.commands.registerCommand('llmDiff.commitTask', () => {
      taskManager?.commitTask();
    }),
    
    vscode.commands.registerCommand('llmDiff.undoTask', () => {
      taskManager?.undoTask();
    }),
    
    vscode.commands.registerCommand('llmDiff.showTaskActions', async () => {
      if (!taskManager?.getCurrentTask()) {
        vscode.window.showWarningMessage('No active task');
        return;
      }
      
      const action = await vscode.window.showQuickPick(
        ['Commit Task', 'Undo Task', 'Switch Task', 'Cancel'],
        { placeHolder: 'Select action for current task' }
      );
      
      switch (action) {
        case 'Commit Task':
          await taskManager.commitTask();
          taskInputPanel?.updateView();
          break;
        case 'Undo Task':
          await taskManager.undoTask();
          taskInputPanel?.updateView();
          break;
        case 'Switch Task':
          vscode.commands.executeCommand('llmDiff.switchTask');
          break;
      }
    }),
    
    vscode.commands.registerCommand('llmDiff.showTaskHistory', () => {
      if (!taskManager) return;
      
      const tasks = taskManager.loadRecentTasks();
      const items = tasks.map(t => ({
        label: t.name,
        description: `${t.status} - ${new Date(t.createdAt).toLocaleDateString()}`,
        detail: `${t.operations.length} operations on ${t.affectedFiles.length} files`
      }));
      
      vscode.window.showQuickPick(items, {
        placeHolder: 'Recent tasks'
      });
    })
  );
}

function updateStatusBar() {
  const currentTask = taskManager?.getCurrentTask();
  if (currentTask) {
    statusBarItem.text = `$(git-branch) Task: ${currentTask.name}`;
    statusBarItem.tooltip = taskManager?.getTaskSummary() || '';
    statusBarItem.show();
  } else {
    statusBarItem.text = `$(git-branch) No active task`;
    statusBarItem.tooltip = 'Click to view task history';
    statusBarItem.show();
  }
}

export function deactivate() {
  outputChannel.dispose();
  statusBarItem?.dispose();
}