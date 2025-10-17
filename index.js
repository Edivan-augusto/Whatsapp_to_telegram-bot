require('dotenv').config();


// let TELEGRAM_DISABLED = false;
// if (!TELEGRAM_BOT_TOKEN) {
//   console.warn('Aviso: TELEGRAM_BOT_TOKEN ausente. A UI continuará para configuração via painel.');
//   TELEGRAM_DISABLED = true;
// }
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const QRCode = require('qrcode');
const { exec } = require('child_process');

// ========= ENV & PersistÃªncia =========
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;
let TELEGRAM_DISABLED = false;
if (!TELEGRAM_BOT_TOKEN) {
  console.warn('Aviso: TELEGRAM_BOT_TOKEN ausente. A UI continuará para configuração via painel.');
  TELEGRAM_DISABLED = true;
}
const WAPP_SESSION = process.env.WAPP_SESSION || 'default';
let WAPP_GROUP_ID = process.env.WAPP_GROUP_ID || null;
let WAPP_GROUP_NAME = process.env.WAPP_GROUP_NAME || null;
const TEST_FAKE_WPP = process.env.TEST_FAKE_WPP === '1';
const UI_PORT = parseInt(process.env.UI_PORT || '43117', 10);
const AUTO_OPEN = (process.env.AUTO_OPEN || '1') !== '0';
let SEND_OFFSET_MIN = parseInt(process.env.SEND_OFFSET_MIN || '0', 10);
if (isNaN(SEND_OFFSET_MIN) || SEND_OFFSET_MIN < 0) SEND_OFFSET_MIN = 0;
if (SEND_OFFSET_MIN > 60) SEND_OFFSET_MIN = 60;
const BIND_FILE = path.resolve('.bind.json'); // salva TG chat + WA group
const DEBUG = process.env.DEBUG !== '0';
// Ajuda o Puppeteer quando empacotado (pkg/electron): define cache gravável
if (!process.env.PUPPETEER_CACHE_DIR) {
  try {
    const base = process.env.E_APPDATA_PATH || process.cwd();
    const cacheDir = path.resolve(base, 'puppeteer');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    process.env.PUPPETEER_CACHE_DIR = cacheDir;
  } catch {}
}

// Tenta descobrir navegador (Edge/Chrome) se não vier por env
function findBrowserExecutable() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  try {
    if (process.platform === 'win32') {
      const pf = process.env['ProgramFiles'] || 'C\\\\Program Files';
      const pfx86 = process.env['ProgramFiles(x86)'] || 'C\\\\Program Files (x86)';
      const local = process.env['LOCALAPPDATA'] || path.join(process.env['USERPROFILE'] || 'C:\\Users\\Default', 'AppData', 'Local');
      const candidates = [
        path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ];
      for (const c of candidates) { if (fs.existsSync(c)) return c; }
    }
  } catch {}
  return null;
}
function dlog(...args) { if (DEBUG) console.log(...args); }

// removed duplicate TELEGRAM_DISABLED block

// carrega bind salvo
try {
  if (fs.existsSync(BIND_FILE)) {
    const j = JSON.parse(fs.readFileSync(BIND_FILE, 'utf8'));
    if (!TELEGRAM_CHAT_ID && j.tg_chat_id) TELEGRAM_CHAT_ID = String(j.tg_chat_id);
    if (!WAPP_GROUP_ID && j.wa_group_id) WAPP_GROUP_ID = j.wa_group_id;
  }
} catch (e) {
  console.warn('Aviso: NÃ£o consegui ler .bind.json:', e.message);
}

function saveBind() {
  const data = { tg_chat_id: TELEGRAM_CHAT_ID || null, wa_group_id: WAPP_GROUP_ID || null };
  try { fs.writeFileSync(BIND_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.warn('Aviso: Falha ao salvar .bind.json:', e.message); }
  dlog(`[BIND] Salvo: tg_chat_id=${data.tg_chat_id} wa_group_id=${data.wa_group_id}`);
}

// ========= Util: .env load/save =========
const ENV_PATH = path.resolve('.env');
function loadEnvText() {
  try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch { return ''; }
}
function writeEnvText(text) {
  fs.writeFileSync(ENV_PATH, text, 'utf8');
}
function getEnvValue(text, key) {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = text.match(re);
  return m ? m[1] : '';
}
function setEnvValues(updates) {
  let text = loadEnvText();
  const keys = Object.keys(updates || {});
  for (const k of keys) {
    const vRaw = updates[k] == null ? '' : String(updates[k]);
    const v = vRaw.replace(/\r?\n/g, ' ').trim();
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, `${k}=${v}`);
    } else {
      if (text && !text.endsWith('\n')) text += '\n';
      text += `${k}=${v}\n`;
    }
    process.env[k] = v;
  }
  writeEnvText(text);
}

// ========= Telegram =========
// MantÃ©m polling sempre ativo para receber comandos
let bot;
if (!TELEGRAM_DISABLED) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  bot.on('polling_error', (err) => console.error('Telegram polling_error:', err?.message || err));
  bot.on('webhook_error', (err) => console.error('Telegram webhook_error:', err?.message || err));
} else {
  bot = { on: () => {}, onText: () => {}, sendMessage: async () => {} };
}
bot.on('polling_error', (err) => console.error('Telegram polling_error:', err?.message || err));
bot.on('webhook_error', (err) => console.error('Telegram webhook_error:', err?.message || err));

function chunkText(s, size = 3500) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

async function tgReply(chatId, text) {
  try {
    return await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  } catch (e) {
    console.error('Erro ao enviar para Telegram:', e.message);
  }
}

// ========= UtilitÃ¡rio de envio =========
async function sendToTelegram(text) {
  if (!TELEGRAM_CHAT_ID) {
    console.warn('Aviso: TELEGRAM_CHAT_ID nao definido. Use /start no Telegram para vincular.');
    return;
  }
  try {
    const str = String(text);
    const chunks = chunkText(str, 3500);
    dlog(`[TG] Enviando ${chunks.length} chunk(s) (len=${str.length}) para chat ${TELEGRAM_CHAT_ID}.`);
    for (let i = 0; i < chunks.length; i++) {
      dlog(`[TG] Chunk ${i+1}/${chunks.length}: len=${chunks[i].length}`);
      await bot.sendMessage(TELEGRAM_CHAT_ID, chunks[i], { disable_web_page_preview: true });
    }
  } catch (e) {
    console.error('Erro ao enviar para Telegram:', e.message);
  }
}

// ========= Estado/Comum =========
let WA_READY = false;
let wa = null;
let groupsCache = [];
let listingInProgress = false;
let lastQRDataUrl = null; // atualizado quando receber evento 'qr'
const processedMsgIds = new Set();

// ========= Controle de envio =========
function parseTimesHHMM(text) {
  const out = [];
  const re = /(\b\d{1,2}):(\d{2})/g;
  let m;
  const now = new Date();
  while ((m = re.exec(text))) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) continue;
    const dt = new Date(now);
    // Ajusta hora para hoje; se já passou, considera próxima ocorrência (amanhã)
    dt.setHours(h, mm, 0, 0);
    if (dt.getTime() < now.getTime()) dt.setDate(dt.getDate() + 1);
    out.push(dt);
  }
  return out.sort((a, b) => a - b);
}
function scheduleOrSendEntrada(msgId, entradaText, rawForTimes) {
  const offsetMin = SEND_OFFSET_MIN || 0;
  if (offsetMin > 0) {
    const times = parseTimesHHMM(rawForTimes || entradaText);
    if (times.length) {
      const first = new Date(times[0].getTime() - offsetMin * 60 * 1000);
      const now = Date.now();
      const delay = Math.max(0, first.getTime() - now);
      dlog(`[SCHEDULE] Mensagem ${msgId} agendada para ${new Date(now + delay).toLocaleString()} (-${offsetMin}m)`);
      setTimeout(() => { sendToTelegram(entradaText); }, delay);
      return;
    }
  }
  // default: envia imediatamente
  sendToTelegram(entradaText);
}

function normalized(s) { return (s||'').toString().trim().toLowerCase(); }
function isTargetGroup(chat) {
  if (!chat?.isGroup) return false;
  if (WAPP_GROUP_ID && (chat.id?._serialized === WAPP_GROUP_ID || chat.id?.user === WAPP_GROUP_ID)) return true;
  if (WAPP_GROUP_NAME && normalized(chat.name) === normalized(WAPP_GROUP_NAME)) return true;
  return false;
}

// ========= Formatação especial de ENTRADA =========
function pad2(n) { return String(n).padStart(2, '0'); }
function formatEntradaFromText(text) {
  try {
    const WHITE = "\u26AA"; // ⚪
    const firstLine = String(text || "").split(/\r?\n/)[0];
    if (!firstLine) return null;

    // Precisa conter uma bola branca ⚪
    if (firstLine.indexOf(WHITE) === -1) return null;

    // Cabeçalho criativo
    const header = "⚪🚨  TA NA HORA DO BRANCO!  🚨⚪\n🎯 Foque no BRANCO. Gestão e cautela.\n";

    // Tenta padrão com múltiplos blocos separados por //
    const blocks = firstLine.split(/\s*\/\/\s*/);
    const now = new Date();
    const curMin = now.getMinutes();
    const baseHour = now.getHours();
    const out = [];
    for (const b of blocks) {
      // precisa começar com minuto e conter ⚪ neste bloco
      if (b.indexOf(WHITE) === -1) continue;
      const m = b.match(/^\s*(\d{1,2})\b/);
      if (!m) continue;
      const minute = parseInt(m[1], 10);
      if (isNaN(minute) || minute < 0 || minute > 59) continue;
      let hour = baseHour;
      if (minute < curMin) hour = (hour + 1) % 24;
      const HH = pad2(hour);
      const MM = pad2(minute);
      out.push(`${HH}:${MM}${WHITE}`);
    }

    if (out.length) return header + "\n//ENTRADA " + out.join("//");

    return null;
  } catch (_) {
    return null;
  }
}

// ========= Comandos base =========
bot.on('message', async (msg) => {
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  dlog(`[TG] Mensagem recebida: chat=${chatId} text=${JSON.stringify(text)}`);

  // vincula chat automaticamente no /start
  if (/^\/start\b/.test(text)) {
    TELEGRAM_CHAT_ID = String(chatId);
    saveBind();
    dlog(`[TG] /start: vinculado chat ${TELEGRAM_CHAT_ID}.`);
    await tgReply(chatId, [
      'Ok. Bot online e vinculado a este chat.',
      '',
      'Comandos Ãºteis:',
      '/status - mostra bind atual',
      '/bind_chat - vincula este chat como destino',
      '/groups - lista grupos do WhatsApp (precisa estar conectado)',
      '/bind_group <n|id> - vincula um grupo pelo Ã­ndice da lista ou pelo id',
      '/unbind_group - remove o vÃ­nculo do grupo',
      '/id - mostra o chat id',
      '',
      'Dica: no WhatsApp, envie #bind dentro do grupo desejado para vincular automaticamente.'
    ].join('\n'));
    return;
  }

  if (/^\/id\b/.test(text)) return tgReply(chatId, 'Chat ID: ' + chatId);
  if (/^\/bind_chat\b/.test(text)) {
    TELEGRAM_CHAT_ID = String(chatId);
    saveBind();
    dlog(`[TG] /bind_chat: destino TG ${TELEGRAM_CHAT_ID}.`);
    return tgReply(chatId, 'Ok. Vinculado: este chat serÃ¡ o destino das mensagens.');
  }
});

// ========= /status (disponÃ­vel em todos os modos) =========
bot.onText(/^\/status\b/, async (msg) => {
  const lines = [];
  lines.push('Status');
  lines.push(`Destino TG: ${TELEGRAM_CHAT_ID || '(nÃ£o vinculado)'}`);
  lines.push(`WhatsApp pronto: ${WA_READY ? 'sim' : 'nÃ£o'}`);
  lines.push(`SessÃ£o WA: ${WAPP_SESSION}`);
  lines.push(`Grupo WA alvo: ${WAPP_GROUP_ID || WAPP_GROUP_NAME || '(nÃ£o definido)'}`);
  await tgReply(msg.chat.id, lines.join('\n'));
});

// ========= UI/HTTP =========
const app = express();
app.use(express.json());
const staticDir = fs.existsSync(path.join(process.cwd(), 'public'))
  ? path.join(process.cwd(), 'public')
  : path.join(__dirname, 'public');
app.use(express.static(staticDir));

// Status geral
app.get('/api/status', (req, res) => {
  res.json({
    whatsappReady: WA_READY,
    telegramChatId: TELEGRAM_CHAT_ID,
    wappGroupId: WAPP_GROUP_ID,
    wappGroupName: WAPP_GROUP_NAME,
    session: WAPP_SESSION,
    offsetMinutes: SEND_OFFSET_MIN,
    lastQRAvailable: !!lastQRDataUrl,
  });
});

// QR code atual (data URL)
app.get('/api/qr', (req, res) => {
  if (!lastQRDataUrl) return res.status(404).json({ error: 'no-qr' });
  res.json({ dataUrl: lastQRDataUrl });
});

// Config .env (menos TEST_FAKE_WPP)
const ALLOWED_ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WAPP_GROUP_ID', 'WAPP_GROUP_NAME',
  'WAPP_SESSION', 'UI_PORT'
];

app.get('/api/config', (req, res) => {
  const cur = {};
  for (const k of ALLOWED_ENV_KEYS) cur[k] = process.env[k] || '';
  res.json({ config: cur });
});

app.post('/api/config', (req, res) => {
  try {
    const updates = req.body?.updates || {};
    const filtered = {};
    for (const k of ALLOWED_ENV_KEYS) if (k in updates) filtered[k] = updates[k];
    setEnvValues(filtered);

    const restartRequired = [];
    if ('TELEGRAM_BOT_TOKEN' in filtered) restartRequired.push('TELEGRAM_BOT_TOKEN');
    if ('WAPP_SESSION' in filtered) restartRequired.push('WAPP_SESSION');

    if ('TELEGRAM_CHAT_ID' in filtered) { TELEGRAM_CHAT_ID = String(filtered.TELEGRAM_CHAT_ID || ''); saveBind(); }
    if ('WAPP_GROUP_ID' in filtered) { WAPP_GROUP_ID = filtered.WAPP_GROUP_ID || null; saveBind(); }
    if ('WAPP_GROUP_NAME' in filtered) { WAPP_GROUP_NAME = filtered.WAPP_GROUP_NAME || null; saveBind(); }
    if ('DEBUG' in filtered) { /* dynamic toggle via process.env already set */ }

    const cur = {}; for (const k of ALLOWED_ENV_KEYS) cur[k] = process.env[k] || '';
    res.json({ ok: true, restartRequired, config: cur });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Controle de envio: 0..60 minutos antes
app.get('/api/control', (req, res) => {
  res.json({ offsetMinutes: SEND_OFFSET_MIN, min: 0, max: 60 });
});
app.post('/api/control', (req, res) => {
  try {
    let m = parseInt(req.body?.offsetMinutes, 10);
    if (isNaN(m) || m < 0) m = 0; if (m > 60) m = 60;
    SEND_OFFSET_MIN = m;
    setEnvValues({ SEND_OFFSET_MIN: String(m) });
    res.json({ ok: true, offsetMinutes: SEND_OFFSET_MIN });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Forçar logout para aparecer QR novamente
app.post('/api/wa/logout', async (req, res) => {
  try {
    if (wa) {
      try { await wa.logout(); } catch {}
      WA_READY = false;
      lastQRDataUrl = null;
      // tenta reiniciar o cliente para forçar novo QR
      try { if (typeof requestWaRestart === 'function') setTimeout(() => requestWaRestart('logout'), 500); } catch {}
      res.json({ ok: true, restarted: true });
    } else {
      res.status(400).json({ ok: false, error: 'wa-not-initialized' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Limpar sessão LocalAuth (apaga credenciais salvas) e voltar a pedir QR
app.post('/api/wa/clear_session', async (req, res) => {
  try {
    const base = process.env.E_APPDATA_PATH || process.cwd();
    const authBase = path.resolve(base, '.wwebjs_auth');
    const cacheBase = path.resolve(base, '.wwebjs_cache');
    const sessionDir = path.join(authBase, `session-${WAPP_SESSION}`);

    try { if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(cacheBase)) fs.rmSync(cacheBase, { recursive: true, force: true }); } catch {}

    // Força novo QR
    try { if (wa) await wa.logout(); } catch {}
    WA_READY = false;
    lastQRDataUrl = null;
    try { if (typeof requestWaRestart === 'function') setTimeout(() => requestWaRestart('clear_session'), 500); } catch {}
    res.json({ ok: true, cleared: true, restarted: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(UI_PORT, () => {
  console.log(`UI disponível em http://localhost:${UI_PORT}`);
  if (AUTO_OPEN) {
    const url = `http://localhost:${UI_PORT}`;
    try {
      if (process.platform === 'win32') {
        exec(`start "" "${url}"`, { shell: 'cmd.exe' });
      } else if (process.platform === 'darwin') {
        exec(`open "${url}"`);
      } else {
        exec(`xdg-open "${url}"`);
      }
    } catch (_) {}
  }
});

// ========= WhatsApp =========
let requestWaRestart = null; // função para reiniciar WA on-demand
if (TEST_FAKE_WPP) {
  // ---- Modo FAKE ----
  console.log('Modo FAKE ativado - sem WhatsApp. Envia mensagens simuladas a cada 5s.');
  let n = 0;
  setInterval(() => {
    n++;
    const when = new Date().toLocaleString();
    const payload = `WhatsApp(Fake) -> Telegram\nGrupo alvo: ${WAPP_GROUP_ID || WAPP_GROUP_NAME || '(qualquer)'}\nQuando: ${when}\n\nMensagem de teste #${n}`;
    sendToTelegram(payload);
  }, 5000);
} else {
  // ---- WhatsApp real ----
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const qrcode = require('qrcode-terminal');

  const USE_SYSTEM_BROWSER = process.env.PUPPETEER_USE_SYSTEM === '1';
  const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || (USE_SYSTEM_BROWSER ? findBrowserExecutable() : null);
  if (EXEC_PATH) console.log('[WA] Usando navegador do sistema:', EXEC_PATH);
  else console.log('[WA] Usando Chromium do Puppeteer (download automático, cache em', process.env.PUPPETEER_CACHE_DIR, ')');

  const PUP_FLAGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--remote-allow-origins=*',
    '--disable-extensions',
    '--disable-features=TranslateUI,site-per-process',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic'
  ];

  function setupWhatsAppClient() {
    wa = new Client({
      authStrategy: new LocalAuth({
        clientId: WAPP_SESSION,
        dataPath: path.resolve(process.env.E_APPDATA_PATH || process.cwd(), '.wwebjs_auth')
      }),
      puppeteer: {
        headless: true,
        executablePath: EXEC_PATH || undefined,
        args: PUP_FLAGS,
        timeout: 180000
      }
    });

    wa.on('qr', async (qr) => {
      console.log('Abra o WhatsApp no celular > Dispositivos conectados > Conectar um dispositivo');
      qrcode.generate(qr, { small: true });
      try { lastQRDataUrl = await QRCode.toDataURL(qr); } catch (e) { console.warn('Falha ao gerar QR para UI:', e.message); }
    });

    wa.on('ready', async () => {
      WA_READY = true;
      lastQRDataUrl = null;
      const me = wa.info?.wid?.user || 'desconhecido';
      console.log(`Ok. WhatsApp pronto na conta: ${me} (session=${WAPP_SESSION})`);
      await listGroupsToCache();
    });

    wa.on('auth_failure', (m) => console.error('Falha de auth:', m));
    wa.on('disconnected', (r) => {
      console.log('Desconectado:', r);
      WA_READY = false;
      lastQRDataUrl = null;
      // tenta reinicializar após breve atraso
      setTimeout(() => {
        try { wa.destroy().catch(()=>{}); } catch {}
        try { setupWhatsAppClient(); wa.initialize().catch(err => console.error('Erro ao reinicializar WA:', err?.message || err)); } catch (e) { console.error('Reinit exception:', e?.message || e); }
      }, 5000);
    });

    try {
      wa.initialize().catch(err => console.error('Erro ao inicializar WA:', err?.message || err));
    } catch (e) {
      console.error('Exceção na inicialização WA:', e?.message || e);
      setTimeout(() => { setupWhatsAppClient(); }, 5000);
    }
  }

  setupWhatsAppClient();
  // expõe reinicialização para rotas HTTP
  requestWaRestart = async (reason) => {
    try { console.log('[WA] Reinicializando (motivo:', reason, ')'); } catch {}
    try { if (wa) await wa.destroy().catch(()=>{}); } catch {}
    try { setupWhatsAppClient(); } catch (e) { console.error('Falha ao reiniciar WA:', e?.message || e); }
  };

  async function listGroupsToCache(retries = 1, delayMs = 0) {
    if (!WA_READY || listingInProgress) return;
    listingInProgress = true;
    try {
      dlog(`[WA] Listando grupos: retries=${retries} delayMs=${delayMs}`);
      for (let attempt = 0; attempt < retries; attempt++) {
        const chats = await wa.getChats();
        groupsCache = chats.filter(c => c.isGroup);
        if (groupsCache.length || attempt === retries - 1) break;
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      }
      console.log(`Achei ${groupsCache.length} grupos.`);
      dlog(`[WA] Exemplos: ${groupsCache.slice(0,3).map(g=>g.name).join(', ')}`);
    } catch (e) {
      console.warn('Erro ao listar grupos:', e.message);
    } finally {
      listingInProgress = false;
    }
  }

  // Comandos Telegram dependentes do WhatsApp
  bot.onText(/^\/groups\b/, async (msg) => {
    if (!WA_READY) return tgReply(msg.chat.id, 'WhatsApp ainda nÃ£o estÃ¡ pronto. Escaneie o QR e aguarde.');
    await listGroupsToCache(4, 2000);

    if (!groupsCache.length) return tgReply(msg.chat.id, 'NÃ£o encontrei grupos (tente novamente em alguns segundos ou use #bind no grupo).');

    const header = `Grupos (${groupsCache.length})\nUse /bind_group <n> (Ã­ndice) ou /bind_group <id>`;
    const lines = groupsCache.slice(0, 100).map((g, i) => `${i + 1}. ${g.name} | id=${g.id?._serialized}`);
    const msgText = [header, ...lines].join('\n');

    for (const chunk of chunkText(msgText, 3500)) {
      await tgReply(msg.chat.id, chunk);
    }
  });

  bot.onText(/^\/bind_group\s+(.+)/i, async (msg, match) => {
    const arg = (match[1] || '').trim();
    if (!WA_READY) return tgReply(msg.chat.id, 'WhatsApp ainda nÃ£o estÃ¡ pronto.');
    await listGroupsToCache(2, 1000);
    if (!groupsCache.length) return tgReply(msg.chat.id, 'NÃ£o encontrei grupos.');

    // por Ã­ndice
    const idx = parseInt(arg, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= groupsCache.length) {
      const g = groupsCache[idx-1];
      WAPP_GROUP_ID = g.id?._serialized;
      WAPP_GROUP_NAME = null;
      saveBind();
      return tgReply(msg.chat.id, `Ok. Grupo vinculado por Ã­ndice:\n${g.name}\nid=${WAPP_GROUP_ID}`);
    }
    // por id (string)
    const byId = groupsCache.find(g => g.id?._serialized === arg);
    if (byId) {
      WAPP_GROUP_ID = byId.id._serialized;
      WAPP_GROUP_NAME = null;
      saveBind();
      return tgReply(msg.chat.id, `Ok. Grupo vinculado por id:\n${byId.name}\nid=${WAPP_GROUP_ID}`);
    }
    return tgReply(msg.chat.id, 'NÃ£o encontrado. Use /groups para conferir Ã­ndices e tente novamente.');
  });

  bot.onText(/^\/unbind_group\b/, async (msg) => {
    WAPP_GROUP_ID = null;
    WAPP_GROUP_NAME = null;
    saveBind();
    tgReply(msg.chat.id, 'Ok. Grupo desvinculado.');
  });

  // Mensagem do WhatsApp -> Telegram (filtrada por grupo)
  wa.on('message', async (msg) => {
    try {
      const rawText = (msg.body || '').trim();
      console.log(`[WA] message: fromMe=${msg.fromMe} hasMedia=${msg.hasMedia} type=${msg.type} bodyLen=${rawText.length}`);
      const msgId = (msg.id && (msg.id._serialized || msg.id.id)) || `${msg.timestamp}-${rawText.slice(0,16)}`;
      if (processedMsgIds.has(msgId)) { dlog(`[WA] skip duplicate ${msgId}`); return; }

      // comando de bind via WhatsApp
      if (/^#bind\b/i.test(rawText)) {
        const chat = await msg.getChat();
        if (!chat.isGroup) {
          await msg.reply('Use #bind dentro do grupo que deseja vincular.');
          return;
        }
        WAPP_GROUP_ID = chat.id?._serialized;
        WAPP_GROUP_NAME = null;
        saveBind();
        await msg.reply(`Ok. Grupo vinculado: ${chat.name}\nid=${WAPP_GROUP_ID}`);
        return;
      }

      // Encaminhar tambÃ©m mensagens enviadas por vocÃª (fromMe),
      // para facilitar testes e porque nÃ£o hÃ¡ loop TG->WA implementado.
      const chat = await msg.getChat();
      console.log(`[WA] chat: name=${chat.name} id=${chat.id?._serialized} isGroup=${chat.isGroup}`);
      if (!chat.isGroup) { console.log('[WA] Ignoring: not a group'); return; }
      if (!isTargetGroup(chat)) {
        console.log(`[WA] Not target group. targetId=${WAPP_GROUP_ID || '-'} targetName=${WAPP_GROUP_NAME || '-'} currentId=${chat.id?._serialized}`);
        if (!WAPP_GROUP_ID && !WAPP_GROUP_NAME) {
          // Sem alvo definido: ignorando. Oriente via log.
          console.log(`Ignorando mensagem do grupo "${chat.name}" (nenhum grupo vinculado). Use #bind no grupo ou /groups + /bind_group no Telegram.`);
        }
        return;
      }

      const contact = await msg.getContact();
      const sender = contact.pushname || contact.number || contact.id.user;
      const when = new Date(msg.timestamp * 1000).toLocaleString();
      let text = (msg.body || '').trim();
      if (!text && msg.hasMedia) text = '[mÃ­dia]';

      const payload = [
        'WhatsApp -> Telegram (Grupo)',
        `Grupo: ${chat.name} (${chat.id?._serialized})`,
        `De: ${sender}`,
        `Quando: ${when}`,
        '',
        text || '(vazio)'
      ].join('\n');
      console.log('[WA->TG] payload:\n' + payload);
      // Filtro: somente BRANCO (⚪) com minuto, ou comando "teste"
      {
        const entrada = formatEntradaFromText(rawText);
        if (entrada) {
          console.log(`[FORMAT] Entrada => ${entrada}`);
          scheduleOrSendEntrada(msgId, entrada, entrada);
          processedMsgIds.add(msgId);
          return;
        }
        if (/^\\s*teste\\b/i.test(rawText)) {
          scheduleOrSendEntrada(msgId, `Wpp: ${rawText}`, rawText);
          processedMsgIds.add(msgId);
          return;
        }
      }
      // Ignora mensagens fora do padrão desejado
      return;
      console.log(`Encaminhando do WA grupo "${chat.name}" para Telegram (${TELEGRAM_CHAT_ID || 'sem destino'})`);
      await sendToTelegram(payload);
    } catch (e) {
      console.error('Erro ao encaminhar:', e);
    }
  });

  // Também captura mensagens criadas pelo próprio cliente (fromMe=true)
  wa.on('message_create', async (msg) => {
    try {
      const rawText = (msg.body || '').trim();
      console.log(`[WA] message_create: fromMe=${msg.fromMe} hasMedia=${msg.hasMedia} type=${msg.type} bodyLen=${rawText.length}`);
      const msgId = (msg.id && (msg.id._serialized || msg.id.id)) || `${msg.timestamp}-${rawText.slice(0,16)}`;
      if (processedMsgIds.has(msgId)) { dlog(`[WA] skip duplicate(create) ${msgId}`); return; }

      // comando de bind via WhatsApp
      if (/^#bind\b/i.test(rawText)) {
        const chat = await msg.getChat();
        if (!chat.isGroup) {
          await msg.reply('Use #bind dentro do grupo que deseja vincular.');
          return;
        }
        WAPP_GROUP_ID = chat.id?._serialized;
        WAPP_GROUP_NAME = null;
        saveBind();
        await msg.reply(`Ok. Grupo vinculado: ${chat.name}\nid=${WAPP_GROUP_ID}`);
        return;
      }

      const chat = await msg.getChat();
      console.log(`[WA] chat(create): name=${chat.name} id=${chat.id?._serialized} isGroup=${chat.isGroup}`);
      if (!chat.isGroup) { console.log('[WA] Ignoring(create): not a group'); return; }
      if (!isTargetGroup(chat)) {
        console.log(`[WA] Not target group(create). targetId=${WAPP_GROUP_ID || '-'} targetName=${WAPP_GROUP_NAME || '-'} currentId=${chat.id?._serialized}`);
        if (!WAPP_GROUP_ID && !WAPP_GROUP_NAME) {
          console.log(`Ignorando mensagem do grupo \"${chat.name}\" (nenhum grupo vinculado). Use #bind no grupo ou /groups + /bind_group no Telegram.`);
        }
        return;
      }

      // Se a mensagem tiver o padrão de ENTRADA, reenviar já formatada
      const entrada = formatEntradaFromText(rawText);
      if (entrada) {
        console.log(`[FORMAT] Entrada(create) => ${entrada}`);
        scheduleOrSendEntrada(msgId, entrada, entrada);
        processedMsgIds.add(msgId);
        return;
      }
      // Se for comando de teste simples, só encaminha como 'Wpp: ...'
      if (/^\s*teste\b/i.test(rawText)) {
        scheduleOrSendEntrada(msgId, `Wpp: ${rawText}`, rawText);
        processedMsgIds.add(msgId);
        return;
      }
      // Ignora demais mensagens que não combinam com o filtro de BRANCO
      return;

      const contact = await msg.getContact();
      const sender = contact.pushname || contact.number || contact.id.user;
      const when = new Date(msg.timestamp * 1000).toLocaleString();
      let text = (msg.body || '').trim();
      if (!text && msg.hasMedia) text = '[mídia]';

      const payload = [
        'WhatsApp -> Telegram (Grupo)',
        `Grupo: ${chat.name} (${chat.id?._serialized})`,
        `De: ${sender}`,
        `Quando: ${when}`,
        '',
        text || '(vazio)'
      ].join('\\n');
      console.log('[WA->TG] payload(create):\n' + payload);
      console.log(`Encaminhando do WA grupo \"${chat.name}\" para Telegram (${TELEGRAM_CHAT_ID || 'sem destino'})`);
      await sendToTelegram(payload);
    } catch (e) {
      console.error('Erro ao encaminhar(create):', e);
    }
  });

  // inicialização já é chamada dentro de setupWhatsAppClient()
}






