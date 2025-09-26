// path: src/extension.ts
import * as vscode from 'vscode';
import { LLMFileTreeProvider } from './fileTreeProvider';
import { TaskManager } from './taskManager';
import { buildFilesContextPrompt, buildChangeRequestPrompt } from './promptBuilder';
import { TaskInfoProvider } from './taskInfoProvider';

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel('LLM Diff');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage('Otwórz folder roboczy, aby korzystać z LLM Diff.');
    return;
  }

  // ——— Core ———
  const taskManager = new TaskManager(root.fsPath, out);
  const fileTree = new LLMFileTreeProvider(root.fsPath, context);
  const taskInfo = new TaskInfoProvider(taskManager);

  // Panel wejściowy
  const taskPanelProvider = new (require('./taskInputPanel').TaskInputPanel)(
    root,
    taskManager,
    async (name: string, description: string) => {
      const task = taskManager.startTask(name, description);
      taskPanelProvider.updateView();
      vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
      vscode.window.showInformationMessage(`Utworzono zadanie „${task.name}”.`);
      taskInfo.refresh();
    }
  );

  // Widoki
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('llmDiffTaskInput', taskPanelProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const filesTreeView = vscode.window.createTreeView('llmDiffFiles', {
    treeDataProvider: fileTree,
    showCollapseAll: true
  });
  context.subscriptions.push(filesTreeView);

  const taskInfoView = vscode.window.createTreeView('llmDiffTaskInfo', {
    treeDataProvider: taskInfo,
    showCollapseAll: false
  });
  context.subscriptions.push(taskInfoView);

  // Utility: pokaż prompt + schowek
  async function showPromptDoc(title: string, content: string) {
    await vscode.env.clipboard.writeText(content);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(`${title} — skopiowano do schowka.`);
  }

  // ========== KOMENDY ==========

  // Toggle w drzewku
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.onItemClicked', (item) => {
      fileTree.toggleFileSelection(item);
    })
  );

  // Szybkie akcje selekcji
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.selectAll', () => fileTree.selectAll()),
    vscode.commands.registerCommand('llmDiff.deselectAll', () => fileTree.deselectAll()),
    vscode.commands.registerCommand('llmDiff.selectFolder', async (folderArg?: string) => {
      // Jeśli przyszła ścieżka z kliknięcia w drzewku — użyj jej; w innym wypadku pokaż input
      const folder = folderArg ?? await vscode.window.showInputBox({
        prompt: 'Podaj ścieżkę folderu (relatywnie do workspace)',
        placeHolder: 'src/components'
      });
      if (folder) fileTree.selectFolder(folder);
    }),
    vscode.commands.registerCommand('llmDiff.setGlobPattern', async () => {
      const pat = await vscode.window.showInputBox({
        prompt: 'Wzorzec wyszukiwania plików',
        value: 'src/**/*.{ts,tsx,js,jsx}'
      });
      if (pat) await fileTree.setGlobPattern(pat);
    }),
    vscode.commands.registerCommand('llmDiff.saveSelectionAsSet', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Nazwa zestawu zaznaczeń', placeHolder: 'MVP screens' });
      if (name) fileTree.saveCurrentSet(name);
    }),
    vscode.commands.registerCommand('llmDiff.loadSelectionSet', async () => {
      const sets = fileTree.getSavedSets();
      if (sets.length === 0) {
        vscode.window.showInformationMessage('Brak zapisanych zestawów.');
        return;
      }
      const picked = await vscode.window.showQuickPick(sets, { title: 'Wczytaj zestaw zaznaczeń' });
      if (picked) fileTree.loadSet(picked);
    })
  );

  // Dodaj zaznaczone pliki do promptu — tylko w trybie „w zadaniu”
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.addSelectedFilesToPrompt', async () => {
      const task = taskManager.getCurrentTask();
      if (!task) {
        vscode.window.showWarningMessage('Najpierw utwórz zadanie.');
        return;
      }

      const selected = fileTree.getSelectedFiles();
      if (selected.length === 0) {
        vscode.window.showInformationMessage('Najpierw zaznacz pliki.');
        return;
      }

      const selectedRel = selected.map(u => vscode.workspace.asRelativePath(u));
      const newRel = taskManager.getNewFiles(selectedRel);
      if (newRel.length === 0) {
        taskPanelProvider.updateSetAddFilesEnabled(false);
        vscode.window.showInformationMessage('Brak nowych plików do dodania (w zadaniu).');
        return;
      }

      const newUris = selected.filter(u => newRel.includes(vscode.workspace.asRelativePath(u)));
      const prompt = await buildFilesContextPrompt(newUris, 'Te pliki zostają dodane do kontekstu rozmowy (zadanie).');

      taskManager.addIncludedFiles(newRel);
      taskPanelProvider.updateSetAddFilesEnabled(false);
      taskPanelProvider.updateView();
      taskInfo.refresh();

      await showPromptDoc('Files Context Prompt', prompt);
    })
  );

  // Zmiana selekcji -> włącz/wyłącz przyciski
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.notifySelectionChanged', async () => {
      const task = taskManager.getCurrentTask();
      const selected = fileTree.getSelectedFiles();
      const selectedRel = selected.map(u => vscode.workspace.asRelativePath(u));

      if (!task) {
        taskPanelProvider.updateSetAddFilesEnabled(false);
      } else {
        const newRel = taskManager.getNewFiles(selectedRel);
        taskPanelProvider.updateSetAddFilesEnabled(newRel.length > 0);
      }
    })
  );

  // Change request (w zadaniu)
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.sendChangeRequestPrompt', async (continuation: string) => {
      const task = taskManager.getCurrentTask();
      if (!task) { vscode.window.showWarningMessage('Brak aktywnego zadania.'); return; }
      const prompt = await buildChangeRequestPrompt(task, continuation);
      await showPromptDoc('Change Request Prompt', prompt);
    })
  );

  // Apply from clipboard
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.applyFromClipboard', async () => {
      const { OperationsParser, OperationsExecutor } = await import('./operations');
      const task = taskManager.getCurrentTask();
      if (!task) {
        vscode.window.showWarningMessage('Najpierw utwórz zadanie.');
        return;
      }

      const raw = await vscode.env.clipboard.readText();
      if (!raw?.trim()) {
        vscode.window.showWarningMessage('Schowek jest pusty.');
        return;
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
        vscode.window.showWarningMessage('Nie znaleziono bloków operacji w schowku.');
        return;
      }

      const executor = new OperationsExecutor(out);
      const result = await executor.executeAll(ops);
      if (result.applied.length) {
        taskManager.addOperations(result.applied);
      }
      taskPanelProvider.updateView();
      taskInfo.refresh();

      if (result.errors === 0) {
        vscode.window.showInformationMessage(`Zastosowano ${result.success} operacji.`);
      } else {
        vscode.window.showWarningMessage(`Operacje zakończone: ${result.success} sukcesów, ${result.errors} błędów. Sprawdź Output: "LLM Diff".`);
      }
    })
  );

  // 🔥 NOWE: Apply from Active Editor & Close
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.applyFromActiveEditorAndClose', async () => {
      const { OperationsParser, OperationsExecutor } = await import('./operations');
      const task = taskManager.getCurrentTask();
      if (!task) {
        vscode.window.showWarningMessage('Najpierw utwórz zadanie.');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Brak aktywnego edytora.');
        return;
      }

      const raw = editor.document.getText();
      if (!raw?.trim()) {
        vscode.window.showWarningMessage('Aktywny dokument jest pusty.');
        return;
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
        vscode.window.showWarningMessage('Nie znaleziono bloków operacji w aktywnym edytorze.');
        return;
      }

      const executor = new OperationsExecutor(out);
      const result = await executor.executeAll(ops);
      if (result.applied.length) {
        taskManager.addOperations(result.applied);
      }

      taskPanelProvider.updateView();
      taskInfo.refresh();

      // Zamknij aktywne okno edytora
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      if (result.errors === 0) {
        vscode.window.showInformationMessage(`Zastosowano ${result.success} operacji z aktywnego edytora.`);
      } else {
        vscode.window.showWarningMessage(`Operacje: ${result.success} OK, ${result.errors} błędów. Zajrzyj do Output: "LLM Diff".`);
      }
    })
  );

  // Koniec zadania
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.endTask', async () => {
      taskManager.clearCurrentTask();
      taskPanelProvider.updateView();
      taskInfo.refresh();
      vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
      vscode.window.showInformationMessage('Zadanie zakończone.');
    })
  );

  // Akcje zadania (commit/undo/output)
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.showTaskActions', async () => {
      const task = taskManager.getCurrentTask();
      if (!task) { vscode.window.showInformationMessage('Brak aktywnego zadania.'); return; }

      const picked = await vscode.window.showQuickPick(
        [
          { label: '$(git-commit) Zatwierdź w git', action: 'commit' },
          { label: '$(discard) Cofnij zmiany (hard reset)', action: 'undo' },
          { label: '$(output) Otwórz Output', action: 'output' }
        ],
        { title: `Akcje dla: ${task.name}` }
      );
      if (!picked) return;

      if (picked.action === 'commit') {
        try {
          await taskManager.commitTask();
          taskPanelProvider.updateView();
          taskInfo.refresh();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Nie można zatwierdzić: ${e?.message ?? e}`);
        }
      } else if (picked.action === 'undo') {
        try {
          await taskManager.undoTask();
          taskPanelProvider.updateView();
          taskInfo.refresh();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Nie można cofnąć: ${e?.message ?? e}`);
        }
      } else if (picked.action === 'output') {
        out.show(true);
      }
    })
  );

  // Stan początkowy
  taskPanelProvider.updateView();
  vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
}

export function deactivate() {}
