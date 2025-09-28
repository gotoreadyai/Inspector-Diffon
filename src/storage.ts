import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PMProject } from './types';

export class PMStorage {
  constructor(private ctx: vscode.ExtensionContext) {}
  private _active: PMProject | null = null;
  get activeProject() { return this._active; }
  set activeProject(p: PMProject | null) { this._active = p; }

  async openFromFile(): Promise<PMProject | null> {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Otwórz projekt',
      filters: { 'JSON': ['json'] }
    });
    if (!pick || !pick[0]) return null;
    const raw = await fs.readFile(pick[0].fsPath, 'utf8');
    const data = JSON.parse(raw);
    return data as PMProject;
  }

  async saveToWorkspaceFile(project: PMProject): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('Brak otwartego folderu roboczego');
    const dir = vscode.Uri.joinPath(root, '.inspector-diff', 'projects');
    await fs.mkdir(dir.fsPath, { recursive: true });
    const file = vscode.Uri.joinPath(dir, `${project.name}.json`);
    await fs.writeFile(file.fsPath, JSON.stringify(project, null, 2), 'utf8');
    return file.fsPath;
  }
}
