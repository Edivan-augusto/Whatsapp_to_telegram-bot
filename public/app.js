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

async function loadTemplateUI() {
  try {
    const el = $('#msgTemplate');
    if (!el) return;
    const r = await apiGet('/api/template');
    el.value = (r && r.template) ? r.template : '';
  } catch {}
}

let awaitingQR = false;
async function refreshStatus() {
  try {
    const s = await apiGet('/api/status');
    $('#waStatus').textContent = s.whatsappReady ? 'WhatsApp pronto' : 'Aguardando QR';
    $('#waStatus').classList.toggle('ok', !!s.whatsappReady);

    // Se a modal de configurações estiver aberta, evite interferir nos controles da tela principal
    const isSettingsOpen = document.getElementById('settingsModal')?.getAttribute('aria-hidden') === 'false';
    const spinner = $('#qrSpinner');
    const btnGen = $('#btnForceLogout');
    const waiting = !s.whatsappReady && !s.lastQRAvailable;
    if (!isSettingsOpen) {
      spinner.hidden = !waiting;
      const hint = $('#qrHint');
      if (s.whatsappReady) {
        if (btnGen) btnGen.style.display = 'none';
        if (hint) {
          hint.style.display = 'block';
          hint.textContent = 'Você já está conectado, exclua sua sessão para gerar novamente';
        }
      } else {
        if (btnGen) { btnGen.style.display = ''; btnGen.disabled = !!awaitingQR; }
        if (hint) hint.textContent = waiting ? 'Gerando QR...' : 'Clique em Gerar QR Code.';
      }
    }

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
    } else if (!isSettingsOpen) {
      const img = $('#qrImg');
      img.removeAttribute('src');
      img.style.display = 'none';
      $('#qrHint').style.display = 'block';
      const waiting2 = !s.whatsappReady && !s.lastQRAvailable;
      spinner.hidden = !waiting2;
      if (btnGen && !s.whatsappReady) btnGen.disabled = !!awaitingQR;
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
    // Chat de destino (nome do grupo)
    const grp = $('#ui_grupo_nome');
    if (grp) grp.value = config.WAPP_GROUP_NAME || '';
    const chatId = $('#ui_tg_chat_id');
    if (chatId) chatId.value = config.TELEGRAM_CHAT_ID || '';
    try {
      const c = await apiGet('/api/control');
      const offset = Number(c.offsetMinutes || 0);
      const toggle = $('#enable_sending_toggle');
      const input = $('#ui_controle_envio');
      const group = $('#sendingControlGroup');
      const LAST_KEY = 'send_offset_last';
      if (toggle) toggle.checked = offset > 0;
      // Preserve o último valor quando estiver desativado; atualize com o valor real quando ativo
      if (input) {
        if (offset > 0) {
          input.value = String(offset);
          try { localStorage.setItem(LAST_KEY, String(offset)); } catch {}
        } else {
          try {
            const last = (localStorage.getItem(LAST_KEY) || '').trim();
            if (last) input.value = last;
          } catch {}
        }
      }
      if (group) group.classList.toggle('is-disabled', offset <= 0);
    } catch {}
  } catch (e) {
    console.error(e);
  }
}

function bindEvents() {
  const modal = $('#settingsModal');
  const open = () => { modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; };
  const close = () => { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; };
  // Renderizar ícones (Lucide) para engrenagem e olho
  try {
    const btnSettings = $('#btnSettings');
    if (btnSettings) {
      btnSettings.innerHTML = '<i data-lucide="settings" aria-hidden="true"></i>';
    }
    const tokenBtn = $('#tokenToggle');
    if (tokenBtn) {
      tokenBtn.innerHTML = '<i id="tokenIconShow" class="is-hidden" data-lucide="eye" aria-hidden="true"></i>' +
                           '<i id="tokenIconHide" data-lucide="eye-off" aria-hidden="true"></i>';
    }
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch {}

  $('#btnSettings').addEventListener('click', async () => { await loadConfigToUI(); open(); });
  $('#btnClose').addEventListener('click', close);
  $('#btnCancel').addEventListener('click', close);
  const backdrop = modal.querySelector('.modal__backdrop');
  if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) close(); });
  modal.addEventListener('keydown', (ev) => {
    if (modal.getAttribute('aria-hidden') === 'true') return;
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      const t = ev.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'BUTTON' && t.type === 'button'))) return;
      ev.preventDefault(); $('#btnSave').click();
    }
  });

  $('#settingsForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const token = $('#ui_token').value.trim();

      const updates = {
        TELEGRAM_BOT_TOKEN: $('#ui_token').value.trim(),
        WAPP_GROUP_NAME: $('#ui_grupo_nome').value.trim(),
        TELEGRAM_CHAT_ID: ($('#ui_tg_chat_id').value || '').trim(),
      };
      $('#btnSave').disabled = true;
      $('#btnCancel').disabled = true;
      const resp = await apiPost('/api/config', { updates });
      const toggle = $('#enable_sending_toggle');
      let offsetMinutes = 0;
      if (toggle && toggle.checked) {
        offsetMinutes = parseInt($('#ui_controle_envio').value || '5', 10) || 5;
        if (offsetMinutes < 1) offsetMinutes = 1; if (offsetMinutes > 60) offsetMinutes = 60;
      }
      await apiPost('/api/control', { offsetMinutes });
      if (resp.ok) { showToast('Configurações Salvas'); close(); }
      else { showToast('Falha ao salvar .env', false); }
    } catch (e) {
      console.error(e);
      showToast('Erro ao salvar .env', false);
    } finally {
      $('#btnSave').disabled = false;
      $('#btnCancel').disabled = false;
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

  // Toggle de visibilidade do token (novo layout)
  const tokenToggleBtn = $('#tokenToggle');
  const syncTokenIconState = () => {
    const el = $('#ui_token');
    const showIco = $('#tokenIconShow'); // open eye
    const hideIco = $('#tokenIconHide'); // closed eye
    if (!el || !showIco || !hideIco) return;
    const visible = el.type === 'text';
    showIco.classList.toggle('is-hidden', !visible);
    hideIco.classList.toggle('is-hidden', visible);
    if (tokenToggleBtn) tokenToggleBtn.setAttribute('aria-label', visible ? 'Ocultar token' : 'Mostrar token');
  };
  if (tokenToggleBtn) tokenToggleBtn.addEventListener('click', () => {
    const el = $('#ui_token');
    if (!el) return;
    el.type = (el.type === 'password') ? 'text' : 'password';
    syncTokenIconState();
  });
  // garantir estado inicial correto
  syncTokenIconState();

  // Sincronizar estado do controle de envio
  const sendingToggle = $('#enable_sending_toggle');
  const sendingGroup = $('#sendingControlGroup');
  if (sendingToggle && sendingGroup) {
    const syncSendingControlState = () => {
      const isEnabled = sendingToggle.checked;
      sendingGroup.classList.toggle('is-disabled', !isEnabled);
    };
    sendingToggle.addEventListener('change', syncSendingControlState);
    syncSendingControlState();
  }

  // Persistir o valor digitado do delay localmente para preservar entre aberturas
  const delayInput = $('#ui_controle_envio');
  if (delayInput) {
    const LAST_KEY = 'send_offset_last';
    delayInput.addEventListener('input', () => {
      try { localStorage.setItem(LAST_KEY, String(delayInput.value || '')); } catch {}
    });
  }

  // Apagar sessão via botão na zona de perigo
  const btnClear = $('#btnClear');
  if (btnClear) btnClear.addEventListener('click', async () => {
    try {
      if (!confirm('Tem certeza que deseja apagar a sessão do WhatsApp? Esta ação não pode ser desfeita.')) return;
      await apiPost('/api/wa/clear_session', {});
      showToast('Sessao apagada', false);
      awaitingQR = true;
      $('#qrSpinner').hidden = false;
      $('#btnForceLogout').disabled = true;
      setTimeout(refreshStatus, 800);
    } catch (e) {
      console.error(e);
      showToast('Erro ao apagar sessão', false);
    }
  });

  // Salvar template
  const btnSaveTpl = $('#btnSaveTemplate');
  if (btnSaveTpl) btnSaveTpl.addEventListener('click', async () => {
    try {
      const el = $('#msgTemplate');
      const text = el ? String(el.value || '') : '';
      await apiPost('/api/template', { text });
      showToast('Mensagem salva');
    } catch (e) {
      console.error(e);
      showToast('Erro ao salvar mensagem', false);
    }
  });
}

async function init() {
  bindEvents();
  await refreshStatus();
  await loadTemplateUI();
  setInterval(refreshStatus, 4000);
}

document.addEventListener('DOMContentLoaded', init);



