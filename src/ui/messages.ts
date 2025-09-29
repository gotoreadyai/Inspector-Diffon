// src/ui/messages.ts
export const MSG = {
    infoSelectMilestone: 'Select a milestone in the Projects tree to assign files',
    infoActivateSelection: 'Select a milestone in the “Project” tree to activate file selection.',
    statusSelectedOne: (name: string) => `Selected file: ${name}`,
    statusSelectedMany: (n: number) => `Selected ${n} files`,
    statusDeselected: (name: string) => `Deselected file: ${name}`,
    treeModuleHint: (moduleName: string) => `→ milestone: ${moduleName}`,
    noWorkspace: 'Open a workspace folder to use the extension.',
    noActiveProject: 'No active project',
    selectModuleFirst: 'First, select a module (click the module in the Projects tree).',
    fileUnlinked: (n: string) => `The file was unlinked from the milestone: ${n}`,
    fileLinked: (n: string) => `The file has been attached to the milestone: ${n}`,
    moduleHasNoFiles: (name: string) => `Milestone "${name}" has no files assigned`,
    moduleHasFiles: (name: string, n: number) => `Selected ${n} milestone files "${name}"`,
  };
  