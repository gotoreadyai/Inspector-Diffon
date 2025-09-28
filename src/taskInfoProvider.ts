import * as vscode from 'vscode';
import { TaskManager } from './taskManager';

interface InfoNode {
  label: string;
  description: string;
  icon: string;
  command?: string;
}

export class TaskInfoProvider implements vscode.TreeDataProvider<InfoNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InfoNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private taskManager: TaskManager | null) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setTaskManager(taskManager: TaskManager) {
    this.taskManager = taskManager;
    this.refresh();
  }

  getTreeItem(element: InfoNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.description = element.description;
    item.tooltip = `${element.label}: ${element.description}`;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    
    if (element.command) {
      item.command = {
        command: element.command,
        title: element.label
      };
    }
    
    return item;
  }

  getChildren(_element?: InfoNode): InfoNode[] {
    const task = this.taskManager?.getCurrentTask();
    
    if (!task) {
      // Brak zadania — pokaż CTA do utworzenia oraz skrót do Terminala
      return [
        {
          label: 'Brak aktywnego zadania',
          description: 'Utwórz nowe zadanie',
          icon: 'info',
          command: 'llmDiff.createTask'
        },
        {
          label: 'Otwórz Terminal LLM Diff',
          description: 'Pisanie promptów bezpośrednio w terminalu',
          icon: 'terminal',
          command: 'llmDiff.openTerminal'
        }
      ];
    }

    // Prosty, jednopoziomowy widok z akcjami
    const nodes: InfoNode[] = [];

    nodes.push({
      label: `Zadanie: ${task.name}`,
      description: `Status: ${task.status}`,
      icon: 'git-branch'
    });

    if ((task as any).description) {
      nodes.push({
        label: 'Opis',
        description: (task as any).description,
        icon: 'note'
      });
    }

    if (task.operations.length > 0) {
      const opCounts = new Map<string, number>();
      task.operations.forEach(op => {
        opCounts.set(op.type, (opCounts.get(op.type) || 0) + 1);
      });
      const summary = Array.from(opCounts.entries())
        .map(([type, count]) => `${count} × ${type}`)
        .join(', ');
      nodes.push({
        label: 'Operacje',
        description: summary,
        icon: 'edit'
      });
    }

    if (task.includedFiles.length > 0) {
      nodes.push({
        label: 'Pliki w kontekście',
        description: `${task.includedFiles.length} pl.`,
        icon: 'files'
      });
    }

    nodes.push(
      { label: 'Dodaj zaznaczone pliki', description: 'Z Explorera do kontekstu', icon: 'diff-added', command: 'llmDiff.addSelectedFilesToPrompt' },
      { label: 'Zastosuj z edytora i zamknij', description: 'Apply from editor & Close', icon: 'play', command: 'llmDiff.applyFromActiveEditorAndClose' },
      { label: 'Akcje (commit/undo)', description: 'Zatwierdź lub cofnij zmiany', icon: 'git-commit', command: 'llmDiff.showTaskActions' },
      { label: 'Zakończ zadanie', description: 'Wyczyść kontekst zadania', icon: 'trash', command: 'llmDiff.endTask' },
      { label: 'Otwórz Terminal LLM Diff', description: 'Pisanie promptów bezpośrednio w terminalu', icon: 'terminal', command: 'llmDiff.openTerminal' }
    );

    return nodes;
  }
}