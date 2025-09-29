import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Project } from '../models';
import { STATE_KEY, PATHS } from '../constants';

export class Storage {
  constructor(private ctx: vscode.ExtensionContext) {}
  private _active: Project | null = null;
  private _activeUri: vscode.Uri | null = null;

  get activeProject() { return this._active; }
  set activeProject(p: Project | null) { this._active = p; }
  get activeUri() { return this._activeUri; }

  async openFromFile(): Promise<Project | null> {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Open project',
      filters: { JSON: ['json'] },
    });
    if (!pick?.[0]) return null;
    const uri = pick[0];
    const raw = await fs.readFile(uri.fsPath, 'utf8');
    const data = JSON.parse(raw) as Project & { files?: string[] };

    // migration: old root-level files -> first module
    if (data.files?.length && data.modules.length) {
      data.modules[0].files = [...(data.modules[0].files ?? []), ...data.files];
      delete (data as any).files;
    }

    this._active = data;
    this._activeUri = uri;
    await this.ctx.workspaceState.update(STATE_KEY, uri.fsPath);
    return data;
  }

  async loadLastProjectIfAny(): Promise<Project | null> {
    const lastPath = this.ctx.workspaceState.get<string>(STATE_KEY);
    if (!lastPath) return null;
    try {
      const uri = vscode.Uri.file(lastPath);
      const raw = await fs.readFile(uri.fsPath, 'utf8');
      const data = JSON.parse(raw) as Project & { files?: string[] };

      if (data.files?.length && data.modules.length) {
        data.modules[0].files = [...(data.modules[0].files ?? []), ...data.files];
        delete (data as any).files;
      }

      this._active = data;
      this._activeUri = uri;
      return data;
    } catch {
      return null;
    }
  }

  async saveActive(): Promise<void> {
    if (!this._active || !this._activeUri) return;
    const buf = Buffer.from(JSON.stringify(this._active, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(this._activeUri, buf);
  }

  async createFromTemplateAndSave(project: Project): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('No workspace folder open');

    const dir = vscode.Uri.joinPath(root, PATHS.PROJECTS_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(dir, `${project.name}.json`);

    await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(project, null, 2), 'utf8'));

    this._active = project;
    this._activeUri = file;
    await this.ctx.workspaceState.update(STATE_KEY, file.fsPath);
    return file.fsPath;
  }
}
