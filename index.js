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
const { exec, execSync } = require('child_process');

// ========= ENV & PersistÃªncia =========
let TELEGRAM_BOT_TOKEN = sanitizeBotToken(process.env.TELEGRAM_BOT_TOKEN);
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
        path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(pfx86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ];
      for (const c of candidates) { if (fs.existsSync(c)) return c; }
      // tentativa via 'where' (PATH)
      try {
        const out = execSync('where msedge.exe', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).find(Boolean);
        if (out && fs.existsSync(out.trim())) return out.trim();
      } catch {}
      try {
        const out2 = execSync('where chrome.exe', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).find(Boolean);
        if (out2 && fs.existsSync(out2.trim())) return out2.trim();
      } catch {}
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
function resolveEnvPath() {
  // Preferir diretório de dados do usuário (externo ao app)
  try {
    const base = process.env.E_APPDATA_PATH;
    if (base) {
      const p = path.join(base, 'config.env');
      try { fs.mkdirSync(base, { recursive: true }); } catch {}
      try { if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8'); } catch {}
      return p;
    }
  } catch {}
  // Fallbacks (dev / não-Electron)
  if (process.env.E_DOTENV_PATH) return process.env.E_DOTENV_PATH;
  try { const exeDir = path.dirname(process.execPath); const p = path.join(exeDir, '.env'); if (fs.existsSync(p)) return p; } catch {}
  try { if (process.resourcesPath) { const p = path.join(process.resourcesPath, '.env'); if (fs.existsSync(p)) return p; } } catch {}
  const cwd = path.join(process.cwd(), '.env'); if (fs.existsSync(cwd)) return cwd;
  const here = path.join(__dirname, '.env'); if (fs.existsSync(here)) return here;
  return path.resolve('.env');
}
const ENV_PATH = resolveEnvPath();
// Recarrega dotenv a partir do caminho resolvido para garantir consistência
try { require('dotenv').config({ path: ENV_PATH, override: true }); } catch {}
try { console.log('[ENV] .env path:', ENV_PATH); } catch {}
// Ajusta variável em memória após override

// ========= Template (mensagem enviada) =========
const TEMPLATE_PATH = path.resolve(process.env.E_APPDATA_PATH || process.cwd(), 'template.txt');
function loadTemplateText() {
  try { return fs.readFileSync(TEMPLATE_PATH, 'utf8'); } catch { return ''; }
}
function saveTemplateText(t) {
  try { fs.writeFileSync(TEMPLATE_PATH, String(t || ''), 'utf8'); return true; } catch { return false; }
}
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
          console.log(`Ignorando mensagem do grupo "${chat.name}" (nenhum grupo vinculado). Use #bind no grupo ou Configurações (Grupo Alvo).`);
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
      // Filtro: somente BRANCO (?) com minuto, ou comando "teste"
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
          console.log(`Ignorando mensagem do grupo \"${chat.name}\" (nenhum grupo vinculado). Use #bind no grupo ou Configurações (Grupo Alvo).`);
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












