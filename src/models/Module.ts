// src/models/Module.ts
import { Task } from './Task';

export interface Module {
  id: string;
  name: string;
  tasks: Task[];
}