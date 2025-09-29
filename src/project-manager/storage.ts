import * as vscode from 'vscode';
import { Project, Template, Task } from './types';

const STATE_KEY = 'pm.activeProjectPath';
const PROJECTS_DIR = '.inspector-diff/projects';
const TEMPLATES_DIR = '.inspector-diff/templates';

export class ProjectStore {
  private activeProject: Project | null = null;
  private activeUri: vscode.Uri | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  getActive = () => this.activeProject;

  async loadLast(): Promise<Project | null> {
    const path = this.context.workspaceState.get<string>(STATE_KEY);
    if (!path) return null;

    try {
      const uri = vscode.Uri.file(path);
      const data = await this.readProject(uri);
      this.activeProject = data;
      this.activeUri = uri;
      return data;
    } catch {
      return null;
    }
  }

  async openFromFile(): Promise<Project | null> {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ['json'] }
    });
    
    if (!pick?.[0]) return null;
    
    const data = await this.readProject(pick[0]);
    this.activeProject = data;
    this.activeUri = pick[0];
    await this.context.workspaceState.update(STATE_KEY, pick[0].fsPath);
    return data;
  }

  async save(): Promise<void> {
    if (!this.activeProject || !this.activeUri) return;
    const json = JSON.stringify(this.activeProject, null, 2);
    await vscode.workspace.fs.writeFile(this.activeUri, Buffer.from(json, 'utf8'));
  }

  async saveAs(project: Project, name: string): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('No workspace');

    const dir = vscode.Uri.joinPath(root, PROJECTS_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    
    const file = vscode.Uri.joinPath(dir, `${name}.json`);
    const json = JSON.stringify(project, null, 2);
    await vscode.workspace.fs.writeFile(file, Buffer.from(json, 'utf8'));

    this.activeProject = project;
    this.activeUri = file;
    await this.context.workspaceState.update(STATE_KEY, file.fsPath);
    return file.fsPath;
  }

  setActive(project: Project | null) {
    this.activeProject = project;
  }

  private async readProject(uri: vscode.Uri): Promise<Project> {
    const raw = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(raw).toString('utf8')) as Project;
    
    // Ensure structure
    data.modules = data.modules || [];
    for (const m of data.modules) {
      m.tasks = m.tasks || [];
      m.files = m.files || [];
    }
    
    return data;
  }
}

export async function loadTemplates(): Promise<Template[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];

  const dir = vscode.Uri.joinPath(root, TEMPLATES_DIR);
  try {
    const files = await vscode.workspace.fs.readDirectory(dir);
    const templates: Template[] = [];

    for (const [name, type] of files) {
      if (type === vscode.FileType.File && name.endsWith('.json')) {
        try {
          const uri = vscode.Uri.joinPath(dir, name);
          const raw = await vscode.workspace.fs.readFile(uri);
          templates.push(JSON.parse(Buffer.from(raw).toString('utf8')));
        } catch {}
      }
    }
    return templates;
  } catch {
    return [];
  }
}

export function instantiateTemplate(tpl: Template, name: string): Project {
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  
  const cloneTask = (t: Task): Task => ({
    id: uid(),
    title: t.title,
    description: t.description,
    status: t.status || 'todo',
    children: (t.children || []).map(cloneTask)
  });

  return {
    id: uid(),
    name,
    description: tpl.description,
    createdAt: new Date().toISOString(),
    modules: tpl.modules.map(m => ({
      id: uid(),
      name: m.name,
      tasks: (m.tasks || []).map(cloneTask),
      files: []
    }))
  };
}