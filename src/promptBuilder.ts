import * as vscode from 'vscode';

export async function buildPrompt(taskDescription: string, files: vscode.Uri[], taskName: string): Promise<string> {
  const context = await buildContext(files);
  const examplePath = context.paths[0] || 'src/example.ts';
  
  return [
    '# Task: ' + taskName,
    '',
    '## Description:',
    taskDescription,
    '',
    '# Output Format:',
    '',
    'IMPORTANT: Wrap your entire response in ``` code blocks',
    '',
    '## For creating new files:',
    '```',
    `<<<CREATE: path/to/newfile.ts>>>`,
    'file content here',
    '<<<END>>>',
    '```',
    '',
    '## For deleting files:',
    '```',
    `<<<DELETE: path/to/oldfile.ts>>>`,
    '<<<END>>>',
    '```',
    '',
    '## For renaming/moving files:',
    '```',
    `<<<RENAME: old/path.ts -> new/path.ts>>>`,
    '<<<END>>>',
    '```',
    '',
    '## For modifying existing files:',
    '```',
    `<<<FILE: ${examplePath}>>>`,
    '<<<SEARCH>>>',
    'exact text to find',
    '<<<REPLACE>>>',
    'text to replace with',
    '<<<END>>>',
    '```',
    '',
    'Important:',
    '- SEARCH must be exact text that exists in the file',
    '- REPLACE is what to replace it with',
    '- You can use multiple blocks for multiple operations',
    '- Wrap everything in ``` code blocks',
    '',
    '# Files to work with:',
    context.content,
  ].join('\n');
}

async function buildContext(files: vscode.Uri[]): Promise<{ content: string, paths: string[] }> {
  const chunks: string[] = [];
  const paths: string[] = [];
  
  for (const uri of files) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const relPath = vscode.workspace.asRelativePath(uri);
    paths.push(relPath);
    
    const lang = doc.languageId || 'txt';
    chunks.push(`// path: ${relPath}`);
    chunks.push('```' + lang);
    chunks.push(doc.getText());
    chunks.push('```\n');
  }
  
  return { content: chunks.join('\n'), paths };
}