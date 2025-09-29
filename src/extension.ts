// src/extension.ts
import * as vscode from "vscode";
import * as path from "path";
import { ProjectTreeProvider, TreeNode } from "./core/ProjectTreeProvider";
import { Project, Module } from "./models";
import { Storage } from "./core/Storage";
import { counts, formatProjectSummary } from "./utils";
import { FileTreeProvider } from "./core/FileTreeProvider";
import { COMMANDS } from "./constants";

// Importy komend
import { registerToggleTaskDoneCommand } from "./commands/toggleTaskDone";
import { registerOpenProjectCommand } from "./commands/openProject";
import { registerStartFromTemplateCommand } from "./commands/startFromTemplate";
import { registerShowSelectedFilesCommand } from "./commands/showSelectedFiles";

// Dodaj stałe POSIX
const PROJECTS_DIR = '.inspector-diff/projects';

let statusItem: vscode.StatusBarItem;
let fileStatusBarItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<TreeNode>;
let fileTreeView: vscode.TreeView<any>;

// NOWE: aktywny moduł – tylko on definiuje, które pliki są zaznaczone
let activeModule: Module | null = null;

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
  const fileTreeProvider = new FileTreeProvider(root.fsPath, context);

  // Helper: jedna ścieżka po zmianie aktywnego projektu
  const applyActiveProject = async (project: Project, toast: string, ms = 3000) => {
    // reset aktywnego modułu przy zmianie projektu
    activeModule = null;
    fileTreeProvider.clearSelection();
    fileTreeProvider.setActiveModuleName(null); // NOWE: dezaktywuj drzewo plików
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
    registerShowSelectedFilesCommand(fileTreeProvider),

    // Kliknięcie modułu = ustaw aktywny moduł, jego files => zaznaczenie w drzewie
    vscode.commands.registerCommand(COMMANDS.SELECT_MODULE, (module: Module) => {
      activeModule = module || null;

      // NOWE: ustaw info w drzewie do którego modułu przypisujemy pliki
      fileTreeProvider.setActiveModuleName(activeModule ? activeModule.name : null);

      const files = activeModule?.files ?? [];
      fileTreeProvider.selectFiles(files);

      if (files.length > 0) {
        vscode.window.setStatusBarMessage(`Zaznaczono ${files.length} plików modułu "${module.name}"`, 2000);
      } else {
        vscode.window.setStatusBarMessage(`Moduł "${module.name}" nie ma przypisanych plików`, 2000);
      }

      updateFileStatus(fileTreeProvider);
    })
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

  // Zdarzenia expand/collapse dla zapamiętania stanu
  fileTreeView.onDidExpandElement(e => {
    if (e.element && e.element.id) {
      fileTreeProvider.setExpanded(e.element.id, true);
    }
  });

  fileTreeView.onDidCollapseElement(e => {
    if (e.element && e.element.id) {
      fileTreeProvider.setExpanded(e.element.id, false);
    }
  });

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

  // Klik na pliku = dodaj/usuń z activeModule.files, a potem odśwież widok zaznaczenia
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.TOGGLE_FILE_SELECTION, async (fileUri: vscode.Uri) => {
      if (!fileUri || !fileUri.fsPath) return;

      const project = storage.activeProject;
      if (!project) {
        vscode.window.showWarningMessage("Brak aktywnego projektu");
        return;
      }

      if (!activeModule) {
        // Teoretycznie nie powinno się zdarzyć, bo komenda nie jest podpinana bez aktywnego modułu
        vscode.window.showWarningMessage("Najpierw wybierz moduł (kliknij moduł w drzewie Projektów).");
        return;
      }

      if (!activeModule.files) activeModule.files = [];

      const idx = activeModule.files.indexOf(fileUri.fsPath);
      if (idx >= 0) {
        activeModule.files.splice(idx, 1);
        vscode.window.setStatusBarMessage(`Odpięto plik od modułu: ${path.basename(fileUri.fsPath)}`, 2000);
      } else {
        activeModule.files.push(fileUri.fsPath);
        vscode.window.setStatusBarMessage(`Przypięto plik do modułu: ${path.basename(fileUri.fsPath)}`, 2000);
      }

      // zapisz projekt i odśwież widok zaznaczenia
      await storage.saveActive();

      // 🔧 NOWE: odśwież drzewo „Projekty”, aby zaktualizować licznik plików w module
      provider.refresh();

      fileTreeProvider.selectFiles(activeModule.files);
      updateFileStatus(fileTreeProvider);
    })
  );

  // Początkowo drzewo plików nieaktywne, dopóki nie wybierzesz modułu
  fileTreeProvider.setActiveModuleName(null);
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
    statusItem.tooltip = "No active project";
    statusItem.show();
    return;
  }
  const c = counts(project);
  statusItem.text = `$(package) ${project.name}  $(library)${c.modules}  $(list-ordered)${c.total}  ⏳${c.todo} ✅${c.done}`;
  statusItem.tooltip = project.description || "Project";
  statusItem.show();
}

function updateFileStatus(fileTreeProvider: FileTreeProvider) {
  const selectedFiles = fileTreeProvider.getSelectedFiles();
  const activeModuleName = fileTreeProvider.getActiveModuleName();

  if (!activeModuleName) {
    fileStatusBarItem.text = `$(file) select a module to assign files`;
    fileStatusBarItem.tooltip = `Click on the module in the Projects tree (PM Explorer)`;
    fileStatusBarItem.command = undefined;
    fileStatusBarItem.show();
    return;
  }

  if (selectedFiles.length > 0) {
    const fileNames = selectedFiles.map(f => path.basename(f)).join(', ');
    const label = `$(file) ${selectedFiles.length} plików • moduł: ${activeModuleName}`;
    fileStatusBarItem.text = label;
    if (fileNames.length > 50) {
      fileStatusBarItem.tooltip = `Selected: ${fileNames.substring(0, 50)}...`;
    } else {
      fileStatusBarItem.tooltip = `Selected: ${fileNames}`;
    }
    // Usunięto akcję czyszczenia — brak komendy po kliknięciu
    fileStatusBarItem.command = undefined;
    fileStatusBarItem.show();
  } else {
    fileStatusBarItem.text = `$(file) 0 files • milestone: ${activeModuleName}`;
    fileStatusBarItem.tooltip = `No files selected for the milestone: ${activeModuleName}`;
    fileStatusBarItem.command = undefined;
    fileStatusBarItem.show();
  }
}
