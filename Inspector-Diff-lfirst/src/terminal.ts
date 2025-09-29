// path: src/terminal.ts
import * as vscode from 'vscode';
import { TaskManager } from './taskManager';

export class LLMDiffTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  onDidClose?: vscode.Event<void> = this.closeEmitter.event;

  private buffer = '';

  // ── ANSI utils ──────────────────────────────────────────────────────────────
  private readonly ansi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    underline: '\x1b[4m',
    fg: {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
    },
  };

  private style(txt: string, ...codes: string[]) {
    return codes.join('') + txt + this.ansi.reset;
  }

  private prompt = this.style('llm-diff> ', this.ansi.fg.cyan, this.ansi.bold);
  private term?: vscode.Terminal;

  constructor(private taskManager: TaskManager) {}

  public attach(term: vscode.Terminal) {
    this.term = term;
  }

  open(): void {
    this.println(this.style('LLM Diff Terminal — wpisz /help', this.ansi.fg.magenta, this.ansi.bold));
    this.printPrompt();
  }

  close(): void {
    this.closeEmitter.fire();
  }

  handleInput(data: string): void {
    for (const ch of data) {
      if (ch === '\r') {
        const line = this.buffer.trim();
        this.println(''); // przejście do nowej linii
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

  // Szybkie helpery do kolorowych komunikatów
  private info(s: string) {
    this.println(this.style(s, this.ansi.fg.blue));
  }
  private ok(s: string) {
    this.println(this.style(s, this.ansi.fg.green));
  }
  private warn(s: string) {
    this.println(this.style(s, this.ansi.fg.yellow));
  }
  private err(s: string) {
    this.println(this.style(s, this.ansi.fg.red, this.ansi.bold));
  }

  // (opcjonalnie) hyperlink OSC 8: text -> url
  private link(text: string, url: string) {
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  }

  // Każdy wpis bez "/" jest traktowany jako prompt (alias /send).
  private async runCommand(line: string): Promise<void> {
    if (!line) return;

    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.split(' ');
      const argStr = rest.join(' ').trim();

      switch (cmd) {
        case '/help': {
          const hdr = this.style('Dostępne komendy:', this.ansi.bold, this.ansi.underline);
          const cmdc = (c: string) => this.style(c.padEnd(28), this.ansi.fg.cyan);
          const desc = (d: string) => this.style(d, this.ansi.fg.gray);
          this.println([
            hdr,
            `${cmdc('(bez prefixu) dowolny tekst')} ${desc('— WYŚLE prompt (alias /send)')}`,
            `${cmdc('/help')} ${desc('— ta pomoc')}`,
            `${cmdc('/task "Nazwa" | opis...')} ${desc('— utwórz/ustaw zadanie')}`,
            `${cmdc('/send Tekst kontynuacji...')} ${desc('— wyślij Change Request Prompt')}`,
            `${cmdc('/add')} ${desc('— dodaj zaznaczone pliki do kontekstu')}`,
            `${cmdc('/apply')} ${desc('— apply from active editor & Close')}`,
            `${cmdc('/applyc')} ${desc('— apply from clipboard')}`,
            `${cmdc('/end')} ${desc('— zakończ zadanie')}`,
            `${cmdc('/status')} ${desc('— podsumowanie zadania')}`,
          ].join('\n'));
          // przyklad linku w terminalu (nie wszędzie działa, ale VS Code obsługuje)
          this.info(`Więcej: ${this.link('VS Code Terminal Colors', 'https://code.visualstudio.com/api/references/extension-guidelines#terminals')}`);
          break;
        }

        case '/task': {
          // format: /task "Nazwa" | opcjonalny opis
          const m =
            argStr.match(/^\s*"([^"]+)"\s*(?:\|\s*(.*))?$/) ||
            argStr.match(/^\s*([^|]+?)\s*(?:\|\s*(.*))?$/);
          const name = m?.[1]?.trim();
          const desc = m?.[2]?.trim();
          if (!name) {
            this.warn('Użycie: /task "Nazwa" | opis');
            break;
          }
          this.taskManager.startTask(name, desc);
          await vscode.commands.executeCommand('llmDiff.notifySelectionChanged');
          this.ok(`OK: aktywne zadanie „${name}”${desc ? ` — ${desc}` : ''}`);
          break;
        }

        case '/send': {
          const continuation = argStr;
          await vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', continuation || '');
          this.ok('Skopiowano „Change Request Prompt” i otwarto edytor.');
          break;
        }

        case '/add': {
          await vscode.commands.executeCommand('llmDiff.addSelectedFilesToPrompt');
          this.ok('Dodano zaznaczone pliki do kontekstu.');
          break;
        }

        case '/apply': {
          await vscode.commands.executeCommand('llmDiff.applyFromActiveEditorAndClose');
          this.ok('Zastosowano operacje z aktywnego edytora.');
          break;
        }

        case '/applyc': {
          await vscode.commands.executeCommand('llmDiff.applyFromClipboard');
          this.ok('Zastosowano operacje ze schowka.');
          break;
        }

        case '/end': {
          await vscode.commands.executeCommand('llmDiff.endTask');
          this.ok('Zadanie zakończone.');
          break;
        }

        case '/status': {
          const s = this.taskManager.getTaskSummary();
          this.println(this.style(s, this.ansi.fg.gray));
          break;
        }

        default: {
          // Fallback: każdy nierozpoznany wpis (nawet z prefiksem) → prompt
          const continuation = line.startsWith('/') ? line.slice(1).trim() : line;
          await vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', continuation);
          this.info('Prompt wysłany (Change Request Prompt otwarty i skopiowany).');
          break;
        }
      }
      return;
    }

    // Bez prefixu "/" → domyślnie prompt
    const continuation = line;
    await vscode.commands.executeCommand('llmDiff.sendChangeRequestPrompt', continuation);
    this.info('Prompt wysłany (Change Request Prompt otwarty i skopiowany).');
  }
}
