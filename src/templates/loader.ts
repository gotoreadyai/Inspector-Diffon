import * as vscode from 'vscode';
import { Template } from './Template';
import { PATHS } from '../constants';

export async function loadTemplates(): Promise<Template[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];

  const dir = vscode.Uri.joinPath(root, PATHS.TEMPLATES_DIR);
  try {
    const files = await vscode.workspace.fs.readDirectory(dir);
    const out: Template[] = [];

    for (const [name, type] of files) {
      if (type === vscode.FileType.File && name.endsWith('.json')) {
        try {
          const fileUri = vscode.Uri.joinPath(dir, name);
          const raw = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
          out.push(JSON.parse(raw) as Template);
        } catch (e: any) {
          vscode.window.showWarningMessage(`Template ${name}: ${e?.message ?? e}`);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
