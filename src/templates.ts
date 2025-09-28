import { PMModule, PMProject, PMTask } from './types';
import { uid } from './utils';

export interface PMTemplate {
  id: string;
  name: string;
  description?: string;
  modules: Array<{ name: string; tasks?: PMTask[] }>;
}

export const templates: PMTemplate[] = [
  {
    id: 'webapp-basic',
    name: 'WebApp Basic',
    description: 'Podstawowa aplikacja web: auth, dashboard, katalog.',
    modules: [
      { name: 'auth', tasks: [ t('Logowanie', [t('Form: email+hasło'), t('Reset hasła')]), t('Rejestracja') ] },
      { name: 'dashboard', tasks: [ t('Widok startowy'), t('KPI widgety') ] },
      { name: 'catalog', tasks: [ t('Lista produktów'), t('Filtrowanie'), t('Szczegóły produktu') ] }
    ]
  },
  {
    id: 'saas-starter',
    name: 'SaaS Starter',
    description: 'Multi-tenant, role-based access, rozliczenia.',
    modules: [
      { name: 'tenancy', tasks: [ t('Modele danych'), t('Izolacja tenantów') ] },
      { name: 'rbac', tasks: [ t('Role & uprawnienia'), t('Guardy') ] },
      { name: 'billing', tasks: [ t('Integracja płatności'), t('Subskrypcje') ] }
    ]
  }
];

export function instantiateTemplate(name: string): PMProject {
  const tpl = templates.find(t => t.name === name || t.id === name);
  if (!tpl) throw new Error('Nie znaleziono szablonu');
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

function t(title: string, children?: PMTask[]): PMTask {
  return { id: uid(), title, status: 'todo', children: children || [] };
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
