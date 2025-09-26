// path: src/operations.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fssync from 'fs';

export interface FileOperation {
  type: 'create' | 'delete' | 'rename' | 'search-replace';
  file?: string;
  from?: string;
  to?: string;
  search?: string;
  replace?: string;
  content?: string;
}

const CREATE_RE = /<<<CREATE:\s*(.+?)>>>([\s\S]*?)<<<END>>>/g;
const DELETE_RE = /<<<DELETE:\s*(.+?)>>>[\s\S]*?<<<END>>>/g;
const RENAME_RE  = /<<<RENAME:\s*(.+?)\s*->\s*(.+?)>>>[\s\S]*?<<<END>>>/g;
const SR_RE      = /<<<FILE:\s*(.+?)>>>\s*<<<SEARCH>>>([\s\S]*?)<<<REPLACE>>>([\s\S]*?)<<<END>>>/g;

export class OperationsParser {
  static parse(text: string): FileOperation[] {
    const ops: FileOperation[] = [];
    let m: RegExpExecArray | null;

    while ((m = CREATE_RE.exec(text))) ops.push({ type: 'create', file: m[1].trim(), content: m[2].trim() });
    while ((m = DELETE_RE.exec(text))) ops.push({ type: 'delete', file: m[1].trim() });
    while ((m = RENAME_RE.exec(text))) ops.push({ type: 'rename', from: m[1].trim(), to: m[2].trim() });
    while ((m = SR_RE.exec(text)))     ops.push({ type: 'search-replace', file: m[1].trim(), search: m[2].trim(), replace: m[3].trim() });

    return ops;
  }
}

export class OperationsExecutor {
  private out: vscode.OutputChannel;
  private root: string;

  constructor(out: vscode.OutputChannel) {
    this.out = out;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('No workspace folder open');
    this.root = root.fsPath;
  }

  private log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    this.out.appendLine(`[${ts}] ${msg}`);
  }

  async executeAll(operations: FileOperation[]): Promise<{ success: number; errors: number; applied: FileOperation[] }> {
    let success = 0, errors = 0;
    const applied: FileOperation[] = [];

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Zastosowywanie zmian…', cancellable: false },
      async () => {
        for (const op of operations) {
          try {
            await this.executeOperation(op);
            success++; applied.push(op);
            this.log(`✓ ${op.type}: ${op.file || op.from || ''}`);
          } catch (e: any) {
            errors++; this.log(`✗ ${op.type}: ${e?.message || String(e)}`);
          }
        }
      }
    );

    const summary = `Zakończono: ${success} sukcesów, ${errors} błędów.`;
    errors > 0 ? vscode.window.showWarningMessage(summary) : vscode.window.showInformationMessage(summary);
    return { success, errors, applied };
  }

  private async executeOperation(op: FileOperation): Promise<void> {
    switch (op.type) {
      case 'create':         return this.create(op);
      case 'delete':         return this.del(op);
      case 'rename':         return this.rename(op);
      case 'search-replace': return this.searchReplace(op);
    }
  }

  private resolveSafe(rel: string) {
    const p = path.resolve(this.root, rel);
    if (!(p === this.root || p.startsWith(this.root + path.sep))) throw new Error(`Ścieżka wychodzi poza workspace: ${rel}`);
    return p;
  }

  private async create(op: FileOperation) {
    if (!op.file || op.content === undefined) throw new Error('CREATE wymaga ścieżki i zawartości');
    const filePath = this.resolveSafe(op.file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (fssync.existsSync(filePath)) {
      const answer = await vscode.window.showWarningMessage(`Plik ${op.file} już istnieje. Nadpisać?`, 'Tak', 'Nie');
      if (answer !== 'Tak') throw new Error(`Plik ${op.file} już istnieje`);
    }
    await fs.writeFile(filePath, op.content, 'utf8');
  }

  private async del(op: FileOperation) {
    if (!op.file) throw new Error('DELETE wymaga ścieżki pliku');
    const filePath = this.resolveSafe(op.file);
    if (!fssync.existsSync(filePath)) throw new Error(`Plik ${op.file} nie istnieje`);
    await fs.unlink(filePath);
  }

  private async rename(op: FileOperation) {
    if (!op.from || !op.to) throw new Error('RENAME wymaga ścieżek from i to');
    const fromPath = this.resolveSafe(op.from);
    const toPath = this.resolveSafe(op.to);
    if (!fssync.existsSync(fromPath)) throw new Error(`Źródłowy plik ${op.from} nie istnieje`);
    if (fssync.existsSync(toPath)) throw new Error(`Docelowy plik ${op.to} już istnieje`);
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
  }

  private async searchReplace(op: FileOperation) {
    if (!op.file || !op.search || op.replace === undefined) throw new Error('SEARCH/REPLACE wymaga file, search i replace');
    const filePath = this.resolveSafe(op.file);
    if (!fssync.existsSync(filePath)) throw new Error(`Plik ${op.file} nie istnieje`);

    const content = await fs.readFile(filePath, 'utf8');
    if (!content.includes(op.search)) throw new Error(`Nie znaleziono tekstu w ${op.file}`);

    const newContent = content.split(op.search).join(op.replace);
    await fs.writeFile(filePath, newContent, 'utf8');
  }
}
