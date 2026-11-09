#!/usr/bin/env bash
# Gera o pacote .deb do hacker.ia em dist/.
# Uso:  bash build-deb.sh
set -eu
cd "$(dirname "$0")"

PKG=hacker-ia
VER=$(node -p "require('./package.json').version" 2>/dev/null || echo 0.1.0)
ARCH=$(dpkg --print-architecture)
ROOT=$(mktemp -d)
APPDIR="$ROOT/opt/hacker.ia"

echo ">> montando árvore do pacote ($PKG $VER $ARCH)"
mkdir -p "$APPDIR" "$ROOT/DEBIAN" "$ROOT/usr/bin" "$ROOT/usr/share/applications"

# Fontes do app (sem binários/modelos/node_modules — o postinst baixa/instala)
for f in main.js preload.js renderer CLAUDE.md scope.yaml config.json setup.sh \
         package.json package-lock.json LICENSE README.md docs; do
  [ -e "$f" ] && cp -r "$f" "$APPDIR/"
done

# ---- metadados ----
cat > "$ROOT/DEBIAN/control" <<EOF
Package: $PKG
Version: $VER
Section: utils
Priority: optional
Architecture: $ARCH
Depends: nodejs (>= 18.0.0), npm, alsa-utils, curl, bash, libgtk-3-0, libnss3, libasound2, libgbm1, libxss1
Recommends: nmap, ffuf, nikto, gobuster, hydra
Maintainer: Hiagolim11 <Hiagolim11@users.noreply.github.com>
Description: Assistente de pentest por voz estilo Jarvis para Kali Linux
 Interface Electron com orb reativo, voz neural pt-BR (Piper), reconhecimento
 de fala offline (whisper.cpp) e cerebro de IA local (Ollama) ou nuvem (Claude).
 Use somente em ambientes autorizados: laboratorio proprio, CTF ou engajamento
 com autorizacao por escrito.
EOF

# ---- postinst: instala Electron e baixa modelos (tolerante a falha) ----
cat > "$ROOT/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
APP=/opt/hacker.ia
echo "hacker.ia: instalando dependencias Node (Electron)..."
( cd "$APP" && npm install --omit=dev --no-audit --no-fund ) >/tmp/hacker-ia-npm.log 2>&1 \
  || echo "  aviso: npm install falhou — rode 'cd $APP && npm install' (log: /tmp/hacker-ia-npm.log)"
echo "hacker.ia: baixando voz neural e modelo de fala (pode demorar)..."
( cd "$APP" && bash setup.sh ) >/tmp/hacker-ia-setup.log 2>&1 \
  || echo "  aviso: download de modelos incompleto — rode 'cd $APP && bash setup.sh' (log: /tmp/hacker-ia-setup.log)"
chmod -R a+rX "$APP" 2>/dev/null || true
chmod +x "$APP/piper/piper" 2>/dev/null || true
echo "hacker.ia instalado. Abra pelo menu ou rode:  hacker-ia"
exit 0
EOF
chmod 0755 "$ROOT/DEBIAN/postinst"

# ---- launcher ----
cat > "$ROOT/usr/bin/hacker-ia" <<'EOF'
#!/bin/sh
cd /opt/hacker.ia || exit 1
exec ./node_modules/.bin/electron . "$@"
EOF
chmod 0755 "$ROOT/usr/bin/hacker-ia"

# ---- entrada no menu ----
cat > "$ROOT/usr/share/applications/hacker-ia.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=hacker.ia
Comment=Assistente de pentest por voz (Jarvis)
Exec=hacker-ia
Icon=utilities-terminal
Terminal=false
Categories=Security;Utility;
EOF

mkdir -p dist
OUT="dist/${PKG}_${VER}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "$ROOT" "$OUT" >/dev/null
rm -rf "$ROOT"
echo ">> gerado: $OUT"
dpkg-deb --info "$OUT" | sed -n '1,20p'
