const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Impede abrir no navegador externo
process.env.AUTO_OPEN = '0';
// Força o uso de navegador do sistema para Puppeteer quando em Electron
// (o Chromium embutido do puppeteer não é empacotado no build Electron)
if (!process.env.PUPPETEER_USE_SYSTEM) {
  process.env.PUPPETEER_USE_SYSTEM = '1';
}

// Porta da UI (deve bater com index.js)
const UI_PORT = parseInt(process.env.UI_PORT || '43117', 10);
const UI_URL = `http://localhost:${UI_PORT}`;

let mainWindow;
let logPath = null;
const LOG_MAX_BYTES = parseInt(process.env.ELECTRON_LOG_MAX || `${10 * 1024 * 1024}`, 10); // 10 MB default
const LOG_LEVEL = (process.env.ELECTRON_LOG_LEVEL || 'warn').toLowerCase(); // error|warn|info|debug
const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ensureRotate() {
  if (!logPath) return;
  try {
    const st = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
    if (st && st.size > LOG_MAX_BYTES) {
      const bak = logPath + '.1';
      try { if (fs.existsSync(bak)) fs.unlinkSync(bak); } catch {}
      try { fs.renameSync(logPath, bak); } catch {}
      try { fs.writeFileSync(logPath, '', 'utf8'); } catch {}
    }
  } catch {}
}

function writeFileOnly(line) {
  try {
    if (!logPath) return;
    ensureRotate();
    fs.appendFileSync(logPath, line + '\n');
  } catch {}
}

function logLine(level, ...args) {
  try {
    const want = LEVEL_ORDER[LOG_LEVEL] ?? 0;
    const cur = LEVEL_ORDER[level] ?? 0;
    if (cur > want) return;
    const line = `[${nowTs()}] [${level.toUpperCase()}] ` + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    // Avoid recursion: don't call console.log here; only write file
    writeFileOnly(line);
  } catch {}
}

function setupConsoleCapture() {
  ['log','warn','error'].forEach((k) => {
    const orig = console[k];
    console[k] = (...a) => {
      try { orig.apply(console, a); } catch {}
      try {
        const level = k === 'log' ? 'info' : k;
        logLine(level, ...a);
      } catch {}
    };
  });
  process.on('uncaughtException', (e) => logLine('error', 'uncaughtException', e && (e.stack || e)));
  process.on('unhandledRejection', (r) => logLine('error', 'unhandledRejection', r && (r.stack || r)));
}

function createWindow() {
  // Ajuda o index.js a definir diretÃ³rio de cache do Puppeteer em local gravÃ¡vel
  const userData = app.getPath('userData');
  process.env.E_APPDATA_PATH = userData;
  try {
    logPath = path.join(userData, 'electron.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    ensureRotate();
    writeFileOnly(`\n\n==== START ${nowTs()} ==== (level=${LOG_LEVEL}, max=${LOG_MAX_BYTES} bytes)`);
  } catch {}
  setupConsoleCapture();
  logLine('info', 'App ready', 'userData=', userData, 'UI_PORT=', process.env.UI_PORT || '3001');

  // Inicia o servidor/bridge (Express + bots)
  try {
    logLine('info', 'Iniciando backend (require index.js)');
    require(path.join(__dirname, 'index.js'));
    logLine('info', 'Backend iniciado');
  } catch (e) {
    logLine('error', 'Falha ao iniciar backend:', e && (e.stack || e));
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: true,
  });
  logLine('info', 'Carregando UI em', UI_URL);
  tryLoad(UI_URL);

  mainWindow.on('closed', () => {
    logLine('info', 'Janela fechada');
    mainWindow = null;
    app.quit();
  });

  // Eventos de depuração do webContents
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    logLine('warn', 'did-fail-load', 'code=', code, 'desc=', desc, 'url=', url);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    logLine('info', 'did-finish-load');
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    logLine('warn', 'render-process-gone', details);
  });

  const template = [];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function tryLoad(url) {
  if (!mainWindow) return;
  mainWindow.loadURL(url).catch((err) => {
    logLine('warn', 'loadURL catch', err && (err.stack || err));
    setTimeout(() => tryLoad(url), 2000);
  });
  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => { if (mainWindow) mainWindow.loadURL(url).catch((e)=>logLine('warn', 'reload catch', e && (e.stack||e))); }, 2000);
  });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => {
  logLine('info', 'window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  logLine('info', 'activate');
  if (mainWindow === null) createWindow();
});

