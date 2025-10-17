const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`GET ${path} => ${r.status}`);
  return await r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`POST ${path} => ${r.status}`);
  return await r.json();
}

function showToast(text, ok = true) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('error', !ok);
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 2200);
}

let awaitingQR = false;
async function refreshStatus() {
  try {
    const s = await apiGet('/api/status');
    $('#waStatus').textContent = s.whatsappReady ? 'WhatsApp pronto' : 'Aguardando QR';
    $('#waStatus').classList.toggle('ok', !!s.whatsappReady);

    const spinner = $('#qrSpinner');
    const btnGen = $('#btnForceLogout');
    const waiting = !s.whatsappReady && !s.lastQRAvailable;
    spinner.hidden = !waiting;
    if (btnGen) btnGen.disabled = waiting;
    const hint = $('#qrHint');
    if (hint) hint.textContent = waiting ? 'Gerando QR...' : 'Clique em Gerar QR Code.';

    if (!s.whatsappReady && s.lastQRAvailable) {
      try {
        const q = await apiGet('/api/qr');
        const img = $('#qrImg');
        img.src = q.dataUrl;
        img.style.display = 'block';
        $('#qrHint').style.display = 'none';
        spinner.hidden = true;
        awaitingQR = false;
        if (btnGen) btnGen.disabled = false;
      } catch {}
    } else {
      const img = $('#qrImg');
      img.removeAttribute('src');
      img.style.display = 'none';
      $('#qrHint').style.display = 'block';
      const waiting2 = !s.whatsappReady && !s.lastQRAvailable;
      spinner.hidden = !waiting2;
      if (btnGen) btnGen.disabled = waiting2;
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadConfigToUI() {
  try {
    const [{ config }, status] = await Promise.all([
      apiGet('/api/config'),
      apiGet('/api/status').catch(() => ({}))
    ]);
    $('#ui_token').value = config.TELEGRAM_BOT_TOKEN || '';
    $('#ui_chat_id').value = config.TELEGRAM_CHAT_ID || '';
    $('#ui_wa_id').value = config.WAPP_GROUP_ID || '';
    $('#ui_wa_name').value = config.WAPP_GROUP_NAME || '';
    // select de sessão
    const sel = $('#ui_session');
    if (sel) {
      const current = config.WAPP_SESSION || (status && status.session) || 'default';
      const opts = ['default'];
      if (current && !opts.includes(current)) opts.push(current);
      sel.innerHTML = '';
      for (const o of opts) {
        const op = document.createElement('option');
        op.value = o; op.textContent = o;
        sel.appendChild(op);
      }
      sel.value = current;
    }
    $('#ui_port').value = config.UI_PORT || '43117';
    try {
      const c = await apiGet('/api/control');
      $('#ui_send_offset').value = String(c.offsetMinutes ?? 0);
    } catch {}
  } catch (e) {
    console.error(e);
  }
}

function bindEvents() {
  const modal = $('#settingsModal');
  const open = () => { modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; };
  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; };
  $('#btnSettings').addEventListener('click', async () => { await loadConfigToUI(); updatePreviewFromForm(); open(); });
  $('#btnCloseSettings').addEventListener('click', close);
  $('#btnCancelSettings').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) close(); });
  modal.addEventListener('keydown', (ev) => {
    if (modal.getAttribute('aria-hidden') === 'true') return;
    if (ev.key === 'Escape') { ev.preventDefault(); $('#btnCancelSettings').click(); }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      const t = ev.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'BUTTON' && t.type === 'button'))) return;
      ev.preventDefault(); $('#btnSaveSettings').click();
    }
  });

  $('#settingsForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const chat = $('#ui_chat_id').value.trim();
      const token = $('#ui_token').value.trim();
      const errToken = $('#err_token');
      if (chat && !token) {
        if (errToken) errToken.hidden = false;
        $('#ui_token').focus();
        return;
      } else { if (errToken) errToken.hidden = true; }

      const updates = {
        TELEGRAM_BOT_TOKEN: $('#ui_token').value.trim(),
        TELEGRAM_CHAT_ID: $('#ui_chat_id').value.trim(),
        WAPP_GROUP_ID: $('#ui_wa_id').value.trim(),
        WAPP_GROUP_NAME: $('#ui_wa_name').value.trim(),
        WAPP_SESSION: $('#ui_session').value.trim(),
        UI_PORT: $('#ui_port').value.trim(),
      };
      updatePreviewFromForm();
      $('#saveSpinner').hidden = false;
      $('#btnSaveSettings').disabled = true;
      $('#btnCancelSettings').disabled = true;
      const resp = await apiPost('/api/config', { updates });
      let offsetMinutes = parseInt($('#ui_send_offset').value || '0', 10) || 0;
      if (offsetMinutes < 0) offsetMinutes = 0; if (offsetMinutes > 60) offsetMinutes = 60;
      await apiPost('/api/control', { offsetMinutes });
      if (resp.ok) { showToast('Configurações salvas'); close(); }
      else { showToast('Falha ao salvar .env', false); }
    } catch (e) {
      console.error(e);
      showToast('Erro ao salvar .env', false);
    } finally {
      $('#saveSpinner').hidden = true;
      $('#btnSaveSettings').disabled = false;
      $('#btnCancelSettings').disabled = false;
    }
  });

  $('#btnForceLogout').addEventListener('click', async () => {
    try {
      awaitingQR = true;
      $('#qrSpinner').hidden = false;
      $('#btnForceLogout').disabled = true;
      await apiPost('/api/wa/clear_session', {});
      showToast('Gerando novo QR...');
      setTimeout(refreshStatus, 500);
    } catch (e) {
      console.error(e);
      showToast('Erro ao solicitar QR', false);
    }
  });

  $('#btnToggleToken').addEventListener('click', () => {
    const el = $('#ui_token');
    el.type = el.type === 'password' ? 'text' : 'password';
    const on = document.querySelector('.eye.eye-on');
    const off = document.querySelector('.eye.eye-off');
    const showing = el.type === 'text';
    if (on && off) { on.hidden = !showing; off.hidden = showing; }
    const btn = $('#btnToggleToken');
    if (btn) btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
  });

  const preview = $('#settingsPreview');
  const previewPre = $('#settingsPreviewPre');
  const previewSwitch = $('#previewSwitch');
  function updatePreviewFromForm() {
    const updates = {
      TELEGRAM_BOT_TOKEN: $('#ui_token').value.trim(),
      TELEGRAM_CHAT_ID: $('#ui_chat_id').value.trim(),
      WAPP_GROUP_ID: $('#ui_wa_id').value.trim(),
      WAPP_GROUP_NAME: $('#ui_wa_name').value.trim(),
      WAPP_SESSION: $('#ui_session').value.trim(),
      UI_PORT: $('#ui_port').value.trim()
    };
    let offsetMinutes = parseInt($('#ui_send_offset').value || '0', 10) || 0;
    if (offsetMinutes < 0) offsetMinutes = 0; if (offsetMinutes > 60) offsetMinutes = 60;
    const payload = { updates, offsetMinutes };
    previewPre.textContent = JSON.stringify(payload, null, 2);
  }
  previewSwitch.addEventListener('change', () => {
    preview.hidden = !previewSwitch.checked;
    updatePreviewFromForm();
  });
  preview.hidden = !previewSwitch.checked;
  ['ui_token','ui_chat_id','ui_wa_id','ui_wa_name','ui_session','ui_port','ui_send_offset'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreviewFromForm);
  });
  const btnCopy = $('#btnCopyPreview');
  if (btnCopy) btnCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(previewPre.textContent || ''); showToast('Copiado'); }
    catch { showToast('Falha ao copiar', false); }
  });

  // confirmação
  const confirmModal = $('#confirmModal');
  const openConfirm = () => { confirmModal.classList.add('show'); confirmModal.setAttribute('aria-hidden', 'false'); };
  const closeConfirm = () => { confirmModal.classList.remove('show'); confirmModal.setAttribute('aria-hidden', 'true'); };
  $('#btnClearWa').addEventListener('click', () => { openConfirm(); });
  $('#btnCancelConfirm').addEventListener('click', () => { closeConfirm(); });
  confirmModal.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeConfirm(); });
  $('#btnConfirmDelete').addEventListener('click', async () => {
    try {
      await apiPost('/api/wa/clear_session', {});
      showToast('Sessão apagada. Gerando novo QR...');
      awaitingQR = true;
      $('#qrSpinner').hidden = false;
      $('#btnForceLogout').disabled = true;
      closeConfirm();
      $('#btnCancelSettings').click();
      setTimeout(refreshStatus, 800);
    } catch (e) {
      console.error(e);
      showToast('Erro ao apagar sessão', false);
    }
  });
}

async function init() {
  bindEvents();
  await refreshStatus();
  setInterval(refreshStatus, 4000);
}

document.addEventListener('DOMContentLoaded', init);
