# 01. Zainstaluj zależności
yarn install

# 02. Zainstaluj VSCE globalnie
yarn global add @vscode/vsce

----------------------------------

# 1. Skompiluj rozszerzenie
yarn compile

# 2. Spakuj rozszerzenie
yarn package

# 3.
code --install-extension vscode-llm-diff-x.x.x.vsix --force
