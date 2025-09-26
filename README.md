# LLM Diff Generator

Rozszerzenie do pracy z LLM w trybie ręcznym.  
Pozwala przygotować prompt z wybranych plików i stosować diff zwrócony przez model bezpośrednio przez `git apply`.

---

## Workflow

1. **`LLM Diff: request diff`**  
   - wybierz pliki i wpisz opis zadania,  
   - rozszerzenie wygeneruje prompt i skopiuje go do schowka.  
   - wyślij ten prompt do LLM.  
   - ⚠️ Model musi odpowiedzieć **jednym blokiem ```diff** z poprawnym unified diffem.

2. Skopiuj odpowiedź LLM i wklej do edytora w VS Code.

3. **`LLM Diff: insert diff`**  
   - rozszerzenie wytnie blok ```diff, zapisze go jako `llm_patch_<ts>.diff`  
   - zapyta, czy zastosować patch (`git apply --3way`).  

---

## Zasady odpowiedzi LLM

- **Jedyny dopuszczalny format:** blok kodu z tagiem `diff`.  
- Zero opisów, komentarzy, nagłówków poza blokiem.  
- Przykład poprawnej odpowiedzi:

```diff
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
+// działa!
 console.log("Hello world");
# Inspector-Diffon
# Inspector-Diffon
