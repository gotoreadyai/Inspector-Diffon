// path: src/promptBuilder.ts
import * as vscode from 'vscode';
import { Task } from './taskManager';

export async function buildPrompt(
  taskDescription: string,
  files: vscode.Uri[],
  taskName: string,
  isIncremental: boolean = false
): Promise<string> {
  const context = await buildContext(files);
  const examplePath = context.paths[0] || 'src/example.ts';

  const header = isIncremental
    ? `# Zadanie: ${taskName} (dodano ${files.length} plików)\n\n## Kontynuacja z dodatkowymi plikami:`
    : `# Zadanie: ${taskName}`;

  return [
    header,
    '',
    '## Opis:',
    taskDescription,
    '',
    '# Format wyjścia:',
    '',
    'WAŻNE: Owiń CAŁĄ odpowiedź w bloki ``` (triple backticks)',
    '',
    '## Tworzenie nowego pliku:',
    '```',
    `<<<CREATE: ścieżka/do/nowegoPliku.ts>>>`,
    'zawartość pliku',
    '<<<END>>>',
    '```',
    '',
    '## Usuwanie pliku:',
    '```',
    `<<<DELETE: ścieżka/do/pliku.ts>>>`,
    '<<<END>>>',
    '```',
    '',
    '## Zmiana nazwy / przeniesienie:',
    '```',
    `<<<RENAME: stara/ścieżka.ts -> nowa/ścieżka.ts>>>`,
    '<<<END>>>',
    '```',
    '',
    '## Modyfikacja istniejącego pliku:',
    '```',
    `<<<FILE: ${examplePath}>>>`,
    '<<<SEARCH>>>',
    'dokładny_tekst_do_znalezienia',
    '<<<REPLACE>>>',
    'tekst_zastępczy',
    '<<<END>>>',
    '```',
    '',
    'Ważne:',
    '- SEARCH musi być dokładnym istniejącym fragmentem',
    '- REPLACE to docelowa treść (możesz wstawić duże bloki)',
    '- Używaj wielu bloków dla wielu operacji',
    '- Całość w jednym ```',
    '',
    '# Pliki w kontekście:',
    context.content,
  ].join('\n');
}

export async function buildFilesContextPrompt(
  newlyAddedFiles: vscode.Uri[],
  note?: string
): Promise<string> {
  const context = await buildContext(newlyAddedFiles);
  return [
    '# Aktualizacja kontekstu (dodane pliki)',
    '',
    'Poniższe pliki ZOSTAJĄ dodane do kontekstu rozmowy.',
    'Nie proponuj zmian — tylko potwierdź kontekst kodu.',
    note ? `\n> ${note}\n` : '',
    '## Pliki:',
    context.content,
  ].join('\n');
}

export async function buildChangeRequestPrompt(task: Task, message: string): Promise<string> {
  return [
    `# Kontynuuj zadanie: ${task.name}`,
    '',
    '## Status & Założenia',
    '- Wszystkie dotychczasowe zmiany zostały zastosowane do plików w repo.',
    '- Traktuj aktualny stan repozytorium jako źródło prawdy.',
    '',
    '## Prośba o zmianę',
    message || '(Brak dodatkowych instrukcji)',
    '',
    '# Format wyjścia (BEZ ZMIAN)',
    '',
    'WAŻNE: Owiń CAŁĄ odpowiedź w bloki ``` (triple backticks)',
    '',
    '## Create:',
    '```',
    '<<<CREATE: path/to/newfile.ts>>>',
    'file content here',
    '<<<END>>>',
    '```',
    '',
    '## Delete:',
    '```',
    '<<<DELETE: path/to/oldfile.ts>>>',
    '<<<END>>>',
    '```',
    '',
    '## Rename/Move:',
    '```',
    '<<<RENAME: old/path.ts -> new/path.ts>>>',
    '<<<END>>>',
    '```',
    '',
    '## Modify existing:',
    '```',
    '<<<FILE: path/to/file.ts>>>',
    '<<<SEARCH>>>',
    'exact text to find',
    '<<<REPLACE>>>',
    'text to replace with',
    '<<<END>>>',
    '```',
    '',
    'Notatki:',
    '- SEARCH musi być dokładny; REPLACE to nowa treść.',
    '- Użyj wielu bloków w razie potrzeby.',
  ].join('\n');
}

export async function buildContinuationPrompt(task: Task, continuation: string): Promise<string> {
  return buildChangeRequestPrompt(task, continuation);
}

async function buildContext(files: vscode.Uri[]): Promise<{ content: string; paths: string[] }> {
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
