import * as vscode from 'vscode';
import { PMProject, PMTask } from './types';
import { uid } from './utils';

export interface PMTemplate {
  id: string;
  name: string;
  description?: string;
  modules: Array<{ name: string; tasks?: PMTask[] }>;
}

export async function loadTemplates(): Promise<PMTemplate[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];
  const dir = vscode.Uri.joinPath(root, '.inspector-diff', 'templates');
  try {
    const files = await vscode.workspace.fs.readDirectory(dir);
    const out: PMTemplate[] = [];
    for (const [name, type] of files) {
      if (type === vscode.FileType.File && name.endsWith('.json')) {
        try {
          const fileUri = vscode.Uri.joinPath(dir, name);
          const raw = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
          out.push(JSON.parse(raw) as PMTemplate);
        } catch (e: any) {
          vscode.window.showWarningMessage(`Szablon ${name}: ${e?.message ?? e}`);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function instantiateTemplate(tpl: PMTemplate): PMProject {
  return {
    id: uid(),
    name: tpl.name,
    description: tpl.description,
    createdAt: new Date().toISOString(),
    modules: tpl.modules.map(m => ({
      id: uid(),
      name: m.name,
      tasks: (m.tasks || []).map(cloneTaskDeep)
    }))
  };
}

function cloneTaskDeep(task: PMTask): PMTask {
  return {
    id: uid(),
    title: task.title,
    description: task.description,
    status: task.status || 'todo',
    tags: task.tags ? [...task.tags] : [],
    estimate: task.estimate,
    children: (task.children || []).map(cloneTaskDeep)
  };
}
