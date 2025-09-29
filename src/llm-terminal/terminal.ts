import * as vscode from 'vscode';
import { ProjectStore } from '../project-manager/storage';
import { UnifiedTreeProvider } from '../project-manager/TreeProvider';

export class PMTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  onDidClose?: vscode.Event<void> = this.closeEmitter.event;

  private buffer = '';
  private term?: vscode.Terminal;

  // Command history - limited to 10 entries
  private history: string[] = [];
  private historyIndex: number = -1;
  private tempBuffer: string = '';
  private readonly MAX_HISTORY = 10;

  // ANSI color codes
  private readonly ansi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    fg: {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
    },
  };

  private style(text: string, ...codes: string[]) {
    return codes.join('') + text + this.ansi.reset;
  }

  private prompt = this.style('pm> ', this.ansi.fg.cyan, this.ansi.bold);

  constructor(
    private store: ProjectStore,
    private provider: UnifiedTreeProvider
  ) {}

  attach(term: vscode.Terminal) {
    this.term = term;
  }

  open(): void {
    this.println(this.style('🎯 Project Manager Terminal', this.ansi.fg.blue, this.ansi.bold));
    this.println(this.style('Type /help for commands', this.ansi.dim));
    this.println('');
    this.printPrompt();
  }

  close(): void {
    this.closeEmitter.fire();
  }

  handleInput(data: string): void {
    // Handle arrow keys and other escape sequences
    if (data === '\x1b[A') {
      // Arrow up
      this.navigateHistory(-1);
      return;
    }
    
    if (data === '\x1b[B') {
      // Arrow down
      this.navigateHistory(1);
      return;
    }

    if (data === '\x1b[C') {
      // Arrow right - execute /add
      this.println('');
      this.addFiles().finally(() => this.printPrompt());
      return;
    }

    if (data === '\x1b[D') {
      // Arrow left - execute /apply
      this.println('');
      this.applyOperations('editor').finally(() => this.printPrompt());
      return;
    }

    // Handle regular input
    for (const ch of data) {
      if (ch === '\r') {
        const line = this.buffer.trim();
        this.println('');
        
        // Add to history if not empty
        if (line) {
          this.history.push(line);
          
          // Keep only last 10 commands
          if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
          }
          
          this.historyIndex = this.history.length;
          this.tempBuffer = '';
        }
        
        this.buffer = '';
        this.runCommand(line).finally(() => this.printPrompt());
      } else if (ch === '\x7f') {
        // Backspace
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.write('\x1b[D \x1b[D');
        }
      } else if (ch >= ' ') {
        // Only printable characters
        this.buffer += ch;
        this.write(ch);
      }
    }
  }

  private navigateHistory(direction: number) {
    if (this.history.length === 0) return;

    // Save current buffer when first navigating
    if (this.historyIndex === this.history.length) {
      this.tempBuffer = this.buffer;
    }

    const newIndex = this.historyIndex + direction;

    // Bounds check
    if (newIndex < 0 || newIndex > this.history.length) return;

    this.historyIndex = newIndex;

    // Clear current line
    this.clearLine();

    // Get command from history or temp buffer
    if (this.historyIndex === this.history.length) {
      this.buffer = this.tempBuffer;
    } else {
      this.buffer = this.history[this.historyIndex];
    }

    // Redraw prompt and buffer
    this.write(this.prompt + this.buffer);
  }

  private clearLine() {
    // Move cursor to start of line, clear line, rewrite prompt
    this.write('\r\x1b[K');
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

  private async runCommand(line: string): Promise<void> {
    if (!line) return;

    // Commands start with /
    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.split(' ');
      const argStr = rest.join(' ').trim();

      switch (cmd) {
        case '/help':
          this.showHelp();
          break;

        case '/status':
          this.showStatus();
          break;

        case '/add':
          await this.addFiles();
          break;

        case '/apply':
          await this.applyOperations('editor');
          break;

        case '/applyc':
          await this.applyOperations('clipboard');
          break;

        case '/history':
          this.showHistory();
          break;

        default:
          this.warn(`Unknown command: ${cmd}`);
          this.info('Type /help for available commands');
          break;
      }
    } else {
      // Without /, treat as prompt continuation
      await this.sendPrompt(line);
    }
  }

  private showHelp() {
    const hdr = this.style('Available Commands:', this.ansi.bold);
    const cmd = (c: string) => this.style(c.padEnd(20), this.ansi.fg.cyan);
    const desc = (d: string) => this.style(d, this.ansi.fg.gray);

    this.println([
      hdr,
      `${cmd('(no prefix) text')} ${desc('Send prompt continuation')}`,
      `${cmd('/help')} ${desc('Show this help')}`,
      `${cmd('/status')} ${desc('Show project status')}`,
      `${cmd('/add')} ${desc('Add selected files to context (generates prompt)')}`,
      `${cmd('/apply')} ${desc('Apply from active editor & close')}`,
      `${cmd('/applyc')} ${desc('Apply from clipboard')}`,
      `${cmd('/history')} ${desc('Show last 10 commands')}`,
      '',
      this.style('Navigation:', this.ansi.bold),
      `${cmd('↑ / ↓')} ${desc('Navigate through command history')}`,
      `${cmd('→')} ${desc('Execute /add')}`,
      `${cmd('←')} ${desc('Execute /apply')}`,
    ].join('\n'));
  }

  private showHistory() {
    if (this.history.length === 0) {
      this.info('No commands in history');
      return;
    }

    this.println(this.style('Command History (last 10):', this.ansi.bold));
    this.history.forEach((cmd, i) => {
      this.println(`  ${this.style((i + 1).toString().padStart(3), this.ansi.fg.gray)}  ${cmd}`);
    });
  }

  private showStatus() {
    const project = this.store.getActive();
    const module = this.provider.getActiveModule();

    if (!project) {
      this.warn('No active project');
      return;
    }

    this.println(this.style(`Project: ${project.name}`, this.ansi.bold));
    if (module) {
      this.println(this.style(`Module: ${module.name}`, this.ansi.fg.cyan));
      this.println(`  Tasks: ${module.tasks.length}`);
      this.println(`  Files: ${module.files.length}`);
    } else {
      this.warn('No active module selected');
    }
  }

  private async sendPrompt(message: string) {
    const project = this.store.getActive();
    const module = this.provider.getActiveModule();

    if (!project) {
      this.err('No active project. Open a project first.');
      return;
    }

    if (!module) {
      this.err('No active module. Select a milestone first.');
      return;
    }

    try {
      await vscode.commands.executeCommand('pm.sendPrompt', message);
      this.ok('Prompt generated and copied to clipboard!');
    } catch (e: any) {
      this.err(`Error: ${e?.message || String(e)}`);
    }
  }

  private async addFiles() {
    try {
      await vscode.commands.executeCommand('pm.addFiles');
      this.ok('Files added to context! Prompt generated and copied to clipboard.');
    } catch (e: any) {
      this.err(`Error: ${e?.message || String(e)}`);
    }
  }

  private async applyOperations(source: 'editor' | 'clipboard') {
    try {
      await vscode.commands.executeCommand('pm.applyOperations', source);
      this.ok('Operations applied!');
    } catch (e: any) {
      this.err(`Error: ${e?.message || String(e)}`);
    }
  }
}