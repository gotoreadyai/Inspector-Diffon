import * as vscode from 'vscode';
import { Module, Project } from '../project-manager/types';


/**
 * Builds context string from files
 */
async function buildFilesContext(files: string[]): Promise<string> {
  const chunks: string[] = [];

  for (const filePath of files) {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const relPath = vscode.workspace.asRelativePath(uri);
      const lang = doc.languageId || 'txt';

      chunks.push(`// path: ${relPath}`);
      chunks.push('```' + lang);
      chunks.push(doc.getText());
      chunks.push('```\n');
    } catch (e) {
      chunks.push(`// Error reading: ${filePath}\n`);
    }
  }

  return chunks.join('\n');
}

/**
 * Builds initial prompt for a new milestone
 */
export async function buildMilestonePrompt(
  project: Project,
  module: Module
): Promise<string> {
  const filesContext = module.files.length > 0
    ? await buildFilesContext(module.files)
    : '(no files assigned yet)';

  const tasksText = module.tasks.map((t, i) => 
    `${i + 1}. ${t.title} (${t.status})${t.description ? ` - ${t.description}` : ''}`
  ).join('\n');

  return [
    `# Project: ${project.name}`,
    project.description ? `\n${project.description}\n` : '',
    `## Milestone: ${module.name}`,
    '',
    '### Tasks to complete:',
    tasksText || '(no tasks defined)',
    '',
    '### Files in context:',
    filesContext,
    '',
    '---',
    '',
    '# Instructions for LLM:',
    '',
    'Analyze the code and tasks above. Propose changes using this format:',
    '',
    '**IMPORTANT: Wrap ALL operations in triple backticks ```**',
    '',
    '## Create new file:',
    '```',
    '<<<CREATE: path/to/newFile.ts>>>',
    'file content here',
    '<<<END>>>',
    '```',
    '',
    '## Delete file:',
    '```',
    '<<<DELETE: path/to/file.ts>>>',
    '<<<END>>>',
    '```',
    '',
    '## Rename/Move file:',
    '```',
    '<<<RENAME: old/path.ts -> new/path.ts>>>',
    '<<<END>>>',
    '```',
    '',
    '## Modify existing file:',
    '```',
    '<<<FILE: path/to/file.ts>>>',
    '<<<SEARCH>>>',
    'exact text to find',
    '<<<REPLACE>>>',
    'replacement text',
    '<<<END>>>',
    '```',
    '',
    '**Rules:**',
    '- SEARCH must match existing text exactly',
    '- REPLACE is the new content',
    '- Use multiple blocks for multiple operations',
    '- Everything inside one ``` block',
  ].join('\n');
}

/**
 * Builds continuation prompt (when user adds more instructions)
 */
export async function buildContinuationPrompt(
  project: Project,
  module: Module,
  userMessage: string
): Promise<string> {
  return [
    `# Continue: ${project.name} / ${module.name}`,
    '',
    '## Status:',
    '- All previous changes have been applied',
    '- Current repository state is source of truth',
    '',
    '## User Request:',
    userMessage || '(no additional instructions)',
    '',
    '---',
    '',
    '# Response Format (unchanged):',
    '',
    '**Wrap ALL operations in triple backticks ```**',
    '',
    '## Operations:',
    '- CREATE: `<<<CREATE: path>>>...<<<END>>>`',
    '- DELETE: `<<<DELETE: path>>><<<END>>>`',
    '- RENAME: `<<<RENAME: old -> new>>><<<END>>>`',
    '- MODIFY: `<<<FILE: path>>><<<SEARCH>>>...<<<REPLACE>>>...<<<END>>>`',
  ].join('\n');
}

/**
 * Builds prompt for adding new files to context
 */
export async function buildAddFilesPrompt(
  module: Module,
  newFiles: string[]
): Promise<string> {
  const filesContext = await buildFilesContext(newFiles);

  return [
    `# Context Update: ${module.name}`,
    '',
    'The following files are being ADDED to the conversation context.',
    'Do NOT propose changes - just acknowledge the code context.',
    '',
    '## New Files:',
    filesContext,
  ].join('\n');
}