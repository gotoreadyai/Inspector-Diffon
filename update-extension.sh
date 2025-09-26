#!/usr/bin/env bash
set -e

# Ścieżka do katalogu rozszerzenia
EXT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$EXT_DIR"

# 1. Podbij patch version w package.json
echo "🔄 Podbijam wersję w package.json..."
npm version patch --no-git-tag-version

# 2. Budowanie paczki (z automatycznym "yes" na pytania)
echo "📦 Buduję paczkę..."
yes | vsce package --allow-missing-repository

# znajdź najnowszy .vsix
VSIX_FILE=$(ls -t *.vsix | head -n 1)

# 3. Instalacja w VSCode
echo "⚡ Instaluję rozszerzenie: $VSIX_FILE"
code --install-extension "$VSIX_FILE" --force

echo "✅ Rozszerzenie zaktualizowane!"
echo "ℹ️ Zrestartuj VSCode lub użyj: Ctrl+Shift+P → Reload Window"