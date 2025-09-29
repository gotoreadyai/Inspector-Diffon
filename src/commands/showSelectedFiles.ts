import * as vscode from 'vscode';
import { FileTreeProvider } from '../core/FileTreeProvider';

export const registerShowSelectedFilesCommand = (fileTreeProvider: FileTreeProvider) =>
  vscode.commands.registerCommand('pm.showSelectedFiles', () => {
    const selectedFiles = fileTreeProvider.getSelectedFiles();
    if (selectedFiles.length === 0) {
      vscode.window.showInformationMessage('No selected files');
      return;
    }
    const message =
      selectedFiles.length === 1
        ? `Selected file: ${selectedFiles[0]}`
        : `Selected files (${selectedFiles.length}):\n${selectedFiles.join('\n')}`;

    vscode.window.showInformationMessage(message, { modal: true });
  });
