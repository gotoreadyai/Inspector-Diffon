import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

/**
 * Proste rozszerzenie z DWOMA komendami:
 * 1) "LLM Diff: request diff"  – buduje prompt i kopiuje go do schowka.
 *    Model MA ODPOWIADAĆ WYŁĄCZNIE blokiem ```diff (jeden fenced block).
 * 2) "LLM Diff: insert diff"   – pobiera odpowiedź (z aktywnego edytora),
 *    wycina wyłącznie fenced ```diff i stosuje patch przez `git apply --3way`.
 *
 * Jeśli odpowiedź NIE zawiera jedynego poprawnego fenced ```diff:
 *  - rozszerzenie dołączy do poprzedniego promptu mocniejszy dopisek
 *    „ODPOWIEDZ WYŁĄCZNIE BLOKIEM ```diff”, otworzy go ponownie i skopiuje.
 *  - powtarzaj cykl aż model zwróci poprawny blok diff.
 */

let LAST_PROMPT: string | null = null;
let REINFORCE_COUNT = 0;

/** Nagłówek ścieżki. */
function headerFor(p: string) {
  return `// path: ${p}\n`;
}

/** Wybór plików (ignoruje build/cache). */
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

/** Buduje kontekst plików (jako fenced bloki, by było czytelnie). */
async function buildContext(selected: vscode.Uri[]): Promise<string> {
  const chunks: string[] = [];
  for (const uri of selected) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const lang = doc.languageId || path.extname(uri.fsPath).replace('.', '') || 'txt';
    chunks.push(headerFor(vscode.workspace.asRelativePath(uri)));
    chunks.push('```' + lang + '\n' + doc.getText() + '\n```\n');
  }
  return chunks.join('\n');
}

/** Footer wzmacniający – powtarzany przy błędnej odpowiedzi. */
function reinforcementFooter(n: number) {
  if (n <= 0) return '';
  const line = 'ODPOWIEDZ TYLKO W JEDNYM BLOKU ```diff – BEZ OPISÓW, BEZ DODATKOWEGO TEKSTU.';
  return '\n' + Array(n).fill(line).join('\n');
}

/** Buduje finalny prompt oczekujący WYŁĄCZNIE fenced ```diff w odpowiedzi. */
function buildPrompt(task: string, context: string, reinforceTimes = 0) {
  return [
    '# Zadanie dla LLM',
    '',
    'INSTRUKCJE (BEZWZGLĘDNE):',
    '1) ZWRÓĆ WYŁĄCZNIE JEDEN fenced block: ```diff ... ```',
    '2) W bloku umieść poprawny unified diff (nagłówki `--- a/...`, `+++ b/...`, hunki `@@`).',
    '3) Poza blokiem ```diff NIE WOLNO nic pisać (zero opisów, nagłówków, list).',
    '4) Użyj dokładnie ścieżek z sekcji „Pliki”.',
    '',
    'Opis zadania:',
    task,
    '',
    'Pliki (kontekst – nie kopiuj ich poza blokiem diff):',
    context,
    reinforcementFooter(reinforceTimes),
  ].join('\n');
}

/** Komenda: request diff – tworzy i kopiuje prompt. */
async function requestDiffCmd() {
  const globInput = await vscode.window.showInputBox({
    value: 'src/**/*.{ts,tsx,js,jsx}',
    prompt: 'Podaj glob plików',
  });
  if (!globInput) return;

  const files = await pickFiles(globInput);
  if (!files.length) return;

  const task = await vscode.window.showInputBox({
    prompt: 'Opisz zadanie (np. dodaj komentarz na początku pliku)',
  });
  if (!task) return;

  const ctxText = await buildContext(files);
  const promptText = buildPrompt(task, ctxText, REINFORCE_COUNT);
  LAST_PROMPT = promptText;

  const doc = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: promptText,
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.env.clipboard.writeText(promptText);
  vscode.window.showInformationMessage('Prompt skopiowany do schowka. Wyślij go do LLM.');
}

/** Wyciąga *jedyny* fenced ```diff i zwraca jego środek.
 *  Dodatkowo: jeśli nie ma fence’a, akceptuje surowy unified diff w całym tekście.
 */
function extractFencedDiff(text: string): string | null {
  const fencedRe = /```diff\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const hits: string[] = [];
  while ((m = fencedRe.exec(text)) !== null) {
    hits.push((m[1] ?? '').trim());
  }
  if (hits.length === 1) {
    const inner = hits[0];
    // szybka walidacja nagłówków unified diff
    if (/(^|\n)---\s+a\/.+\n\+\+\+\s+b\/.+/.test(inner)) return inner;
    return null;
  }
  if (hits.length > 1) return null; // zbyt wiele bloków

  // Fallback: brak fenced – sprawdź, czy cały tekst wygląda jak unified diff
  const raw = text.trim();
  if (/^(?:---\s+a\/.+\n\+\+\+\s+b\/.+)/m.test(raw)) {
    return raw;
  }
  return null;
}

/** Zastosowanie patcha przez git apply --3way (z preflight --check). */
async function applyDiffViaGit(diffText: string) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    vscode.window.showErrorMessage('Brak otwartego folderu roboczego.');
    return;
  }
  const filename = `llm_patch_${Date.now()}.diff`;
  const target = vscode.Uri.joinPath(root, filename);
  await vscode.workspace.fs.writeFile(target, Buffer.from(diffText, 'utf8'));

  // Preflight
  await new Promise<void>((resolve, reject) => {
    cp.execFile('git', ['apply', '--3way', '--check', filename], { cwd: root.fsPath }, (err, _s, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  }).catch(e => {
    vscode.window.showErrorMessage(`Weryfikacja patcha nie powiodła się: ${e?.message ?? e}`);
    throw e;
  });

  // Apply
  await new Promise<void>((resolve, reject) => {
    cp.execFile('git', ['apply', '--3way', filename], { cwd: root.fsPath }, (err, _s, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  }).then(() => {
    vscode.window.showInformationMessage('Patch zastosowany pomyślnie.');
  }).catch(e => {
    vscode.window.showErrorMessage(`Zastosowanie patcha nie powiodło się: ${e?.message ?? e}`);
  });
}

/**
 * Komenda: insert diff – pobiera odpowiedź z aktywnego edytora,
 * wycina JEDEN blok ```diff i stosuje go. W przeciwnym wypadku wzmacnia prompt.
 * Ulepszenia:
 *  - jeśli jest zaznaczenie, używa zaznaczonego fragmentu zamiast całego dokumentu,
 *  - akceptuje także „surowy” unified diff (bez fenced ```diff).
 */
async function insertDiffCmd() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  // Jeśli jest zaznaczenie – użyj zaznaczenia, inaczej cały dokument
  const raw = editor.selection && !editor.selection.isEmpty
    ? editor.document.getText(editor.selection)
    : editor.document.getText();

  const inner = extractFencedDiff(raw);

  if (!inner) {
    // Brak poprawnego pojedynczego bloku diff ➜ wzmacniamy prompt i prosimy o ponowną odpowiedź.
    REINFORCE_COUNT++;
    if (!LAST_PROMPT) {
      vscode.window.showErrorMessage('Brak poprzedniego promptu do wzmocnienia. Użyj najpierw „request diff”.');
      return;
    }
    const reinforced = LAST_PROMPT + reinforcementFooter(1);
    LAST_PROMPT = reinforced;

    const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: reinforced });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.env.clipboard.writeText(reinforced);
    vscode.window.showWarningMessage('Nie znaleziono JEDNEGO poprawnego bloku ```diff. Wzmocniłem prompt – wyślij ponownie do LLM.');
    return;
  }

  // Udało się – resetujemy licznik i stosujemy patch
  REINFORCE_COUNT = 0;
  await applyDiffViaGit(inner);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('llmDiff.requestDiff', requestDiffCmd),
    vscode.commands.registerCommand('llmDiff.insertDiff', insertDiffCmd),
  );
}

export function deactivate() {}
