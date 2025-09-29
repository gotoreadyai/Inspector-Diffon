// src/templates/Template.ts
import { Task } from "../models";

export interface Template {
  id: string;
  name: string;
  description?: string;
  modules: Array<{ name: string; tasks?: Task[] }>;
}