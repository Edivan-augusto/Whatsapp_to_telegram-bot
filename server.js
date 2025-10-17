'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');

function sanitizeBotToken(raw) {
  try {
    let t = String(raw || '').trim();
    if (!t) return '';
    t = t.replace(/^["']+|["']+$/g, '').trim();
    if (t.toLowerCase().startsWith('bot')) t = t.slice(3);
    t = t.replace(/\s+/g, '');
    return t;
  } catch { return String(raw || ''); }
}

const UI_PORT = parseInt(process.env.UI_PORT || '43117', 10);
let SEND_OFFSET_MIN = Math.max(0, Math.min(60, parseInt(process.env.SEND_OFFSET_MIN || '0', 10) || 0));
let TELEGRAM_BOT_TOKEN = sanitizeBotToken(process.env.TELEGRAM_BOT_TOKEN);
let WAPP_GROUP_NAME = process.env.WAPP_GROUP_NAME || '';
let WAPP_GROUP_ID = process.env.WAPP_GROUP_ID || null;
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;
const BIND_FILE = path.resolve('.bind.json');
const E_APPDATA = process.env.E_APPDATA_PATH || process.cwd();

function saveBind() {
  const data = { tg_chat_id: TELEGRAM_CHAT_ID || null, wa_group_id: WAPP_GROUP_ID || null };
  try { fs.writeFileSync(BIND_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}
try {
  if (fs.existsSync(BIND_FILE)) {
    const j = JSON.parse(fs.readFileSync(BIND_FILE, 'utf8'));
    if (!TELEGRAM_CHAT_ID && j.tg_chat_id) TELEGRAM_CHAT_ID = String(j.tg_chat_id);
    if (!WAPP_GROUP_ID && j.wa_group_id) WAPP_GROUP_ID = j.wa_group_id;
  }
} catch {}

function resolveEnvPath() {
  const candidates = [];
  if (process.env.E_DOTENV_PATH) candidates.push(process.env.E_DOTENV_PATH);
  try { candidates.push(path.join(path.dirname(process.execPath), '.env')); } catch {}
  if (process.resourcesPath) { try { candidates.push(path.join(process.resourcesPath, '.env')); } catch {} }
  candidates.push(path.join(process.cwd(), '.env'));
  candidates.push(path.join(__dirname, '.env'));
  for (const p of candidates) { try { if (p && fs.existsSync(p)) return p; } catch {} }
  try { return path.join(path.dirname(process.execPath), '.env'); } catch {}
  return path.resolve('.env');
}
const ENV_PATH = resolveEnvPath();
try { require('dotenv').config({ path: ENV_PATH, override: true }); } catch {}

function loadEnvText() { try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch { return ''; } }
function writeEnvText(text) { try { fs.writeFileSync(ENV_PATH, text, 'utf8'); } catch {} }
function setEnvValues(updates) {
  let text = loadEnvText();
  for (const k of Object.keys(updates || {})) {
    let v = String(updates[k] == null ? '' : updates[k]).replace(/\r?\n/g, ' ').trim();
    if (k === 'TELEGRAM_BOT_TOKEN') v = sanitizeBotToken(v);
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, `${k}=${v}`);
    else { if (text && !text.endsWith('\n')) text += '\n'; text += `${k}=${v}\n`; }
    process.env[k] = v;
  }
  writeEnvText(text);
}

// Template helpers
const TEMPLATE_PATH = path.resolve(E_APPDATA, 'template.txt');
function loadTemplateText() { try { return fs.readFileSync(TEMPLATE_PATH, 'utf8'); } catch { return ''; } }
function saveTemplateText(t) { try { fs.writeFileSync(TEMPLATE_PATH, String(t || ''), 'utf8'); return true; } catch { return false; } }
function applyTemplate(text, ctx) {
  try {
    const tpl = String(text || '');
    if (!tpl) return '';
    return tpl.replace(/\*([A-Za-z0-9_]+)\*/g, (_, k) => {
      const key = String(k || '').toUpperCase();
      const v = ctx && (ctx[key] != null) ? String(ctx[key]) : '';
      return v;
    });
  } catch { return String(text || ''); }
}

// Scheduling helpers (kept for future use)
function parseTimesHHMM(text) {
  const out = [];
  const re = /(\b\d{1,2}):(\d{2})/g; let m; const now = new Date();
  while ((m = re.exec(String(text || '')))) {
    let h = parseInt(m[1], 10); const mm = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) continue;
    const dt = new Date(now); dt.setHours(h, mm, 0, 0); if (dt.getTime() < now.getTime()) dt.setDate(dt.getDate() + 1); out.push(dt);
  }
  return out.sort((a, b) => a - b);
}
function scheduleOrSendEntrada(msgId, entradaText, rawForTimes) {
  const offsetMin = SEND_OFFSET_MIN || 0;
  if (offsetMin > 0) {
    const times = parseTimesHHMM(rawForTimes || entradaText);
    if (times.length) {
      const first = new Date(times[0].getTime() - offsetMin * 60 * 1000);
      const now = Date.now(); const delay = Math.max(0, first.getTime() - now);
      setTimeout(() => { /* sendToTelegram(entradaText) */ }, delay);
      return;
    }
  }
  // sendToTelegram(entradaText);
}

// Express app
const app = express();
app.use(express.json());
const staticDir = fs.existsSync(path.join(process.cwd(), 'public')) ? path.join(process.cwd(), 'public') : path.join(__dirname, 'public');
app.use(express.static(staticDir));

// Status
let WA_READY = false; let lastQRDataUrl = null;
app.get('/api/status', (req, res) => {
  res.json({ whatsappReady: WA_READY, telegramReady: !!TELEGRAM_BOT_TOKEN, lastQRAvailable: !!lastQRDataUrl, offsetMinutes: SEND_OFFSET_MIN, session: 'default' });
});
app.get('/api/qr', (req, res) => { if (!lastQRDataUrl) return res.status(404).json({ error: 'no-qr' }); res.json({ dataUrl: lastQRDataUrl }); });

// Config
const ALLOWED_ENV_KEYS = ['TELEGRAM_BOT_TOKEN','WAPP_GROUP_NAME','UI_PORT'];
app.get('/api/config', (req, res) => { const cur = {}; for (const k of ALLOWED_ENV_KEYS) cur[k] = process.env[k] || ''; res.json({ config: cur }); });
app.post('/api/config', (req, res) => {
  try {
    const updates = req.body && req.body.updates || {}; const filtered = {};
    for (const k of ALLOWED_ENV_KEYS) if (k in updates) filtered[k] = updates[k];
    setEnvValues(filtered);
    if ('TELEGRAM_BOT_TOKEN' in filtered) TELEGRAM_BOT_TOKEN = sanitizeBotToken(process.env.TELEGRAM_BOT_TOKEN || '');
    if ('WAPP_GROUP_NAME' in filtered) WAPP_GROUP_NAME = filtered.WAPP_GROUP_NAME || '';
    const cur = {}; for (const k of ALLOWED_ENV_KEYS) cur[k] = process.env[k] || '';
    res.json({ ok: true, restartRequired: [], config: cur });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Control
app.get('/api/control', (req, res) => { res.json({ offsetMinutes: SEND_OFFSET_MIN, min: 0, max: 60 }); });
app.post('/api/control', (req, res) => { try { let m = parseInt(req.body?.offsetMinutes, 10); if (isNaN(m) || m < 0) m = 0; if (m > 60) m = 60; SEND_OFFSET_MIN = m; setEnvValues({ SEND_OFFSET_MIN: String(m) }); res.json({ ok: true, offsetMinutes: SEND_OFFSET_MIN }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

// WA session helpers (no-op placeholders)
app.post('/api/wa/clear_session', async (req, res) => { try { WA_READY = false; lastQRDataUrl = null; res.json({ ok: true, cleared: true, restarted: true }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

// Template endpoints
app.get('/api/template', (req, res) => { try { res.json({ template: loadTemplateText() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/template', (req, res) => { try { const t = (req.body && req.body.text != null) ? String(req.body.text) : ''; const ok = saveTemplateText(t); res.json({ ok }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

app.listen(UI_PORT, () => { console.log(`UI disponivel em http://localhost:${UI_PORT}`); });

module.exports = { };
