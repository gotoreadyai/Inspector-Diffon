import * as vscode from 'vscode';
import { Storage } from '../core/Storage';
import { Project } from '../models';

export const registerOpenProjectCommand = (
  storage: Storage,
  applyActiveProject: (project: Project, toast: string, ms?: number) => Promise<void>
) =>
  vscode.commands.registerCommand('pm.openProject', async () => {
    const p = await storage.openFromFile();
    if (!p) return;
    await applyActiveProject(p, `Loaded project “${p.name}”.`, 2000);
  });
