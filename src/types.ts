// All data models in one place
export type TaskStatus = 'todo' | 'done';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  children?: Task[];
}

export interface Module {
  id: string;
  name: string;
  tasks: Task[];
  files: string[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  modules: Module[];
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  modules: Array<{ name: string; tasks?: Task[] }>;
}