import * as vscode from "vscode";
import { ProjectTreeProvider, TreeNode } from "./core/ProjectTreeProvider";
import { Project } from "./models";
import { Storage } from "./core/Storage";
import { counts, formatProjectSummary } from "./utils";
import { Template, instantiateTemplate } from "./templates";
import { FileTreeProvider } from "./core/FileTreeProvider";

// Importy komend
import { registerToggleTaskDoneCommand } from "./commands/toggleTaskDone";
import { registerOpenProjectCommand } from "./commands/openProject";
import { registerStartFromTemplateCommand } from "./commands/startFromTemplate";
import { registerAssignFilesToModuleCommand } from "./commands/assignFilesToModule";
import { registerClearFileSelectionCommand } from "./commands/clearFileSelection";

let statusItem: vscode.StatusBarItem;
let fileStatusBarItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<TreeNode>;
let fileTreeView: vscode.TreeView<any>;

export async function activate(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage('Otwórz folder roboczy, aby korzystać z rozszerzenia.');
    return;
  }

  const storage = new Storage(context);
  await storage.loadLastProjectIfAny();

  // Ustaw kontekst aktywnego projektu
  const setProjectContext = (project: Project | null) => {
    vscode.commands.executeCommand('setContext', 'pm.hasActiveProject', !!project);
  };

  // Ustaw początkowy stan
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

  // Provider drzewa plików
  const fileTreeProvider = new FileTreeProvider(root.fsPath);

  // Helper: jedna ścieżka po zmianie aktywnego projektu
  const applyActiveProject = async (project: Project, toast: string, ms = 3000) => {
    provider.refresh();
    await revealProjectRoot(project);
    updateStatusBar(storage.activeProject);
    setProjectContext(project);
    vscode.window.setStatusBarMessage(toast, ms);
  };

  // Rejestracja komend
  context.subscriptions.push(
    registerToggleTaskDoneCommand(provider),
    registerOpenProjectCommand(storage, applyActiveProject),
    registerStartFromTemplateCommand(storage, applyActiveProject),
    registerAssignFilesToModuleCommand(fileTreeProvider, storage),
    registerClearFileSelectionCommand(fileTreeProvider)
  );

  // Rejestracja drzewa projektów
  vscode.window.registerTreeDataProvider("pmExplorer", provider);
  treeView = vscode.window.createTreeView("pmExplorer", {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  // Rejestracja drzewa plików
  fileTreeView = vscode.window.createTreeView("pmFiles", {
    treeDataProvider: fileTreeProvider,
    showCollapseAll: true,
    canSelectMany: false
  });
  context.subscriptions.push(fileTreeView);

  // Pasek statusu projektu
  statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  context.subscriptions.push(statusItem);
  updateStatusBar(storage.activeProject);

  // Pasek statusu plików
  fileStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    200
  );
  context.subscriptions.push(fileStatusBarItem);

  // Aktualizuj status plików przy zmianie zaznaczenia
  fileTreeProvider.onDidChangeTreeData(() => {
    updateFileStatus(fileTreeProvider);
  });

  // Rejestracja komendy do zaznaczania plików
  context.subscriptions.push(
    vscode.commands.registerCommand("pm.toggleFileSelection", (fileUri: vscode.Uri) => {
      fileTreeProvider.toggleFileSelection(fileUri.fsPath);
      updateFileStatus(fileTreeProvider);
    })
  );

  // Początkowa aktualizacja statusu
  updateFileStatus(fileTreeProvider);
}

export function deactivate() {}

async function revealProjectRoot(project: Project) {
  try {
    const c = counts(project);
    const element = {
      kind: "project",
      label: project.name,
      description: formatProjectSummary(c),
      project,
    } as any;
    await treeView.reveal(element, { expand: true, focus: true, select: true });
  } catch {}
}

function updateStatusBar(project: Project | null) {
  if (!project) {
    statusItem.text = "$(package) No Project";
    statusItem.tooltip = "Brak aktywnego projektu";
    statusItem.show();
    return;
  }
  const c = counts(project);
  statusItem.text = `$(package) ${project.name}  $(library)${c.modules}  $(list-ordered)${c.total}  ⏳${c.todo} ✅${c.done}`;
  statusItem.tooltip = project.description || "Project";
  statusItem.show();
}

function updateFileStatus(fileTreeProvider: FileTreeProvider) {
  const count = fileTreeProvider.getSelectedFiles().length;
  if (count > 0) {
    fileStatusBarItem.text = `$(file) ${count} plików zaznaczonych`;
    fileStatusBarItem.tooltip = "Kliknij, aby wyczyścić zaznaczenie";
    fileStatusBarItem.command = "pm.clearFileSelection";
    fileStatusBarItem.show();
  } else {
    fileStatusBarItem.hide();
  }
}