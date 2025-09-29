// src/utils/project.ts
import { Project } from '../models';

export function ensureArrays(p: Project) {
  p.modules = p.modules || [];
  for (const m of p.modules) m.tasks = m.tasks || [];
}

export function counts(p: Project) {
  let total = 0, todo = 0, done = 0, modules = p.modules.length;
  const walk = (ts: any[]) => {
    for (const t of ts) {
      total++;
      if (t.status === "done") done++;
      else todo++;
      if (t.children?.length) walk(t.children);
    }
  };
  for (const m of p.modules) walk(m.tasks);
  return { modules, total, todo, done };
}

export function formatProjectSummary(c: { modules: number; total: number; todo: number; done: number; }) {
  return `${c.modules} modułów • ${c.total} zadań (⏳${c.todo} ✅${c.done})`;
}