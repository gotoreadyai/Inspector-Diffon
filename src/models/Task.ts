// src/models/Task.ts
export type TaskStatus = "todo" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  tags?: string[];
  estimate?: number;
  children?: Task[];
  files?: string[];
}