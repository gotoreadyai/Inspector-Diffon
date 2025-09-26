import * as vscode from 'vscode';
import { TaskManager } from './taskManager';

export class TaskInputPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'llmDiffTaskInput';
  
  private _view?: vscode.WebviewView;
  private _currentTask: any = null;
  
  constructor(
    private readonly _extensionUri: vscode.Uri,
    private taskManager: TaskManager | null,
    private onTaskCreated: (name: string, description: string) => void
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.type) {
        case 'createTask':
          this.handleCreateTask(data.name, data.description);
          break;
        case 'generatePrompt':
          vscode.commands.executeCommand('llmDiff.generatePromptFromPanel', data.name, data.description);
          break;
        case 'switchTask':
          vscode.commands.executeCommand('llmDiff.switchTask');
          break;
        case 'commitTask':
          vscode.commands.executeCommand('llmDiff.commitTask');
          break;
      }
    });

    // Update view when it becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateView();
      }
    });
  }

  private handleCreateTask(name: string, description: string) {
    if (!name) {
      vscode.window.showErrorMessage('Task name is required');
      return;
    }
    
    this.onTaskCreated(name, description);
    this.updateView();
  }

  public updateView() {
    if (this._view) {
      const currentTask = this.taskManager?.getCurrentTask();
      this._view.webview.postMessage({ 
        type: 'updateTask', 
        task: currentTask 
      });
    }
  }

  private _getHtmlContent(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Task Input</title>
      <style>
        body {
          padding: 4px;
          margin: 0;
          font-family: var(--vscode-font-family);
          font-size: 11px;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        
        .current-task {
          background: var(--vscode-textBlockQuote-background);
          border-left: 2px solid var(--vscode-textLink-foreground);
          padding: 4px 6px;
          margin-bottom: 6px;
          font-size: 11px;
        }
        
        .current-task-header {
          color: var(--vscode-textLink-foreground);
          font-weight: bold;
          margin: 0;
          font-size: 11px;
        }
        
        .current-task-desc {
          margin: 2px 0 0 0;
          opacity: 0.8;
          font-size: 10px;
        }
        
        .stats {
          display: inline-flex;
          gap: 4px;
          margin-top: 2px;
        }
        
        .stat {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 0px 4px;
          border-radius: 2px;
          font-size: 10px;
        }
        
        input, textarea {
          width: 100%;
          padding: 3px 5px;
          margin-bottom: 4px;
          border: 1px solid #333;
          background: #1a1a1a;
          color: #cccccc;
          font-family: var(--vscode-font-family);
          font-size: 11px;
          box-sizing: border-box;
        }
        
        input::placeholder, textarea::placeholder {
          color: #666;
          opacity: 1;
        }
        
        input {
          height: 22px;
        }
        
        textarea {
          min-height: 50px;
          max-height: 80px;
          resize: vertical;
        }
        
        input:focus, textarea:focus {
          outline: 1px solid var(--vscode-focusBorder);
          border-color: var(--vscode-focusBorder);
          background: #0d0d0d;
        }
        
        button {
          width: 100%;
          padding: 4px;
          margin-bottom: 3px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          cursor: pointer;
          font-size: 11px;
          font-weight: bold;
        }
        
        button:hover {
          background: var(--vscode-button-hoverBackground);
        }
        
        .button-row {
          display: flex;
          gap: 3px;
        }
        
        .button-row button {
          flex: 1;
        }
        
        .secondary-button {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          font-weight: normal;
        }
        
        .secondary-button:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .divider {
          border-top: 1px solid var(--vscode-panel-border);
          margin: 4px 0;
        }
        
        /* Dark theme overrides */
        @media (prefers-color-scheme: dark) {
          input, textarea {
            background: #0a0a0a;
            border-color: #2a2a2a;
          }
          input:focus, textarea:focus {
            background: #000000;
          }
        }
        
        /* Light theme adjustments */
        @media (prefers-color-scheme: light) {
          input, textarea {
            background: #f8f8f8;
            border-color: #d4d4d4;
            color: #333;
          }
          input:focus, textarea:focus {
            background: #ffffff;
          }
          input::placeholder, textarea::placeholder {
            color: #999;
          }
        }
      </style>
    </head>
    <body>
      <div id="current-task" class="current-task" style="display: none;">
        <div class="current-task-header" id="task-name"></div>
        <div class="current-task-desc" id="task-description"></div>
        <div class="stats">
          <span class="stat" id="task-status"></span>
          <span class="stat" id="task-operations"></span>
        </div>
      </div>

      <input type="text" id="task-name-input" placeholder="Task name..." />
      <textarea id="task-desc-input" placeholder="What needs to be done..."></textarea>

      <button onclick="generatePrompt()">🚀 Generate Prompt</button>
      
      <div class="divider"></div>
      
      <div class="button-row">
        <button class="secondary-button" onclick="switchTask()">Switch</button>
        <button class="secondary-button" onclick="commitTask()">Commit</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        
        function generatePrompt() {
          const name = document.getElementById('task-name-input').value;
          const description = document.getElementById('task-desc-input').value;
          
          if (!name) {
            document.getElementById('task-name-input').focus();
            return;
          }
          
          vscode.postMessage({
            type: 'generatePrompt',
            name: name,
            description: description
          });
        }
        
        function switchTask() {
          vscode.postMessage({ type: 'switchTask' });
        }
        
        function commitTask() {
          vscode.postMessage({ type: 'commitTask' });
        }
        
        // Listen for messages from extension
        window.addEventListener('message', event => {
          const message = event.data;
          
          if (message.type === 'updateTask' && message.task) {
            const task = message.task;
            document.getElementById('current-task').style.display = 'block';
            document.getElementById('task-name').textContent = task.name;
            document.getElementById('task-description').textContent = task.description || '';
            document.getElementById('task-status').textContent = task.status;
            
            if (task.operations && task.operations.length > 0) {
              document.getElementById('task-operations').textContent = task.operations.length + ' ops';
            } else {
              document.getElementById('task-operations').textContent = '0 ops';
            }
            
            // Update inputs with current task
            document.getElementById('task-name-input').value = task.name;
            document.getElementById('task-desc-input').value = task.description || '';
          } else if (message.type === 'updateTask' && !message.task) {
            document.getElementById('current-task').style.display = 'none';
            document.getElementById('task-name-input').value = '';
            document.getElementById('task-desc-input').value = '';
          }
        });
        
        // Allow Enter in task name to move to description
        document.getElementById('task-name-input').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('task-desc-input').focus();
          }
        });
        
        // Allow Ctrl+Enter to generate prompt
        document.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            generatePrompt();
          }
        });
      </script>
    </body>
    </html>`;
  }
}