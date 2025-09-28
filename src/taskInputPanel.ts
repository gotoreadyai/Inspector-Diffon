import * as vscode from 'vscode';
import { TaskManager } from './taskManager';
import { WebViewBuilder, TaskPanelHTML } from './webview/builder';

export class TaskInputPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'llmDiffTaskInput';
  private _view?: vscode.WebviewView;
  private addFilesEnabled = false;

  constructor(
    _root: vscode.Uri,
    private taskManager: TaskManager | null,
    private onTaskCreated: (name: string, description: string) => void
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    
    // Use the WebView builder instead of inline HTML
    webviewView.webview.html = WebViewBuilder.build({
      title: 'Task Manager',
      body: TaskPanelHTML.body,
      scripts: TaskPanelHTML.scripts
    });

    // Message handling
    webviewView.webview.onDidReceiveMessage(data => {
      const handlers: Record<string, () => void> = {
        'pre.createTask': () => this.onTaskCreated(data.name, data.description),
        'task.addFiles': () => vscode.commands.executeCommand('llmDiff.addSelectedFilesToPrompt'),
        'task.sendChange': () => vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', data.continuation || ''),
        'task.applyFromEditor': () => vscode.commands.executeCommand('llmDiff.applyFromActiveEditorAndClose'),
        'task.end': () => vscode.commands.executeCommand('llmDiff.endTask')
      };
      
      handlers[data.type]?.();
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.updateView();
    });
  }

  public updateSetAddFilesEnabled(enabled: boolean) {
    this.addFilesEnabled = enabled;
    this._view?.webview.postMessage({ type: 'setAddFilesEnabled', enabled });
  }

  public updateView() {
    const task = this.taskManager?.getCurrentTask();
    this._view?.webview.postMessage({ type: 'updateTask', task });
  }
}