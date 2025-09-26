import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Rozszerzenie do diff z LLM
 * - Używa formatu SEARCH/REPLACE zamiast unified diff
 * - Prostsze i zawsze działa
 */

let LAST_PROMPT: string | null = null;

const outputChannel = vscode.window.createOutputChannel('LLM Diff');

function log(message: string) {
  outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

async function pickFiles(globPattern: string): Promise<vscode.Uri[]> {
  const uris = await vscode.workspace.findFiles(
    globPattern,
    '**/{node_modules,dist,.next,.git,build,out,coverage}/**'
  );
  const picks = await vscode.window.showQuickPick(
    uris.map(u => ({
      label: vscode.workspace.asRelativePath(u),
      description: u.fsPath,
      picked: true,
    })),
    { canPickMany: true, title: 'Wybierz pliki do promptu' }
  );
  return picks ? picks.map(p => vscode.Uri.file(p.description!)) : [];
}

async function buildContext(selected: vscode.Uri[]): Promise<{ content: string, paths: string[] }> {
  const chunks: string[] = [];
  const paths: string[] = [];
  
  for (const uri of selected) {
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

function buildPrompt(task: string, context: string, filePaths: string[]) {
  const examplePath = filePaths[0] || 'src/example.ts';
  
  return [
    '# Zadanie',
    task,
    '',
    '# ZWRÓĆ W FORMACIE:',
    '```',
    `<<<FILE: ${examplePath}>>>`,
    '<<<SEARCH>>>',
    '/* to jest plik do przetestowania rozszerzeia */',
    '<<<REPLACE>>>',
    '/* to jest plik do przetestowania rozszerzeia */',
    'console.log("added")',
    '<<<END>>>',
    '```',
    '',
    'SEARCH = dokładna zawartość do znalezienia',
    'REPLACE = czym zastąpić',
    '',
    '# Pliki:',
    context,
  ].join('\n');
}

async function requestDiffCmd() {
  const globInput = await vscode.window.showInputBox({
    value: 'src/**/*.{ts,tsx,js,jsx}',
    prompt: 'Podaj glob plików',
  });
  if (!globInput) return;

  const files = await pickFiles(globInput);
  if (!files.length) return;

  const task = await vscode.window.showInputBox({
    prompt: 'Opisz zadanie',
  });
  if (!task) return;

  const { content, paths } = await buildContext(files);
  const promptText = buildPrompt(task, content, paths);
  LAST_PROMPT = promptText;

  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: promptText,
  });
  await vscode.window.showTextDocument(doc);
  await vscode.env.clipboard.writeText(promptText);
  
  log(`Prompt skopiowany dla plików: ${paths.join(', ')}`);
  vscode.window.showInformationMessage('Prompt skopiowany do schowka');
}

interface SearchReplaceBlock {
  file: string;
  search: string;
  replace: string;
}

function extractSearchReplace(text: string): SearchReplaceBlock[] | null {
  const blocks: SearchReplaceBlock[] = [];
  
  // Regex dla naszego formatu
  const regex = /<<<FILE:\s*(.+?)>>>\s*<<<SEARCH>>>([\s\S]*?)<<<REPLACE>>>([\s\S]*?)<<<END>>>/g;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      file: match[1].trim(),
      search: match[2].trim(),
      replace: match[3].trim()
    });
    log(`Znaleziono blok dla pliku: ${match[1]}`);
  }
  
  if (blocks.length === 0) {
    log('Nie znaleziono bloków SEARCH/REPLACE');
    return null;
  }
  
  return blocks;
}

async function applySearchReplace(blocks: SearchReplaceBlock[]) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage('Brak otwartego folderu');
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const block of blocks) {
    try {
      const filePath = path.join(root.fsPath, block.file);
      log(`Przetwarzam plik: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        log(`Plik nie istnieje: ${filePath}`);
        errorCount++;
        continue;
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      
      if (!content.includes(block.search)) {
        log(`Nie znaleziono tekstu do zamiany w pliku ${block.file}`);
        log(`Szukano: [${block.search}]`);
        log(`W pliku jest: [${content}]`);
        errorCount++;
        continue;
      }
      
      const newContent = content.replace(block.search, block.replace);
      fs.writeFileSync(filePath, newContent, 'utf8');
      
      log(`Zastosowano zmianę w pliku: ${block.file}`);
      successCount++;
      
    } catch (e: any) {
      log(`Błąd przy przetwarzaniu ${block.file}: ${e.message}`);
      errorCount++;
    }
  }
  
  if (successCount > 0 && errorCount === 0) {
    vscode.window.showInformationMessage(`Zastosowano ${successCount} zmian!`);
  } else if (errorCount > 0) {
    vscode.window.showWarningMessage(`Zastosowano ${successCount} zmian, ${errorCount} błędów - sprawdź Output`);
    outputChannel.show();
  }
}

async function insertDiffCmd() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Wklej odpowiedź z chatu i zaznacz ją');
    return;
  }

  const text = editor.selection && !editor.selection.isEmpty
    ? editor.document.getText(editor.selection)
    : editor.document.getText();

  const blocks = extractSearchReplace(text);
  
  if (!blocks) {
    vscode.window.showErrorMessage('Nie znaleziono bloków <<<FILE>>> <<<SEARCH>>> <<<REPLACE>>>');
    outputChannel.show();
    return;
  }

  await applySearchReplace(blocks);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.requestDiff', requestDiffCmd),
    vscode.commands.registerCommand('llmDiff.insertDiff', insertDiffCmd),
  );
}

export function deactivate() {}