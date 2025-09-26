// path: src/taskManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileOperation } from './operations';

export interface Task {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  operations: FileOperation[];
  status: 'pending' | 'applied' | 'committed' | 'undone';
  affectedFiles: string[];
  includedFiles: string[];
}

export class TaskManager {
  private currentTask: Task | null = null;
  private tasksDir: string;
  private outputChannel: vscode.OutputChannel;

  constructor(workspaceRoot: string, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.tasksDir = path.join(workspaceRoot, '.inspector-diff', 'tasks');
    this.ensureTasksDir();
  }

  private ensureTasksDir() {
    if (!fs.existsSync(this.tasksDir)) fs.mkdirSync(this.tasksDir, { recursive: true });
  }

  startTask(name: string, description?: string): Task {
    const existing = this.findTaskByName(name);
    if (existing) {
      if (description && !existing.description) { existing.description = description; this.saveTask(existing); }
      this.currentTask = existing;
      return existing;
    }
    const task: Task = {
      id: Date.now().toString(),
      name,
      description,
      createdAt: new Date(),
      operations: [],
      status: 'pending',
      affectedFiles: [],
      includedFiles: []
    };
    this.currentTask = task; this.saveTask(task);
    return task;
  }

  findTaskByName(name: string): Task | null {
    const tasks = this.loadRecentTasks(100);
    return tasks.find(t => t.name === name) || null;
  }

  setCurrentTask(task: Task) { this.currentTask = task; }
  getCurrentTask(): Task | null { return this.currentTask; }
  clearCurrentTask() { this.currentTask = null; }

  addIncludedFiles(filePaths: string[]) {
    if (!this.currentTask) throw new Error('No active task');
    for (const file of filePaths) {
      if (!this.currentTask.includedFiles.includes(file)) this.currentTask.includedFiles.push(file);
    }
    this.saveTask(this.currentTask);
  }

  getNewFiles(selectedFiles: string[]): string[] {
    if (!this.currentTask || !this.currentTask.includedFiles) return selectedFiles;
    return selectedFiles.filter(f => !this.currentTask!.includedFiles.includes(f));
  }

  clearIncludedFiles() {
    if (!this.currentTask) throw new Error('No active task');
    this.currentTask.includedFiles = [];
    this.saveTask(this.currentTask);
    vscode.window.showInformationMessage(`Wyczyszczono listę plików w kontekście zadania „${this.currentTask.name}”.`);
  }

  addOperations(operations: FileOperation[]) {
    if (!this.currentTask) throw new Error('No active task');
    this.currentTask.operations.push(...operations);
    for (const op of operations) {
      if (op.file && !this.currentTask.affectedFiles.includes(op.file)) this.currentTask.affectedFiles.push(op.file);
      if (op.from && !this.currentTask.affectedFiles.includes(op.from)) this.currentTask.affectedFiles.push(op.from);
      if (op.to && !this.currentTask.affectedFiles.includes(op.to)) this.currentTask.affectedFiles.push(op.to);
    }
    this.currentTask.status = 'applied';
    this.saveTask(this.currentTask);
  }

  async commitTask(): Promise<void> {
    if (!this.currentTask || this.currentTask.status !== 'applied') throw new Error('Brak zastosowanych zmian do zatwierdzenia.');
    const message = `Task: ${this.currentTask.name}`;
    const terminal = vscode.window.createTerminal('Git Commit');
    terminal.sendText(`git add .`);
    terminal.sendText(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    terminal.show();
    this.currentTask.status = 'committed';
    this.saveTask(this.currentTask);
    vscode.window.showInformationMessage(`Zadanie „${this.currentTask.name}” zostało zatwierdzone w git.`);
  }

  async undoTask(): Promise<void> {
    if (!this.currentTask || this.currentTask.status !== 'applied') throw new Error('Brak zastosowanych zmian do cofnięcia.');
    const answer = await vscode.window.showWarningMessage(`Cofnąć wszystkie zmiany z zadania „${this.currentTask.name}”? (git reset --hard HEAD)`, 'Tak', 'Nie');
    if (answer !== 'Tak') return;
    const terminal = vscode.window.createTerminal('Git Reset');
    terminal.sendText(`git reset --hard HEAD`);
    terminal.show();
    this.currentTask.status = 'undone';
    this.saveTask(this.currentTask);
    vscode.window.showInformationMessage(`Cofnięto zmiany z zadania „${this.currentTask.name}”.`);
  }

  private saveTask(task: Task) {
    const taskFile = path.join(this.tasksDir, `${task.id}.json`);
    if (!task.includedFiles) task.includedFiles = [];
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), 'utf8');
  }

  loadRecentTasks(count: number = 10): Task[] {
    if (!fs.existsSync(this.tasksDir)) return [];
    const files = fs.readdirSync(this.tasksDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, count);
    return files.map(file => {
      const content = fs.readFileSync(path.join(this.tasksDir, file), 'utf8');
      const task = JSON.parse(content) as Task;
      if (!task.includedFiles) task.includedFiles = [];
      return task;
    });
  }

  getTaskSummary(): string {
    if (!this.currentTask) return 'Brak aktywnego zadania';
    const opCounts = new Map<string, number>();
    for (const op of this.currentTask.operations) {
      opCounts.set(op.type, (opCounts.get(op.type) || 0) + 1);
    }
    const summary = Array.from(opCounts.entries()).map(([type, count]) => `${count} × ${type}`).join(', ');
    const filesInfo = this.currentTask.includedFiles.length > 0 ? ` | ${this.currentTask.includedFiles.length} plików w kontekście` : '';
    return `Zadanie: ${this.currentTask.name} — ${summary} (${this.currentTask.status})${filesInfo}`;
  }
}
