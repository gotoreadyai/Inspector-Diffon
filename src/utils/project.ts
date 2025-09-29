// src/utils/project.ts
import { Project } from '../models';

export const ensureArrays = (p: Project) => {
  p.modules = p.modules || [];
  for (const m of p.modules) m.tasks = m.tasks || [];
};

export const counts = (p: Project) => {
  let total = 0, todo = 0, done = 0, modules = p.modules.length;
  const walk = (ts: any[]) => {
    for (const t of ts) {
      total++;
      t.status === 'done' ? done++ : todo++;
      if (t.children?.length) walk(t.children);
    }
  };
  for (const m of p.modules) walk(m.tasks);
  return { modules, total, todo, done };
};

/** Single source of truth (EN): used in tree & status bar */
export const formatProjectSummary = (c: { modules: number; total: number; todo: number; done: number; }) => {
  const mod = pluralEn(c.modules, ['module', 'modules']);
  const task = pluralEn(c.total, ['task', 'tasks']);
  return `${c.modules} ${mod} • ${c.total} ${task} (⏳${c.todo} ✅${c.done})`;
};

const pluralEn = (n: number, forms: [string, string]) =>
  new Intl.PluralRules('en').select(n) === 'one' ? forms[0] : forms[1];
