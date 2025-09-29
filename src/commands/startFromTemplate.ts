// src/commands/startFromTemplate.ts
import * as vscode from "vscode";
import { Storage } from "../core/Storage";
import { Template } from "../templates";
import { instantiateTemplate } from "../templates/instantiate";
import { Project } from "../models";

export function registerStartFromTemplateCommand(
  storage: Storage,
  applyActiveProject: (project: Project, toast: string, ms?: number) => Promise<void>
) {
  return vscode.commands.registerCommand(
    "pm.startFromTemplate",
    async (node?: any) => {
      const tpl: Template | undefined = node?.template as Template | undefined;
      if (!tpl) return;

      const name = (
        await vscode.window.showInputBox({
          title: `Start z szablonu: ${tpl.name}`,
          prompt: "Nazwa projektu",
          value: tpl.name,
        })
      )?.trim();
      if (!name) return;

      const project: Project = instantiateTemplate(tpl);
      project.name = name;

      const savedPath = await storage.createFromTemplateAndSave(project);
      await applyActiveProject(project, `Utworzono projekt „${name}” • ${savedPath}`, 3000);
    }
  );
}