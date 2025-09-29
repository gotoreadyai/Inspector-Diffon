import * as vscode from "vscode";
import { FileTreeProvider } from "../core/FileTreeProvider";

export function registerShowSelectedFilesCommand(fileTreeProvider: FileTreeProvider) {
  return vscode.commands.registerCommand("pm.showSelectedFiles", () => {
    const selectedFiles = fileTreeProvider.getSelectedFiles();
    if (selectedFiles.length === 0) {
      vscode.window.showInformationMessage("Brak zaznaczonych plików");
      return;
    }
    
    const message = selectedFiles.length === 1 
      ? `Zaznaczony plik: ${selectedFiles[0]}`
      : `Zaznaczone pliki (${selectedFiles.length}):\n${selectedFiles.join('\n')}`;
    
    vscode.window.showInformationMessage(message, { modal: true });
  });
}