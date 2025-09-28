// path: src/commands/index.ts
import * as vscode from 'vscode';
import { LLMFileTreeProvider } from '../fileTreeProvider';
import { TaskManager } from '../taskManager';
import { buildFilesContextPrompt, buildChangeRequestPrompt } from '../promptBuilder';
import * as path from 'path';
import * as fsp from 'fs/promises';

type CommandHandler = (...args: any[]) => void | Promise<void>;

interface CommandContext {
  fileTree: LLMFileTreeProvider;
  taskManager: TaskManager;
  taskInfo: any; // TaskInfoProvider type
  outputChannel: vscode.OutputChannel;
}

export class CommandRegistry {
  private commands = new Map<string, CommandHandler>();
  
  constructor(private context: CommandContext) {
    this.registerCommands();
  }

  private registerCommands() {
    // File selection commands
    this.register('onItemClicked', (filePath: string) => 
      this.context.fileTree.toggleFileSelection(filePath)
    );
    
    this.register('refresh', async () => {
      await this.context.fileTree.refresh();
      vscode.window.setStatusBarMessage('Odświeżono listę plików', 2000);
    });
    
    this.register('selectAll', () => this.context.fileTree.selectAll());
    this.register('deselectAll', () => this.context.fileTree.deselectAll());
    
    this.register('selectFolder', async (folderArg?: string) => {
      const folder = folderArg ?? await vscode.window.showInputBox({
        prompt: 'Podaj ścieżkę folderu (relatywnie do workspace)',
        placeHolder: 'src/components'
      });
      if (folder) this.context.fileTree.selectFolder(folder);
    });
    
    this.register('setGlobPattern', async () => {
      const pattern = await vscode.window.showInputBox({
        prompt: 'Wzorzec wyszukiwania plików',
        value: 'src/**/*.{ts,tsx,js,jsx}'
      });
      if (pattern) await this.context.fileTree.setGlobPattern(pattern);
    });
    
    // Selection sets
    this.register('saveSelectionAsSet', async () => {
      const name = await vscode.window.showInputBox({ 
        prompt: 'Nazwa zestawu zaznaczeń', 
        placeHolder: 'MVP screens' 
      });
      if (name) this.context.fileTree.saveCurrentSet(name);
    });
    
    this.register('loadSelectionSet', async () => {
      const sets = this.context.fileTree.getSavedSets();
      if (!sets.length) {
        vscode.window.showInformationMessage('Brak zapisanych zestawów.');
        return;
      }
      const picked = await vscode.window.showQuickPick(sets, { 
        title: 'Wczytaj zestaw zaznaczeń' 
      });
      if (picked) this.context.fileTree.loadSet(picked);
    });
    
    // Task operations
    this.register('addSelectedFilesToPrompt', () => this.addSelectedFiles());
    this.register('sendChangeRequestPrompt', (continuation: string) => this.sendChangeRequest(continuation));
    this.register('applyFromClipboard', () => this.applyOperations('clipboard'));
    this.register('applyFromActiveEditorAndClose', () => this.applyOperations('editor'));
    this.register('endTask', () => this.endTask());
    this.register('showTaskActions', () => this.showTaskActions());
    this.register('notifySelectionChanged', () => this.notifySelectionChanged());
  }

  private register(name: string, handler: CommandHandler) {
    this.commands.set(`llmDiff.${name}`, handler);
  }

  public registerAll(subscriptions: vscode.Disposable[]) {
    for (const [cmd, handler] of this.commands) {
      subscriptions.push(
        vscode.commands.registerCommand(cmd, handler)
      );
    }
  }

  // Extracted command implementations
  private async addSelectedFiles() {
    const task = this.context.taskManager.getCurrentTask();
    if (!task) {
      vscode.window.showWarningMessage('Najpierw utwórz zadanie.');
      return;
    }

    const selected = this.context.fileTree.getSelectedFiles();
    if (!selected.length) {
      vscode.window.showInformationMessage('Najpierw zaznacz pliki.');
      return;
    }

    const selectedRel = selected.map((u: vscode.Uri) => vscode.workspace.asRelativePath(u));
    const newRel = this.context.taskManager.getNewFiles(selectedRel);
    
    if (!newRel.length) {
      vscode.window.showInformationMessage('Brak nowych plików do dodania (w zadaniu).');
      return;
    }

    const newUris = selected.filter((u: vscode.Uri) => newRel.includes(vscode.workspace.asRelativePath(u)));
    const prompt = await buildFilesContextPrompt(newUris, 'Te pliki zostają dodane do kontekstu rozmowy (zadanie).');

    this.context.taskManager.addIncludedFiles(newRel);
    this.context.taskInfo.refresh();

    await this.showPrompt('Files Context Prompt', prompt);
  }

  private async sendChangeRequest(continuation: string) {
    const task = this.context.taskManager.getCurrentTask();
    if (!task) {
      vscode.window.showWarningMessage('Brak aktywnego zadania.');
      return;
    }
    const prompt = await buildChangeRequestPrompt(task, continuation);
    await this.showPrompt('Change Request Prompt', prompt);
  }

  private async applyOperations(source: 'clipboard' | 'editor') {
    const { OperationsParser, OperationsExecutor } = await import('../operations');
    const task = this.context.taskManager.getCurrentTask();
    
    if (!task) {
      vscode.window.showWarningMessage('Najpierw utwórz zadanie.');
      return;
    }

    let raw: string;
    if (source === 'clipboard') {
      raw = await vscode.env.clipboard.readText();
      if (!raw?.trim()) {
        vscode.window.showWarningMessage('Schowek jest pusty.');
        return;
      }
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Brak aktywnego edytora.');
        return;
      }
      raw = editor.document.getText();
    }

    const m = raw.match(/```([\s\S]*?)```/);
    const text = m ? m[1] : raw;

    let ops;
    try {
      ops = OperationsParser.parse(text);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Nie można sparsować operacji: ${e?.message ?? e}`);
      return;
    }

    if (!ops.length) {
      vscode.window.showWarningMessage(`Nie znaleziono bloków operacji w ${source === 'clipboard' ? 'schowku' : 'aktywnym edytorze'}.`);
      return;
    }

    const executor = new OperationsExecutor(this.context.outputChannel);
    const result = await executor.executeAll(ops);
    
    if (result.applied.length) {
      this.context.taskManager.addOperations(result.applied);
    }

    this.context.taskInfo.refresh();

    if (source === 'editor') {
      const res = await this.archiveAndFinalizeEditors();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      if (res.archived > 0) {
        const parts = [
          `Archiwizacja: ${res.archived}`,
          res.saved ? `Zapisano: ${res.saved}` : '',
          res.reverted ? `Zamknięto (untitled): ${res.reverted}` : '',
          `→ ${res.folder}`
        ].filter(Boolean).join(' | ');
        vscode.window.showInformationMessage(parts);
      }
    }

    const sourceName = source === 'clipboard' ? 'schowka' : 'aktywnego edytora';
    if (result.errors === 0) {
      vscode.window.showInformationMessage(`Zastosowano ${result.success} operacji z ${sourceName}.`);
    } else {
      vscode.window.showWarningMessage(`Operacje: ${result.success} OK, ${result.errors} błędów. Sprawdź Output: "LLM Diff".`);
    }
  }

  private async endTask() {
    this.context.taskManager.clearCurrentTask();
    this.context.taskInfo.refresh();
    vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
    vscode.window.showInformationMessage('Zadanie zakończone.');
  }

  private async showTaskActions() {
    const task = this.context.taskManager.getCurrentTask();
    if (!task) {
      vscode.window.showInformationMessage('Brak aktywnego zadania.');
      return;
    }

    const picked = await vscode.window.showQuickPick([
      { label: '$(git-commit) Zatwierdź w git', action: 'commit' },
      { label: '$(discard) Cofnij zmiany (hard reset)', action: 'undo' },
      { label: '$(output) Otwórz Output', action: 'output' }
    ], { title: `Akcje dla: ${task.name}` });

    if (!picked) return;

    switch (picked.action) {
      case 'commit':
        try {
          await this.context.taskManager.commitTask();
          this.context.taskInfo.refresh();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Nie można zatwierdzić: ${e?.message ?? e}`);
        }
        break;
      case 'undo':
        try {
          await this.context.taskManager.undoTask();
          this.context.taskInfo.refresh();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Nie można cofnąć: ${e?.message ?? e}`);
        }
        break;
      case 'output':
        this.context.outputChannel.show(true);
        break;
    }
  }

  private async notifySelectionChanged() {
    // Brak panelu: nie musimy nic przełączać; pozostawiamy ewentualnie future hook.
    return;
  }

  /**
   * Archiwizuje wszystkie niezapisane karty do folderu taska i ustawia stan „zapisane”.
   *  - Pliki z dysku: zapisuje do oryginalnej lokalizacji (document.save()).
   *  - Untitled/inne schematy: po archiwizacji wykonuje revert & close (bez promptu).
   * Zwraca statystyki do komunikatu.
   */
  private async archiveAndFinalizeEditors(): Promise<{ archived: number; saved: number; reverted: number; folder: string }> {
    const task = this.context.taskManager.getCurrentTask();
    if (!task) {
      vscode.window.showWarningMessage('Brak aktywnego zadania — pomijam archiwizację kart.');
      return { archived: 0, saved: 0, reverted: 0, folder: '' };
    }

    const docs = vscode.workspace.textDocuments.filter(d => d.isDirty);
    if (docs.length === 0) return { archived: 0, saved: 0, reverted: 0, folder: '' };

    const taskRoot = this.context.taskManager.getTaskDir(task);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(taskRoot, 'captures', stamp);

    let archived = 0, saved = 0, reverted = 0;

    // 1) Archiwizacja
    for (const doc of docs) {
      let rel: string;
      if (doc.uri.scheme === 'file') {
        const relPath = vscode.workspace.asRelativePath(doc.uri, false);
        rel = relPath || path.basename(doc.uri.fsPath);
      } else {
        const ext = doc.languageId ? `.${doc.languageId}` : '.txt';
        rel = path.join('untitled', `${archived + 1}${ext}`);
      }

      const target = path.join(base, rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, doc.getText(), 'utf8');
      archived++;
    }

    // 2) Finalizacja (zapis albo zamknięcie bez pytania)
    for (const doc of docs) {
      try {
        if (doc.uri.scheme === 'file') {
          const ok = await doc.save(); // po tym doc powinien być „czysty”
          if (ok) saved++;
          else {
            // w razie niepowodzenia: bezpiecznie zamknij bez zapisu
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
            reverted++;
          }
        } else {
          // Untitled / inne schematy: nie wywołujemy Save As — po archiwizacji zamykamy bez promptu
          await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
          await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
          reverted++;
        }
      } catch {
        // Awaryjnie zamknij bez zapisu (po archiwizacji mamy kopię)
        try {
          await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
          await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
          reverted++;
        } catch { /* ignoruj */ }
      }
    }

    return { archived, saved, reverted, folder: base };
  }

  private async showPrompt(title: string, content: string) {
    await vscode.env.clipboard.writeText(content);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(`${title} — skopiowano do schowka.`);
  }
}