#!/usr/bin/env bash
# Instala dependências do Jarvis no Kali e baixa os modelos de voz/ouvido.
# Rode:  cd ~/jarvis-os && bash setup.sh
set -u
cd "$(dirname "$0")"
mkdir -p models
ok(){ printf '\033[32m[ok]\033[0m %s\n' "$1"; }
no(){ printf '\033[33m[--]\033[0m %s\n' "$1"; }

echo "== Jarvis setup =="

# 1) Áudio (microfone/alto-falante) + Electron
if ! command -v arecord >/dev/null || ! command -v aplay >/dev/null; then
  echo ">> instalando alsa-utils (precisa de sudo)…"
  sudo apt-get update -qq && sudo apt-get install -y alsa-utils || no "falha no apt; instale alsa-utils manualmente"
fi
command -v arecord >/dev/null && ok "arecord/aplay" || no "arecord ausente"

if ! command -v npx >/dev/null; then no "node/npm ausente — instale: sudo apt-get install -y nodejs npm"; fi
echo ">> instalando Electron (npm)…"; npm install >/dev/null 2>&1 && ok "electron" || no "npm install falhou"

# 2) Piper (voz neural) — binário + voz pt-BR
if ! command -v piper >/dev/null && [ ! -x ./piper/piper ]; then
  echo ">> baixando Piper…"
  curl -fsSL -o piper.tgz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    && tar xzf piper.tgz && rm -f piper.tgz && ok "piper em ./piper/piper (ajuste piperBin no config.json)" \
    || no "download do Piper falhou — veja README"
fi
if [ ! -f models/pt_BR-faber-medium.onnx ]; then
  echo ">> baixando voz pt-BR (faber)…"
  base=https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium
  curl -fsSL -o models/pt_BR-faber-medium.onnx      "$base/pt_BR-faber-medium.onnx" \
    && curl -fsSL -o models/pt_BR-faber-medium.onnx.json "$base/pt_BR-faber-medium.onnx.json" \
    && ok "voz pt-BR" || no "download da voz falhou — veja README"
fi

# 3) whisper.cpp (ouvido) — modelo
if [ ! -f models/ggml-small.bin ]; then
  echo ">> baixando modelo whisper (small ~466MB)…"
  curl -fsSL -o models/ggml-small.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin \
    && ok "modelo whisper" || no "download do whisper falhou — veja README"
fi
command -v whisper-cli >/dev/null && ok "whisper-cli" || no "whisper-cli ausente — instale whisper.cpp (README) e ajuste whisperBin"

command -v claude >/dev/null && ok "claude (cérebro)" || no "claude ausente — instale o Claude Code"

echo
echo ">> verificação final:"
npm run -s check || true
echo
echo "Pronto. Rode:  npm start"
