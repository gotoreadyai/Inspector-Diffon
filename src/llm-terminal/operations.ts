import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface FileOperation {
  type: 'create' | 'delete' | 'rename' | 'search-replace' | 'overwrite';
  file?: string;
  from?: string;
  to?: string;
  search?: string;
  replace?: string;
  content?: string;
}

const CREATE_RE = /<<<CREATE:\s*(.+?)>>>([\s\S]*?)<<<END>>>/g;
const DELETE_RE = /<<<DELETE:\s*(.+?)>>>[\s\S]*?<<<END>>>/g;
const RENAME_RE = /<<<RENAME:\s*(.+?)\s*->\s*(.+?)>>>[\s\S]*?<<<END>>>/g;
const SR_RE = /<<<FILE:\s*(.+?)>>>\s*<<<SEARCH>>>([\s\S]*?)<<<REPLACE>>>([\s\S]*?)<<<END>>>/g;
const OVERWRITE_RE = /<<<FILE:\s*(.+?)>>>((?:(?!<<<SEARCH>>>)[\s\S])*?)<<<END>>>/g;

export class OperationsParser {
  static parse(text: string): FileOperation[] {
    const ops: FileOperation[] = [];
    let m: RegExpExecArray | null;

    // Reset regex state
    CREATE_RE.lastIndex = 0;
    DELETE_RE.lastIndex = 0;
    RENAME_RE.lastIndex = 0;
    SR_RE.lastIndex = 0;
    OVERWRITE_RE.lastIndex = 0;

    while ((m = CREATE_RE.exec(text))) {
      ops.push({
        type: 'create',
        file: m[1].trim(),
        content: m[2].trim()
      });
    }

    while ((m = DELETE_RE.exec(text))) {
      ops.push({
        type: 'delete',
        file: m[1].trim()
      });
    }

    while ((m = RENAME_RE.exec(text))) {
      ops.push({
        type: 'rename',
        from: m[1].trim(),
        to: m[2].trim()
      });
    }

    // Search/Replace (has priority over overwrite)
    while ((m = SR_RE.exec(text))) {
      ops.push({
        type: 'search-replace',
        file: m[1].trim(),
        search: m[2].trim(),
        replace: m[3].trim()
      });
    }

    // Overwrite (full file replacement - use sparingly!)
    while ((m = OVERWRITE_RE.exec(text))) {
      ops.push({
        type: 'overwrite',
        file: m[1].trim(),
        content: m[2].trim()
      });
    }

    return ops;
  }
}

export class OperationsExecutor {
  private workspaceRoot: string;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('No workspace folder open');
    this.workspaceRoot = root.fsPath;
    this.outputChannel = outputChannel;
  }

  private log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${ts}] ${msg}`);
  }

  async executeAll(operations: FileOperation[]): Promise<{
    success: number;
    errors: number;
    applied: FileOperation[];
  }> {
    let success = 0;
    let errors = 0;
    const applied: FileOperation[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Applying operations...',
        cancellable: false
      },
      async () => {
        for (const op of operations) {
          try {
            await this.executeOperation(op);
            success++;
            applied.push(op);
            this.log(`✓ ${op.type}: ${op.file || op.from || ''}`);
          } catch (e: any) {
            errors++;
            this.log(`✗ ${op.type}: ${e?.message || String(e)}`);
          }
        }
      }
    );

    return { success, errors, applied };
  }

  private async executeOperation(op: FileOperation): Promise<void> {
    switch (op.type) {
      case 'create':
        return this.create(op);
      case 'delete':
        return this.delete(op);
      case 'rename':
        return this.rename(op);
      case 'search-replace':
        return this.searchReplace(op);
      case 'overwrite':
        return this.overwrite(op);
    }
  }

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, relativePath);
    if (!resolved.startsWith(this.workspaceRoot + path.sep) && resolved !== this.workspaceRoot) {
      throw new Error(`Path outside workspace: ${relativePath}`);
    }
    return resolved;
  }

  private async create(op: FileOperation) {
    if (!op.file || op.content === undefined) {
      throw new Error('CREATE requires file path and content');
    }

    const filePath = this.resolvePath(op.file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Check if file exists
    try {
      await fs.access(filePath);
      const answer = await vscode.window.showWarningMessage(
        `File ${op.file} already exists. Overwrite?`,
        'Yes',
        'No'
      );
      if (answer !== 'Yes') {
        throw new Error(`File ${op.file} already exists`);
      }
    } catch {
      // File doesn't exist, proceed
    }

    await fs.writeFile(filePath, op.content, 'utf8');
  }

  private async delete(op: FileOperation) {
    if (!op.file) {
      throw new Error('DELETE requires file path');
    }

    const filePath = this.resolvePath(op.file);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File ${op.file} does not exist`);
    }

    await fs.unlink(filePath);
  }

  private async rename(op: FileOperation) {
    if (!op.from || !op.to) {
      throw new Error('RENAME requires from and to paths');
    }

    const fromPath = this.resolvePath(op.from);
    const toPath = this.resolvePath(op.to);

    try {
      await fs.access(fromPath);
    } catch {
      throw new Error(`Source file ${op.from} does not exist`);
    }

    try {
      await fs.access(toPath);
      throw new Error(`Destination file ${op.to} already exists`);
    } catch {
      // Destination doesn't exist, proceed
    }

    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
  }

  private async searchReplace(op: FileOperation) {
    if (!op.file || !op.search || op.replace === undefined) {
      throw new Error('SEARCH/REPLACE requires file, search, and replace');
    }

    const filePath = this.resolvePath(op.file);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File ${op.file} does not exist`);
    }

    const content = await fs.readFile(filePath, 'utf8');

    if (!content.includes(op.search)) {
      throw new Error(`Search text not found in ${op.file}`);
    }

    const newContent = content.split(op.search).join(op.replace);
    await fs.writeFile(filePath, newContent, 'utf8');
  }

  private async overwrite(op: FileOperation) {
    if (!op.file || op.content === undefined) {
      throw new Error('OVERWRITE requires file path and content');
    }

    const filePath = this.resolvePath(op.file);

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File ${op.file} does not exist`);
    }

    await fs.writeFile(filePath, op.content, 'utf8');
  }
}