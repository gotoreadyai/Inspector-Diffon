// src/templates/instantiate.ts
import { Project, Task } from "../models";
import { Template } from "./Template";
import { uid } from "../utils";

export function instantiateTemplate(tpl: Template): Project {
  return {
    id: uid(),
    name: tpl.name,
    description: tpl.description,
    createdAt: new Date().toISOString(),
    modules: tpl.modules.map(m => ({
      id: uid(),
      name: m.name,
      tasks: (m.tasks || []).map(cloneTaskDeep),
    })),
  };
}

function cloneTaskDeep(task: Task): Task {
  return {
    id: uid(),
    title: task.title,
    description: task.description,
    status: task.status || "todo",
    tags: task.tags ? [...task.tags] : [],
    estimate: task.estimate,
    children: (task.children || []).map(cloneTaskDeep),
  };
}