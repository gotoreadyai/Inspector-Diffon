export type TaskStatus = "todo" | "done";

export interface PMTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  tags?: string[];
  estimate?: number;
  children?: PMTask[];
}

export interface PMModule {
  id: string;
  name: string;
  tasks: PMTask[];
}

export interface PMProject {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  modules: PMModule[];
}

export type NodeKind = "project" | "module" | "task";
