// path: src/terminal.ts
import * as vscode from 'vscode';
import { TaskManager } from './taskManager';

export class LLMDiffTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  onDidClose?: vscode.Event<void> = this.closeEmitter.event;

  private buffer = '';
  private prompt = 'llm-diff> ';
  private term?: vscode.Terminal;

  constructor(private taskManager: TaskManager) {}

  public attach(term: vscode.Terminal) {
    this.term = term;
  }

  open(): void {
    this.println('LLM Diff Terminal — wpisz /help');
    this.printPrompt();
  }

  close(): void {
    this.closeEmitter.fire();
  }

  handleInput(data: string): void {
    for (const ch of data) {
      if (ch === '\r') {
        const line = this.buffer.trim();
        this.println('');
        this.buffer = '';
        this.runCommand(line).finally(() => this.printPrompt());
      } else if (ch === '\x7f') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.write('\x1b[D \x1b[D'); // backspace
        }
      } else {
        this.buffer += ch;
        this.write(ch);
      }
    }
  }

  private printPrompt() {
    this.write(this.prompt);
  }

  private write(s: string) {
    this.writeEmitter.fire(s.replace(/\n/g, '\r\n'));
  }

  private println(s: string) {
    this.writeEmitter.fire((s + '\n').replace(/\n/g, '\r\n'));
  }

  // Każdy wpis bez "/" jest traktowany jako prompt (alias /send).
  private async runCommand(line: string): Promise<void> {
    if (!line) return;

    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.split(' ');
      const argStr = rest.join(' ').trim();

      switch (cmd) {
        case '/help':
          this.println([
            'Dostępne komendy:',
            '  (bez prefixu) dowolny tekst   — WYŚLE prompt (alias /send)',
            '  /help                         — ta pomoc',
            '  /task "Nazwa" | opis...       — utwórz/ustaw zadanie',
            '  /send Tekst kontynuacji...    — wyślij Change Request Prompt',
            '  /add                          — dodaj zaznaczone pliki do kontekstu',
            '  /apply                        — apply from active editor & Close',
            '  /applyc                       — apply from clipboard',
            '  /end                          — zakończ zadanie',
            '  /status                       — podsumowanie zadania',
          ].join('\n'));
          break;

        case '/task': {
          // format: /task "Nazwa" | opcjonalny opis
          const m =
            argStr.match(/^\s*"([^"]+)"\s*(?:\|\s*(.*))?$/) ||
            argStr.match(/^\s*([^|]+?)\s*(?:\|\s*(.*))?$/);
          const name = m?.[1]?.trim();
          const desc = m?.[2]?.trim();
          if (!name) {
            this.println('Użycie: /task "Nazwa" | opis');
            break;
          }
          this.taskManager.startTask(name, desc);
          await vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
          this.println(`OK: aktywne zadanie „${name}”${desc ? ` — ${desc}` : ''}`);
          break;
        }

        case '/send': {
          const continuation = argStr;
          await vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', continuation || '');
          this.println('Skopiowano „Change Request Prompt” i otwarto edytor.');
          break;
        }

        case '/add': {
          await vscode.commands.executeCommand('llmDiff.addSelectedFilesToPrompt');
          this.println('Dodano zaznaczone pliki do kontekstu.');
          break;
        }

        case '/apply': {
          await vscode.commands.executeCommand('llmDiff.applyFromActiveEditorAndClose');
          this.println('Zastosowano operacje z aktywnego edytora.');
          break;
        }

        case '/applyc': {
          await vscode.commands.executeCommand('llmDiff.applyFromClipboard');
          this.println('Zastosowano operacje ze schowka.');
          break;
        }

        case '/end': {
          await vscode.commands.executeCommand('llmDiff.endTask');
          this.println('Zadanie zakończone.');
          break;
        }

        case '/status': {
          const s = this.taskManager.getTaskSummary();
          this.println(s);
          break;
        }

        default: {
          // Fallback: każdy nierozpoznany wpis (nawet z prefiksem) → prompt
          const continuation = line.startsWith('/') ? line.slice(1).trim() : line;
          await vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', continuation);
          this.println('Prompt wysłany (Change Request Prompt otwarty i skopiowany).');
          break;
        }
      }
      return;
    }

    // Bez prefixu "/" → domyślnie prompt
    const continuation = line;
    await vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', continuation);
    this.println('Prompt wysłany (Change Request Prompt otwarty i skopiowany).');
  }
}
