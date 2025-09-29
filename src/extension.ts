// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectTreeProvider, TreeNode } from './core/ProjectTreeProvider';
import { Project, Module } from './models';
import { Storage } from './core/Storage';
import { counts, formatProjectSummary } from './utils';
import { FileTreeProvider } from './core/FileTreeProvider';
import { COMMANDS } from './constants';
import { MSG } from './ui/messages';

import { registerToggleTaskDoneCommand } from './commands/toggleTaskDone';
import { registerOpenProjectCommand } from './commands/openProject';
import { registerStartFromTemplateCommand } from './commands/startFromTemplate';
import { registerShowSelectedFilesCommand } from './commands/showSelectedFiles';

let statusItem: vscode.StatusBarItem;
let fileStatusBarItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<TreeNode>;
let fileTreeView: vscode.TreeView<any>;

let activeModule: Module | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage(MSG.noWorkspace);
    return;
  }

  const storage = new Storage(context);
  await storage.loadLastProjectIfAny();

  const setProjectContext = (project: Project | null) =>
    vscode.commands.executeCommand('setContext', 'pm.hasActiveProject', !!project);

  setProjectContext(storage.activeProject);

  const provider = new ProjectTreeProvider(
    () => storage.activeProject,
    async (p) => {
      storage.activeProject = p;
      await storage.saveActive();
      updateStatusBar(p);
      setProjectContext(p);
    }
  );

  const fileTreeProvider = new FileTreeProvider(root.fsPath, context);

  const applyActiveProject = async (project: Project, toast: string, ms = 3000) => {
    activeModule = null;
    fileTreeProvider.clearSelection();
    fileTreeProvider.setActiveModuleName(null);
    provider.refresh();
    await revealProjectRoot(project);
    updateStatusBar(storage.activeProject);
    setProjectContext(project);
    vscode.window.setStatusBarMessage(toast, ms);
  };

  context.subscriptions.push(
    registerToggleTaskDoneCommand(provider),
    registerOpenProjectCommand(storage, applyActiveProject),
    registerStartFromTemplateCommand(storage, applyActiveProject),
    registerShowSelectedFilesCommand(fileTreeProvider),

    vscode.commands.registerCommand(COMMANDS.SELECT_MODULE, (module: Module) => {
      activeModule = module || null;
      fileTreeProvider.setActiveModuleName(activeModule ? activeModule.name : null);

      const files = activeModule?.files ?? [];
      fileTreeProvider.selectFiles(files);

      vscode.window.setStatusBarMessage(
        files.length > 0 ? MSG.moduleHasFiles(module.name, files.length) : MSG.moduleHasNoFiles(module.name),
        2000
      );

      updateFileStatus(fileTreeProvider);
    }),

    vscode.commands.registerCommand(COMMANDS.TOGGLE_FILE_SELECTION, async (fileUri: vscode.Uri) => {
      if (!fileUri?.fsPath) return;

      const project = storage.activeProject;
      if (!project) {
        vscode.window.showWarningMessage(MSG.noActiveProject);
        return;
      }

      if (!activeModule) {
        vscode.window.showWarningMessage(MSG.selectModuleFirst);
        return;
      }

      activeModule.files ||= [];

      const idx = activeModule.files.indexOf(fileUri.fsPath);
      if (idx >= 0) {
        activeModule.files.splice(idx, 1);
        vscode.window.setStatusBarMessage(MSG.fileUnlinked(path.basename(fileUri.fsPath)), 2000);
      } else {
        activeModule.files.push(fileUri.fsPath);
        vscode.window.setStatusBarMessage(MSG.fileLinked(path.basename(fileUri.fsPath)), 2000);
      }

      await storage.saveActive();
      provider.refresh();
      fileTreeProvider.selectFiles(activeModule.files);
      updateFileStatus(fileTreeProvider);
    })
  );

  vscode.window.registerTreeDataProvider('pmExplorer', provider);
  treeView = vscode.window.createTreeView('pmExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  fileTreeView = vscode.window.createTreeView('pmFiles', {
    treeDataProvider: fileTreeProvider,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(fileTreeView);

  fileTreeView.onDidExpandElement(e => e.element?.id && fileTreeProvider.setExpanded(e.element.id, true));
  fileTreeView.onDidCollapseElement(e => e.element?.id && fileTreeProvider.setExpanded(e.element.id, false));

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusItem);
  updateStatusBar(storage.activeProject);

  fileStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  context.subscriptions.push(fileStatusBarItem);

  fileTreeProvider.onDidChangeTreeData(() => updateFileStatus(fileTreeProvider));

  fileTreeProvider.setActiveModuleName(null);
  updateFileStatus(fileTreeProvider);
}

export function deactivate() {}

const revealProjectRoot = async (project: Project) => {
  try {
    const c = counts(project);
    const element = {
      kind: 'project',
      label: project.name,
      description: formatProjectSummary(c),
      project,
    } as any;
    await treeView.reveal(element, { expand: true, focus: true, select: true });
  } catch {}
};

const updateStatusBar = (project: Project | null) => {
  if (!project) {
    statusItem.text = '$(package) No Project';
    statusItem.tooltip = MSG.noActiveProject;
    statusItem.show();
    return;
  }
  const summary = formatProjectSummary(counts(project));
  statusItem.text = `$(package) ${project.name}  ${summary}`;
  statusItem.tooltip = project.description || 'Project';
  statusItem.show();
};

const updateFileStatus = (fileTreeProvider: any) => {
  const selectedFiles = fileTreeProvider.getSelectedFiles();
  const activeModuleName = fileTreeProvider.getActiveModuleName();

  if (!activeModuleName) {
    fileStatusBarItem.text = '$(file) select a module to assign files';
    fileStatusBarItem.tooltip = 'Click on the module in the Projects tree (PM Explorer)';
    fileStatusBarItem.command = undefined;
    fileStatusBarItem.show();
    return;
  }

  if (selectedFiles.length > 0) {
    const names = selectedFiles.map((f: string) => path.basename(f)).join(', ');
    const label = `$(file) ${selectedFiles.length} files • milestone: ${activeModuleName}`;
    fileStatusBarItem.text = label;
    fileStatusBarItem.tooltip = names.length > 50 ? `Selected: ${names.slice(0, 50)}...` : `Selected: ${names}`;
    fileStatusBarItem.command = undefined;
    fileStatusBarItem.show();
  } else {
    fileStatusBarItem.text = `$(file) 0 files • milestone: ${activeModuleName}`;
    fileStatusBarItem.tooltip = `No files selected for the milestone: ${activeModuleName}`;
    fileStatusBarItem.command = undefined;
    fileStatusBarItem.show();
  }
};
