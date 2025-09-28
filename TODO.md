Kolejność operacji (parsing)

Problem: OperationsParser.parse wykonuje cztery niezależne pętle po całym tekście. To gubi kolejność bloków (CREATE/DELETE/RENAME/SR), co przy zależnościach może psuć wynik.

Fix: parsować jednym skanerem po tekście, wykrywając pierwszy pasujący znacznik i dodając do listy, lub użyć jednego regexu z nazwanym typem i potem switch. Alternatywnie tokenizacja markerów i jednolity FSM.

Tylko pierwszy blok ``` w /apply*

Problem: w applyOperations wyciągasz wyłącznie PIERWSZY fenced code block (/```([\s\S]*?)```/). Jeśli użytkownik wklei kilka bloków — reszta przepada.

Fix: użyj globalnego dopasowania i sklej wszystkie znalezione bloki (albo, jeśli brak fence’ów, bierz cały tekst).

„Commit/Undo” bez weryfikacji

Problem: commitTask()/undoTask() odpalają polecenia w Terminalu i od razu ustawiają status (committed/undone) — nawet jeśli git się wywali.

Fix: skorzystać z API rozszerzenia Git (vscode.git) lub uruchamiać proces (child_process) i czekać na kod wyjścia. Status aktualizować dopiero po sukcesie.

Operacje plikowe synchroniczne w krytyku UI

Problem: TaskManager.saveTask() i loadRecentTasks() używają sync I/O. To może blokować Extension Host przy większej liczbie zadań.

Fix: przejść na fs.promises i wersje async; batche I/O poza gorącą ścieżką UI.

Utrata zadania po restarcie

Problem: currentTask nie jest odtwarzane przy starcie — użytkownik traci kontekst.

Fix: zapisywać currentTaskId w workspaceState i ładować go w activate() (lub dodać listę „ostatnie zadania” do wyboru).

Aktywacja widoków

Problem: brak onView:llmDiffFiles / onView:llmDiffTaskInfo w activationEvents. Widoki mogą nie ruszyć, dopóki nie wywołasz komendy.

Fix: dodać do package.json:

"onView:llmDiffFiles", "onView:llmDiffTaskInfo".

Zestawy zaznaczeń → ścieżki absolutne

Problem: savedSets trzyma absolutne ścieżki (fsPath). Zmiana lokalizacji repo psuje zestawy; rename plików też.

Fix: przechowywać ścieżki relatywne i ew. walidować z vscode.workspace.asRelativePath + fallback na „best effort” dopasowanie.

Watcher ≠ exclude

Problem: FileSystemWatcher bierze tylko glob wzorca; excludy masz w findFiles, ale watcher może nie odzwierciedlać tych wykluczeń, gdy zmienisz glob.

Fix: utrzymuj osobny filtr przy obsłudze zdarzeń (np. odrzucaj zmiany spoza **/{src,...}) albo skonstruuj glob tak, by faktycznie eliminował katalogi ciężkie.

Selektor folderu i Windows

Detal: selectFolder używa path.sep. Przy porównaniach z asRelativePath bywa różnie na Win (backslashy vs slashy).

Fix: normalizować ścieżki do / przed startsWith.

UI/UX drobnice

getTreeItem nadpisuje klik pliku akcją toggle — nie otworzysz pliku pojedynczym kliknięciem. Warto dodać akcję toggle do kontekstu, a domyślny klik pozostawić na otwieranie.

Ikona $(discard) w QuickPick może nie istnieć — lepiej użyć $(trash).

Limit wielkości kontekstu

Problem: buildContext ładuje pełne pliki bez limitu — łatwo zalać prompt.

Fix: soft limit (np. 2000 linii/200 KB per plik) + informacja o przycięciu; opcjonalnie diff/fragmenty.

„Search/Replace” semantyka

Obecnie: wymagany dokładny search, a potem split().join() — zamienia wszystkie wystąpienia. Bywa, że użytkownik chciał jedno.

Fix: dodać opcje count / nth, lub chociaż telemetry w Output z liczbą podmian; ewentualnie ostrzeżenie przy >1 trafieniu.

Id zadań

id = Date.now().toString() — możliwe kolizje przy równoległym starcie na 2 procesach.

Fix: crypto.randomUUID().

„notifySelectionChanged”

Martwy hook.

Fix: albo go usuń z przepływu, albo nadaj mu sens (np. aktualizacja status bara/TaskInfo).

Commit „git add .”

To wciąga „śmieci” spoza zadania.

Fix: add tylko affectedFiles (z normalizacją rename), a dla CREATE/RENAME dodać ścieżkę docelową.