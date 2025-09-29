// src/extension.ts
import * as vscode from "vscode";
import { Storage } from "./core/Storage";
import { ProjectTreeProvider } from "./core/ProjectTreeProvider";
import { Project } from "./models";
import { counts, formatProjectSummary } from "./utils";
import { COMMANDS, VIEW_ID } from "./constants";
import { registerToggleTaskDoneCommand } from "./commands/toggleTaskDone";
import { registerOpenProjectCommand } from "./commands/openProject";
import { registerStartFromTemplateCommand } from "./commands/startFromTemplate";

let statusItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<any>;

export async function activate(context: vscode.ExtensionContext) {
  const storage = new Storage(context);
  await storage.loadLastProjectIfAny();

  const provider = new ProjectTreeProvider(
    () => storage.activeProject,
    async (p) => {
      storage.activeProject = p;
      await storage.saveActive();
      updateStatusBar(p);
    }
  );

  // Helper: jedna ścieżka po zmianie aktywnego projektu
  const applyActiveProject = async (project: Project, toast: string, ms = 3000) => {
    provider.refresh();
    await revealProjectRoot(project);
    updateStatusBar(storage.activeProject);
    vscode.window.setStatusBarMessage(toast, ms);
  };

  // Rejestracja komend
  context.subscriptions.push(
    registerToggleTaskDoneCommand(provider),
    registerOpenProjectCommand(storage, applyActiveProject),
    registerStartFromTemplateCommand(storage, applyActiveProject)
  );

  // Rejestracja TreeDataProvider
  vscode.window.registerTreeDataProvider(VIEW_ID, provider);
  treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  // Pasek statusu
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusItem);
  updateStatusBar(storage.activeProject);
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