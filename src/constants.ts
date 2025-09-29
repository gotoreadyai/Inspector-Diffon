// src/constants.ts
export const STATE_KEY = 'pm.activeProjectPath';
export const VIEW_ID = 'pmExplorer';

export const WS_KEYS = {
  expandedFileNodes: 'pm.expandedFileNodes',
} as const;

export const PATHS = {
  PROJECTS_DIR: '.inspector-diff/projects',
  TEMPLATES_DIR: '.inspector-diff/templates',
  TEMPLATES_GLOB: '*.json',
} as const;

export const COMMANDS = {
  TOGGLE_TASK_DONE: 'pm.toggleTaskDone',
  OPEN_PROJECT: 'pm.openProject',
  START_FROM_TEMPLATE: 'pm.startFromTemplate',
  SELECT_MODULE: 'pm.selectModule',
  TOGGLE_FILE_SELECTION: 'pm.toggleFileSelection',
};
