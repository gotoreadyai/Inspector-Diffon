import * as vscode from "vscode";
import { FileTreeProvider } from "../core/FileTreeProvider";
import { Storage } from "../core/Storage";
import { Module } from "../models";

export function registerAssignFilesToModuleCommand(
  fileTreeProvider: FileTreeProvider,
  storage: Storage
) {
  return vscode.commands.registerCommand("pm.assignFilesToModule", async (moduleNode?: any) => {
    const project = storage.activeProject;
    if (!project) {
      vscode.window.showWarningMessage("Brak aktywnego projektu");
      return;
    }

    const selectedFiles = fileTreeProvider.getSelectedFiles();
    if (!selectedFiles.length) {
      vscode.window.showWarningMessage("Najpierw zaznacz pliki (kliknij je w drzewie)");
      return;
    }

    // Wybierz moduł
    let module: Module;
    if (moduleNode?.module) {
      module = moduleNode.module;
    } else {
      const selected = await vscode.window.showQuickPick(
        project.modules.map(m => ({
          label: m.name,
          description: `${m.files?.length || 0} plików`,
          module: m
        })),
        { title: "Wybierz moduł" }
      );
      if (!selected) return;
      module = selected.module;
    }

    // Upewnij się, że pole files istnieje
    if (!module.files) {
      module.files = [];
    }

    // Użyj operatora ! - wiemy, że pole istnieje
    const newFiles = selectedFiles.filter(file => !module.files!.includes(file));
    module.files!.push(...newFiles);

    // Zapisz i wyczyść zaznaczenie
    await storage.saveActive();
    fileTreeProvider.clearSelection();

    vscode.window.showInformationMessage(
      `Dodano ${newFiles.length} plików do modułu "${module.name}"`
    );
  });
}