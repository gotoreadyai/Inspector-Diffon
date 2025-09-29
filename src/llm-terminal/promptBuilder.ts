import * as vscode from 'vscode';
import * as path from 'path';
import { Module, Project } from '../project-manager/types';


/**
 * Builds context string from files
 */
async function buildFilesContext(files: string[]): Promise<string> {
  const chunks: string[] = [];
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  
  if (!workspaceRoot) {
    return '(workspace not found)';
  }

  for (const filePath of files) {
    try {
      // Convert relative path to absolute
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(workspaceRoot, filePath);
      
      const uri = vscode.Uri.file(absolutePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const relPath = vscode.workspace.asRelativePath(uri);
      const lang = doc.languageId || 'txt';

      chunks.push(`// path: ${relPath}\n\`\`\`${lang}\n${doc.getText()}\n\`\`\`\n`);
    } catch (e) {
      chunks.push(`// Error reading: ${filePath}\n`);
    }
  }

  return chunks.join('\n');
}

/**
 * Get added files (files that are in module but not in initialFiles)
 */
function getAddedFiles(module: Module): string[] {
  const initialSet = new Set(module.initialFiles || []);
  return module.files.filter(f => !initialSet.has(f));
}

/**
 * Builds initial prompt for a new milestone
 */
export async function buildMilestonePrompt(
  project: Project,
  module: Module
): Promise<string> {
  const initialFiles = module.initialFiles || [];
  const addedFiles = getAddedFiles(module);
  
  let output = `# Project: ${project.name}\n`;
  if (project.description) {
    output += `\n${project.description}\n`;
  }
  output += `## Milestone: ${module.name}\n\n### Tasks to complete:\n`;

  const tasksText = module.tasks.map((t, i) => 
    `${i + 1}. ${t.title} (${t.status})${t.description ? ` - ${t.description}` : ''}`
  ).join('\n');
  
  output += tasksText || '(no tasks defined)';
  output += '\n\n';

  // Initial files section
  if (initialFiles.length > 0) {
    output += '### Files in context:\n';
    output += await buildFilesContext(initialFiles);
    output += '\n';
  }

  // Added files section (if any)
  if (addedFiles.length > 0) {
    output += '### Recently added files:\n';
    output += '**Note: These files were added to context mid-milestone. Acknowledge their presence and integrate them into your understanding.**\n\n';
    output += await buildFilesContext(addedFiles);
    output += '\n';
  }

  // If no files at all
  if (initialFiles.length === 0 && addedFiles.length === 0) {
    output += '### Files in context:\n(no files assigned yet)\n\n';
  }

  output += `---

# Instructions for LLM:

Analyze the code and tasks above. Propose changes using this format:

**IMPORTANT: Wrap ALL operations in triple backticks \`\`\`**

## Create new file:
\`\`\`
<<<CREATE: path/to/newFile.ts>>>
file content here
<<<END>>>
\`\`\`

## Delete file:
\`\`\`
<<<DELETE: path/to/file.ts>>>
<<<END>>>
\`\`\`

## Rename/Move file:
\`\`\`
<<<RENAME: old/path.ts -> new/path.ts>>>
<<<END>>>
\`\`\`

## Modify existing file (PREFERRED):
\`\`\`
<<<FILE: path/to/file.ts>>>
<<<SEARCH>>>
exact text to find
<<<REPLACE>>>
replacement text
<<<END>>>
\`\`\`

## Overwrite entire file (USE SPARINGLY - only for major refactors):
\`\`\`
<<<FILE: path/to/file.ts>>>
entire new file content
<<<END>>>
\`\`\`

**Rules:**
- PREFER SEARCH/REPLACE over OVERWRITE when possible
- SEARCH must match existing text exactly
- REPLACE is the new content
- OVERWRITE replaces the entire file - use only when necessary
- Use multiple blocks for multiple operations
- Everything inside one \`\`\` block`;

  return output;
}

/**
 * Builds continuation prompt (when user adds more instructions)
 */
export async function buildContinuationPrompt(
  project: Project,
  module: Module,
  userMessage: string
): Promise<string> {
  return `# Continue: ${project.name} / ${module.name}

## Status:
- All previous changes have been applied
- Current repository state is source of truth

## User Request:
${userMessage || '(no additional instructions)'}

---

# Response Format (unchanged):

**Wrap ALL operations in triple backticks \`\`\`**

## Operations:
- CREATE: \`<<<CREATE: path>>>...<<<END>>>\`
- DELETE: \`<<<DELETE: path>>><<<END>>>\`
- RENAME: \`<<<RENAME: old -> new>>><<<END>>>\`
- MODIFY (preferred): \`<<<FILE: path>>><<<SEARCH>>>...<<<REPLACE>>>...<<<END>>>\`
- OVERWRITE (use sparingly): \`<<<FILE: path>>>[content]<<<END>>>\``;
}

/**
 * Builds prompt for adding new files to context
 */
export async function buildAddFilesPrompt(
  module: Module,
  newFiles: string[]
): Promise<string> {
  const filesContext = await buildFilesContext(newFiles);

  return `# Context Update: ${module.name}

The following files are being ADDED to the conversation context.
Do NOT propose changes - just acknowledge the code context.

## New Files:
${filesContext}`;
}