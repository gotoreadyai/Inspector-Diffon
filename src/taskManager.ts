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
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    }
  }
  
  startTask(name: string, description?: string): Task {
    // Check if task with this name already exists
    const existing = this.findTaskByName(name);
    if (existing) {
      if (description && !existing.description) {
        existing.description = description;
        this.saveTask(existing);
      }
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
      affectedFiles: []
    };
    
    this.currentTask = task;
    this.saveTask(task);
    return task;
  }
  
  findTaskByName(name: string): Task | null {
    const tasks = this.loadRecentTasks(100); // Load more to find by name
    return tasks.find(t => t.name === name) || null;
  }
  
  setCurrentTask(task: Task) {
    this.currentTask = task;
  }
  
  getCurrentTask(): Task | null {
    return this.currentTask;
  }
  
  addOperations(operations: FileOperation[]) {
    if (!this.currentTask) {
      throw new Error('No active task');
    }
    
    this.currentTask.operations.push(...operations);
    
    // Track affected files
    for (const op of operations) {
      if (op.file && !this.currentTask.affectedFiles.includes(op.file)) {
        this.currentTask.affectedFiles.push(op.file);
      }
      if (op.from && !this.currentTask.affectedFiles.includes(op.from)) {
        this.currentTask.affectedFiles.push(op.from);
      }
      if (op.to && !this.currentTask.affectedFiles.includes(op.to)) {
        this.currentTask.affectedFiles.push(op.to);
      }
    }
    
    this.currentTask.status = 'applied';
    this.saveTask(this.currentTask);
  }
  
  async commitTask(): Promise<void> {
    if (!this.currentTask || this.currentTask.status !== 'applied') {
      throw new Error('No applied task to commit');
    }
    
    const terminal = vscode.window.createTerminal('Git Commit');
    const message = `Task: ${this.currentTask.name}`;
    
    terminal.sendText(`git add .`);
    terminal.sendText(`git commit -m "${message}"`);
    terminal.show();
    
    this.currentTask.status = 'committed';
    this.saveTask(this.currentTask);
    
    vscode.window.showInformationMessage(`Task "${this.currentTask.name}" committed to git`);
  }
  
  async undoTask(): Promise<void> {
    if (!this.currentTask || this.currentTask.status !== 'applied') {
      throw new Error('No applied task to undo');
    }
    
    const answer = await vscode.window.showWarningMessage(
      `Undo all changes from task "${this.currentTask.name}"?`,
      'Yes', 'No'
    );
    
    if (answer !== 'Yes') {
      return;
    }
    
    const terminal = vscode.window.createTerminal('Git Reset');
    terminal.sendText(`git reset --hard HEAD`);
    terminal.show();
    
    this.currentTask.status = 'undone';
    this.saveTask(this.currentTask);
    
    vscode.window.showInformationMessage(`Task "${this.currentTask.name}" undone`);
  }
  
  private saveTask(task: Task) {
    const taskFile = path.join(this.tasksDir, `${task.id}.json`);
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), 'utf8');
  }
  
  loadRecentTasks(count: number = 10): Task[] {
    const files = fs.readdirSync(this.tasksDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, count);
    
    return files.map(file => {
      const content = fs.readFileSync(path.join(this.tasksDir, file), 'utf8');
      return JSON.parse(content) as Task;
    });
  }
  
  getTaskSummary(): string {
    if (!this.currentTask) {
      return 'No active task';
    }
    
    const opCounts = new Map<string, number>();
    for (const op of this.currentTask.operations) {
      opCounts.set(op.type, (opCounts.get(op.type) || 0) + 1);
    }
    
    const summary = Array.from(opCounts.entries())
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');
    
    return `Task: ${this.currentTask.name} - ${summary} (${this.currentTask.status})`;
  }
}