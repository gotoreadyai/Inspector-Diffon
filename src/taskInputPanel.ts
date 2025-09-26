import * as vscode from 'vscode';
import { TaskManager } from './taskManager';

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
    webviewView.webview.html = this._html();

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.type) {
        case 'pre.createTask':
          this.onTaskCreated(data.name, data.description);
          break;
        case 'task.addFiles':
          vscode.commands.executeCommand('llmDiff.addSelectedFilesToPrompt');
          break;
        case 'task.sendChange':
          vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', data.continuation || '');
          break;
        case 'task.applyFromEditor':
          vscode.commands.executeCommand('llmDiff.applyFromActiveEditorAndClose');
          break;
        case 'task.end':
          vscode.commands.executeCommand('llmDiff.endTask');
          break;
      }
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

  private _html() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body {
    padding: 6px;
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: 11px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .hidden { display: none !important; }
  .hdr { font-weight: 700; margin-bottom: 4px; }
  .stat {
    border: 1px solid var(--vscode-badge-background);
    color: var(--vscode-foreground);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
  }
  .stats { display: flex; gap: 4px; margin: 6px 0; align-items: center; flex-wrap: wrap; }
  .actions { margin-left: auto; display: flex; gap: 4px; }
  input, textarea, button {
    font-size: 11px;
    font-family: var(--vscode-font-family);
  }
  input, textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border-radius: 2px;
    margin-bottom: 6px;
  }
  input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  button {
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    cursor: pointer;
    font-size: 11px;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }

  button:disabled {
    opacity: 1;
    color: var(--vscode-disabledForeground);
    background: repeating-linear-gradient(45deg, var(--vscode-input-background) 0 8px, rgba(0,0,0,0.06) 8px 16px);
    border: 1px dashed var(--vscode-disabledForeground);
    cursor: not-allowed;
  }

  .btn-primary {
    width: 100%;
    padding: 8px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-weight: 600;
  }
  .btn-small { padding: 4px 8px; font-size: 11px; }
  .btn-danger { padding: 4px 8px; background: var(--vscode-button-dangerBackground, var(--vscode-errorForeground)); color: var(--vscode-button-dangerForeground, var(--vscode-editor-background)); font-size: 11px; }

  .btn-row { display: flex; gap: 6px; }
</style>
</head>
<body>
  <div id="pre">
    <div class="hdr">New task</div>
    <input id="name" placeholder="Task name..." />
    <textarea id="desc" placeholder="Task description..."></textarea>
    <button class="btn-primary" onclick="preCreate()">Create</button>
  </div>

  <div id="taskBox" class="hidden">
    <div class="hdr"><span id="tname"></span></div>
    <div id="tdesc" style="opacity:.9;margin-bottom:6px;"></div>
    <div class="stats">
      <span class="stat" id="tstatus"></span>
      <span class="stat" id="tops">0 operations</span>
      <span class="stat" id="tfiles">0 files</span>
      <div class="actions">
        <button id="taskAdd" class="btn-small" onclick="taskAdd()">Add files</button>
        <button class="btn-danger" onclick="taskEnd()">Clear</button>
      </div>
    </div>

    <textarea id="cont" placeholder="Describe next change... (Ctrl+Enter to send)"></textarea>
    <div class="btn-row" style="margin-top:4px;">
      <button class="btn-primary" onclick="taskSend()">Send change</button>
      <button class="btn-small" onclick="taskApplyFromEditor()" title="Zastosuj operacje z aktywnego edytora i zamknij kartę">Apply from editor & Close</button>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  let addEnabled = false;

  function preCreate(){
    const n = (document.getElementById('name').value || 'Task').trim();
    const d = (document.getElementById('desc').value || '').trim();
    vscode.postMessage({type:'pre.createTask', name:n, description:d});
  }

  function taskAdd(){ if(!addEnabled) return; vscode.postMessage({type:'task.addFiles'}); }
  function taskSend(){
    const c = document.getElementById('cont').value;
    vscode.postMessage({type:'task.sendChange', continuation:c || ''});
    document.getElementById('cont').value = '';
  }
  function taskApplyFromEditor(){
    vscode.postMessage({type:'task.applyFromEditor'});
  }
  function taskEnd(){ vscode.postMessage({type:'task.end'}); }

  window.addEventListener('message', e => {
    const m = e.data;
    if(m.type==='updateTask'){
      const pre = document.getElementById('pre');
      const task = document.getElementById('taskBox');
      if(m.task){
        pre.classList.add('hidden'); task.classList.remove('hidden');
        document.getElementById('tname').textContent = m.task.name ? m.task.name : '';
        document.getElementById('tdesc').textContent = m.task.description || 'No description';
        document.getElementById('tstatus').textContent = m.task.status;
        document.getElementById('tops').textContent = (m.task.operations?.length||0)+' operations';
        document.getElementById('tfiles').textContent = (m.task.includedFiles?.length||0)+' files';
      } else {
        pre.classList.remove('hidden'); task.classList.add('hidden');
        setAddEnabled(false);
        document.getElementById('name').value='';
        document.getElementById('desc').value='';
      }
    } else if(m.type==='setAddFilesEnabled'){
      setAddEnabled(!!m.enabled);
    }
  });

  function setAddEnabled(v){
    addEnabled = v;
    const btn = document.getElementById('taskAdd');
    btn.disabled = !v;
    btn.title = v ? '' : 'Wybierz pliki w Explorerze, aby dodać';
  }

  document.addEventListener('keydown',(e)=>{
    if(e.ctrlKey && e.key==='Enter'){
      const task=document.getElementById('taskBox');
      if(!task.classList.contains('hidden')) taskSend();
    }
  });
</script>
</body>
</html>`;
  }
}
