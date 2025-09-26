import * as vscode from 'vscode';
import { LLMFileTreeProvider } from './fileTreeProvider';
import { OperationsParser, OperationsExecutor } from './operations';
import { TaskManager } from './taskManager';
import { buildPrompt } from './promptBuilder';

const outputChannel = vscode.window.createOutputChannel('Inspector Diff');

let taskManager: TaskManager | null = null;

async function applyDiffCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Paste LLM response and select it');
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

  // Ask for task name if no active task
  if (!taskManager?.getCurrentTask()) {
    const taskName = await vscode.window.showInputBox({
      prompt: 'Enter task name (optional)',
      placeHolder: 'e.g., Refactor auth module'
    });
    
    if (taskName) {
      taskManager?.startTask(taskName);
    }
  }

  // Execute operations
  const executor = new OperationsExecutor(outputChannel);
  const { success, errors } = await executor.executeAll(operations);
  
  // Add to current task if exists
  if (taskManager?.getCurrentTask()) {
    taskManager.addOperations(operations);
    const summary = taskManager.getTaskSummary();
    vscode.window.setStatusBarMessage(summary, 5000);
  }

  // Show results
  if (success > 0 && errors === 0) {
    vscode.window.showInformationMessage(
      `Applied ${success} operations successfully!`,
      'Commit Task',
      'Continue'
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
  
  // Initialize task manager if workspace is open
  if (rootPath) {
    taskManager = new TaskManager(rootPath, outputChannel);
    
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
      vscode.commands.registerCommand('llmDiff.generatePrompt', async () => {
        const selected = treeProvider.getSelectedFiles();
        if (selected.length === 0) {
          vscode.window.showWarningMessage('Select files in Inspector Diff panel');
          return;
        }
        
        const task = await vscode.window.showInputBox({
          prompt: 'Describe the task',
        });
        if (!task) return;

        const promptText = await buildPrompt(task, selected);

        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: promptText,
        });
        await vscode.window.showTextDocument(doc);
        await vscode.env.clipboard.writeText(promptText);
        
        vscode.window.showInformationMessage('Prompt copied to clipboard');
      })
    );
  }

  // Main commands
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.insertDiff', applyDiffCommand),
    
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

export function deactivate() {
  outputChannel.dispose();
}