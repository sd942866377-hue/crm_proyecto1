#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v omniroute &> /dev/null; then
  echo "Instalando OmniRoute..."
  npm install -g omniroute --quiet
  echo "OmniRoute instalado."
fi

if ! pgrep -f "omniroute" > /dev/null 2>&1; then
  echo "Iniciando OmniRoute gateway..."
  nohup omniroute > /tmp/omniroute.log 2>&1 &
  echo "OmniRoute iniciado en http://localhost:20128/v1"
else
  echo "OmniRoute ya esta corriendo."
fi
