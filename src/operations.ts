import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface FileOperation {
  type: 'create' | 'delete' | 'rename' | 'search-replace';
  file?: string;
  from?: string;
  to?: string;
  search?: string;
  replace?: string;
  content?: string;
}

export class OperationsParser {
  static parse(text: string): FileOperation[] {
    const operations: FileOperation[] = [];
    
    // Parse CREATE blocks
    const createRegex = /<<<CREATE:\s*(.+?)>>>([\s\S]*?)<<<END>>>/g;
    let match;
    
    while ((match = createRegex.exec(text)) !== null) {
      operations.push({
        type: 'create',
        file: match[1].trim(),
        content: match[2].trim()
      });
    }
    
    // Parse DELETE blocks
    const deleteRegex = /<<<DELETE:\s*(.+?)>>>[\s\S]*?<<<END>>>/g;
    text.replace(deleteRegex, (_, file) => {
      operations.push({
        type: 'delete',
        file: file.trim()
      });
      return '';
    });
    
    // Parse RENAME blocks
    const renameRegex = /<<<RENAME:\s*(.+?)\s*->\s*(.+?)>>>[\s\S]*?<<<END>>>/g;
    text.replace(renameRegex, (_, from, to) => {
      operations.push({
        type: 'rename',
        from: from.trim(),
        to: to.trim()
      });
      return '';
    });
    
    // Parse SEARCH/REPLACE blocks (existing format)
    const searchReplaceRegex = /<<<FILE:\s*(.+?)>>>\s*<<<SEARCH>>>([\s\S]*?)<<<REPLACE>>>([\s\S]*?)<<<END>>>/g;
    text.replace(searchReplaceRegex, (_, file, search, replace) => {
      operations.push({
        type: 'search-replace',
        file: file.trim(),
        search: search.trim(),
        replace: replace.trim()
      });
      return '';
    });
    
    return operations;
  }
}

export class OperationsExecutor {
  private outputChannel: vscode.OutputChannel;
  private rootPath: string;
  
  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      throw new Error('No workspace folder open');
    }
    this.rootPath = root.fsPath;
  }
  
  private log(message: string) {
    this.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }
  
  async executeAll(operations: FileOperation[]): Promise<{ success: number; errors: number }> {
    let successCount = 0;
    let errorCount = 0;
    
    for (const op of operations) {
      try {
        await this.executeOperation(op);
        successCount++;
        this.log(`✓ ${op.type}: ${op.file || op.from}`);
      } catch (error: any) {
        errorCount++;
        this.log(`✗ ${op.type}: ${error.message}`);
      }
    }
    
    return { success: successCount, errors: errorCount };
  }
  
  private async executeOperation(op: FileOperation): Promise<void> {
    switch (op.type) {
      case 'create':
        await this.executeCreate(op);
        break;
      case 'delete':
        await this.executeDelete(op);
        break;
      case 'rename':
        await this.executeRename(op);
        break;
      case 'search-replace':
        await this.executeSearchReplace(op);
        break;
    }
  }
  
  private async executeCreate(op: FileOperation) {
    if (!op.file || op.content === undefined) {
      throw new Error('CREATE requires file path and content');
    }
    
    const filePath = path.join(this.rootPath, op.file);
    const dir = path.dirname(filePath);
    
    // Create directory if doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Check if file already exists
    if (fs.existsSync(filePath)) {
      const answer = await vscode.window.showWarningMessage(
        `File ${op.file} already exists. Overwrite?`,
        'Yes', 'No'
      );
      if (answer !== 'Yes') {
        throw new Error(`File ${op.file} already exists`);
      }
    }
    
    fs.writeFileSync(filePath, op.content, 'utf8');
  }
  
  private async executeDelete(op: FileOperation) {
    if (!op.file) {
      throw new Error('DELETE requires file path');
    }
    
    const filePath = path.join(this.rootPath, op.file);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File ${op.file} does not exist`);
    }
    
    fs.unlinkSync(filePath);
  }
  
  private async executeRename(op: FileOperation) {
    if (!op.from || !op.to) {
      throw new Error('RENAME requires from and to paths');
    }
    
    const fromPath = path.join(this.rootPath, op.from);
    const toPath = path.join(this.rootPath, op.to);
    
    if (!fs.existsSync(fromPath)) {
      throw new Error(`Source file ${op.from} does not exist`);
    }
    
    if (fs.existsSync(toPath)) {
      throw new Error(`Target file ${op.to} already exists`);
    }
    
    // Create target directory if needed
    const toDir = path.dirname(toPath);
    if (!fs.existsSync(toDir)) {
      fs.mkdirSync(toDir, { recursive: true });
    }
    
    fs.renameSync(fromPath, toPath);
  }
  
  private async executeSearchReplace(op: FileOperation) {
    if (!op.file || !op.search || op.replace === undefined) {
      throw new Error('SEARCH/REPLACE requires file, search and replace');
    }
    
    const filePath = path.join(this.rootPath, op.file);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File ${op.file} does not exist`);
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (!content.includes(op.search)) {
      throw new Error(`Text not found in ${op.file}`);
    }
    
    const newContent = content.replace(op.search, op.replace);
    fs.writeFileSync(filePath, newContent, 'utf8');
  }
}