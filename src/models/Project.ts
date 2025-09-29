// src/models/Project.ts
import { Module } from './Module';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  modules: Module[];
}