// src/commands/toggleTaskDone.ts
import * as vscode from "vscode";
import { ProjectTreeProvider, TreeNode } from "../core/ProjectTreeProvider";

export function registerToggleTaskDoneCommand(provider: ProjectTreeProvider) {
  return vscode.commands.registerCommand(
    "pm.toggleTaskDone",
    async (node?: TreeNode) => {
      if (node?.kind === "task") await provider.toggleTaskDone(node);
    }
  );
}