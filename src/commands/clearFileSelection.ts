import * as vscode from "vscode";
import { FileTreeProvider } from "../core/FileTreeProvider";

export function registerClearFileSelectionCommand(fileTreeProvider: FileTreeProvider) {
  return vscode.commands.registerCommand("pm.clearFileSelection", () => {
    fileTreeProvider.clearSelection();
    vscode.window.setStatusBarMessage("Wyczyszczono zaznaczenie plików", 2000);
  });
}