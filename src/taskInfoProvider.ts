import * as vscode from 'vscode';
import { TaskManager } from './taskManager';

export class TaskInfoProvider implements vscode.TreeDataProvider<TaskInfoItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TaskInfoItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private taskManager: TaskManager | null) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TaskInfoItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TaskInfoItem): TaskInfoItem[] {
    if (!this.taskManager) {
      return [];
    }

    const currentTask = this.taskManager.getCurrentTask();
    
    if (!currentTask) {
      return [
        new TaskInfoItem(
          'No active task',
          'Click "Generate Prompt" to start',
          vscode.TreeItemCollapsibleState.None,
          'empty'
        )
      ];
    }

    if (!element) {
      // Root level - show task name
      return [
        new TaskInfoItem(
          `Task: ${currentTask.name}`,
          `Status: ${currentTask.status}`,
          vscode.TreeItemCollapsibleState.Expanded,
          'task'
        )
      ];
    }

    // Children of task - show details
    const items: TaskInfoItem[] = [];
    
    // Add description if exists
    const description = (currentTask as any).description;
    if (description) {
      items.push(
        new TaskInfoItem(
          'Description',
          description,
          vscode.TreeItemCollapsibleState.None,
          'description'
        )
      );
    }

    // Add operation count
    if (currentTask.operations.length > 0) {
      const opCounts = new Map<string, number>();
      for (const op of currentTask.operations) {
        opCounts.set(op.type, (opCounts.get(op.type) || 0) + 1);
      }
      
      const summary = Array.from(opCounts.entries())
        .map(([type, count]) => `${count} ${type}`)
        .join(', ');
      
      items.push(
        new TaskInfoItem(
          'Operations',
          summary,
          vscode.TreeItemCollapsibleState.None,
          'operations'
        )
      );
    }

    // Add affected files count
    if (currentTask.affectedFiles.length > 0) {
      items.push(
        new TaskInfoItem(
          'Affected Files',
          `${currentTask.affectedFiles.length} files`,
          vscode.TreeItemCollapsibleState.None,
          'files'
        )
      );
    }

    // Add actions
    items.push(
      new TaskInfoItem(
        'Actions',
        'Commit or Undo',
        vscode.TreeItemCollapsibleState.None,
        'actions'
      )
    );

    return items;
  }

  setTaskManager(taskManager: TaskManager) {
    this.taskManager = taskManager;
    this.refresh();
  }
}

class TaskInfoItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string
  ) {
    super(label, collapsibleState);
    
    this.tooltip = `${this.label}: ${this.description}`;
    
    // Set icons based on type
    switch (contextValue) {
      case 'task':
        this.iconPath = new vscode.ThemeIcon('git-branch');
        break;
      case 'description':
        this.iconPath = new vscode.ThemeIcon('note');
        break;
      case 'operations':
        this.iconPath = new vscode.ThemeIcon('edit');
        break;
      case 'files':
        this.iconPath = new vscode.ThemeIcon('files');
        break;
      case 'actions':
        this.iconPath = new vscode.ThemeIcon('play');
        this.command = {
          command: 'llmDiff.showTaskActions',
          title: 'Show Actions'
        };
        break;
      case 'empty':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }
}