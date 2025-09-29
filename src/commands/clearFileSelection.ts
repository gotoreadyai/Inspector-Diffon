import * as vscode from 'vscode';
import { FileTreeProvider } from '../core/FileTreeProvider';

export const registerClearFileSelectionCommand = (fileTreeProvider: FileTreeProvider) =>
  vscode.commands.registerCommand('pm.clearFileSelection', () => {
    fileTreeProvider.clearSelection();
    vscode.window.setStatusBarMessage('Cleared file selection', 2000);
  });
