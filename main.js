'use strict';
const CHECK = process.argv.includes('--check');
// Electron só é necessário para a GUI; o modo --check roda só com Node.
let app, BrowserWindow, ipcMain;
if (!CHECK) ({ app, BrowserWindow, ipcMain } = require('electron'));
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-'));
const resolveModel = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));

// ---- dependency detection -------------------------------------------------
const has = bin => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
function deps() {
  return {
    brain:   cfg.brain === 'ollama' ? has('ollama') : has(cfg.claudeBin),
    record:  has(cfg.recordCmd),
    whisper: has(cfg.whisperBin) && fs.existsSync(resolveModel(cfg.whisperModel)),
    piper:   has(cfg.piperBin)   && fs.existsSync(resolveModel(cfg.piperModel)),
    play:    has(cfg.playCmd),
  };
}

// ---- --check mode (no GUI) ------------------------------------------------
if (CHECK) {
  const d = deps();
  console.log('Jarvis — verificação de dependências:');
  for (const [k, v] of Object.entries(d)) console.log(`  ${v ? 'OK ' : '-- '} ${k}`);
  const scope = fs.existsSync(path.join(ROOT, 'scope.yaml'));
  console.log(`  ${scope ? 'OK ' : '-- '} scope.yaml`);
  console.log(`  (cérebro: ${cfg.brain})`);
  // self-check: o cérebro é o único realmente obrigatório para conversar.
  process.exit(d.brain ? 0 : 1);
}

// ---- voice pipeline -------------------------------------------------------
let win = null, recProc = null, speakProc = null;
const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);

function startRecording() {
  const wav = path.join(TMP, `in-${Date.now()}.wav`);
  recProc = spawn(cfg.recordCmd, [...cfg.recordArgs, '-d', String(cfg.maxRecordSeconds), wav]);
  recProc.on('error', e => fail(`gravação falhou: ${e.message}`));
  recProc.once('close', () => {       // dispara no stop manual (SIGTERM) OU no limite -d
    if (!recProc) return;             // já tratado (ex.: erro)
    recProc = null;
    send('state', 'thinking');
    transcribe(wav);
  });
  send('state', 'listening');
}

function stopRecording() {
  if (recProc) recProc.kill('SIGTERM'); // o handler once('close') faz a transcrição
}

function transcribe(wav) {
  const d = deps();
  if (!d.whisper) {                  // sem STT: pede texto digitado em vez de travar
    send('state', 'idle');
    send('transcript', 'Transcrição indisponível — digite seu comando abaixo.');
    return;
  }
  const out = wav.replace(/\.wav$/, '');
  const w = spawn(cfg.whisperBin, ['-m', resolveModel(cfg.whisperModel),
    '-l', cfg.whisperLang, '-otxt', '-nt', '-of', out, '-f', wav]);
  w.on('error', e => fail(`whisper falhou: ${e.message}`));
  w.on('close', () => {
    let text = '';
    try { text = fs.readFileSync(out + '.txt', 'utf8').trim(); } catch {}
    if (!text) { send('state', 'idle'); return; }
    send('you', text);
    ask(text);
  });
}

function readPersona() {
  try { return fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'); } catch { return ''; }
}

let brainTimer = null;
const BRAIN_TIMEOUT = cfg.brainTimeoutMs || 180000; // 3B em CPU pode demorar na 1ª chamada

function onReply(reply) {
  clearTimeout(brainTimer);
  if (!reply) return send('state', 'idle');
  send('transcript', reply);
  speak(reply);
}

function ask(text) {
  const d = deps();
  if (!d.brain) return fail(cfg.brain === 'ollama'
    ? 'comando "ollama" não encontrado — instale o Ollama (veja README).'
    : 'comando "claude" não encontrado — instale o Claude Code.');
  send('state', 'thinking');
  clearTimeout(brainTimer);
  brainTimer = setTimeout(() => fail('O cérebro demorou demais. Tente de novo ou use um modelo mais leve.'), BRAIN_TIMEOUT);
  return cfg.brain === 'ollama' ? askOllama(text) : askClaude(text);
}

function askClaude(text) {
  const c = spawn(cfg.claudeBin, [...cfg.claudeArgs, text], { cwd: ROOT });
  let out = '', err = '';
  c.stdout.on('data', b => (out += b));
  c.stderr.on('data', b => (err += b));
  c.on('error', e => fail(`claude falhou: ${e.message}`));
  c.on('close', code => onReply(out.trim() || (code ? `Erro do cérebro: ${err.trim().slice(0, 200)}` : '')));
}

function askOllama(text) {
  // Ollama não carrega o CLAUDE.md: injeta persona + escopo no prompt. API HTTP = texto limpo.
  let scope = ''; try { scope = fs.readFileSync(path.join(ROOT, 'scope.yaml'), 'utf8'); } catch {}
  const prompt = `${readPersona()}\n\n[scope.yaml]\n${scope}\n\nOperador: ${text}\nJarvis:`;
  const body = JSON.stringify({ model: cfg.ollamaModel, prompt, stream: false });
  const req = http.request({ host: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
    let out = '';
    res.on('data', b => (out += b));
    res.on('end', () => {
      try { onReply((JSON.parse(out).response || '').trim()); }
      catch { fail('resposta inválida do Ollama.'); }
    });
  });
  req.on('error', e => fail(`Ollama falhou: ${e.message} (o serviço está rodando?)`));
  req.write(body); req.end();
}

function speak(text) {
  send('state', 'speaking');
  const d = deps();
  if (!d.piper || !d.play) {         // sem voz neural: mostra o texto e volta ao repouso
    setTimeout(() => send('state', 'idle'), Math.min(8000, 1500 + text.length * 45));
    return;
  }
  const wav = path.join(TMP, `out-${Date.now()}.wav`);
  const piper = spawn(cfg.piperBin, ['-m', resolveModel(cfg.piperModel), '-f', wav]);
  piper.on('error', e => fail(`piper falhou: ${e.message}`));
  piper.stdin.write(text); piper.stdin.end();
  piper.on('close', () => {
    speakProc = spawn(cfg.playCmd, [wav]);
    speakProc.on('error', () => send('state', 'idle'));
    speakProc.on('close', () => { speakProc = null; send('state', 'idle'); });
  });
}

function fail(msg) {
  clearTimeout(brainTimer);
  recProc = null;
  send('transcript', msg);
  send('state', 'idle');
}

// ---- IPC ------------------------------------------------------------------
ipcMain.on('toggle-listen', () => (recProc ? stopRecording() : startRecording()));
ipcMain.on('ask-text', (_e, text) => { if (text && text.trim()) { send('you', text.trim()); ask(text.trim()); } });
ipcMain.on('stop-speak', () => { if (speakProc) speakProc.kill('SIGTERM'); });

// ---- scope readout for the UI --------------------------------------------
function scopeList() {
  try {
    const y = fs.readFileSync(path.join(ROOT, 'scope.yaml'), 'utf8');
    const mode = (y.match(/^mode:\s*(\w+)/m) || [])[1] || 'advisory';
    const auth = [];
    const block = y.split(/^authorized:/m)[1] || '';
    for (const line of block.split('\n')) {
      const m = line.match(/^\s*-\s*([^#\s]+)/); if (!m) { if (/^\w/.test(line)) break; continue; }
      auth.push(m[1]);
    }
    return { mode, authorized: auth };
  } catch { return { mode: 'advisory', authorized: [] }; }
}

// ---- window ---------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: cfg.window.width, height: cfg.window.height,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: cfg.window.alwaysOnTop, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    send('deps', deps());
    send('scope', scopeList());
    send('state', 'idle');
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
