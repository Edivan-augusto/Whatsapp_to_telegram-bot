
# wa-tg-bridge-assistant

Bridge **WhatsApp(Group) → Telegram** com **assistente por comandos do Telegram** para configurar tudo sem editar arquivos.

## Recursos
- `/start` vincula o chat atual do Telegram como destino.
- `/status`, `/id`.
- `/groups` lista grupos do WhatsApp (após conectar via QR).
- `/bind_group <n|id>` vincula grupo pelo índice ou id.
- `/unbind_group` remove vínculo.
- **Bind rápido via WhatsApp:** mande `#bind` dentro do grupo desejado.
- Persistência automática em `.bind.json` (TG chat + WA group).
- **FAKE mode:** `TEST_FAKE_WPP=1` simula mensagens a cada 5s (sem WhatsApp).

## Instalação
```bash
npm install
copy .env.example .env  # Windows (no Linux/Mac: cp .env.example .env)
```

Edite `.env` e informe:
```
TELEGRAM_BOT_TOKEN=SEU_TOKEN_AQUI
# opcional (se usar /start para vincular não precisa preencher):
# TELEGRAM_CHAT_ID=123456789
# WAPP_GROUP_ID=1203xxx@g.us
# WAPP_GROUP_NAME=Nome do Grupo
WAPP_SESSION=EMPRESA_01
# TEST_FAKE_WPP=1
```

## Execução
**FAKE (sem WhatsApp):**
```powershell
npm run fake
# ou: $env:TEST_FAKE_WPP=1; node .\index.js
```
Fale com seu bot: `/start` → envia mensagens simuladas para esse chat a cada 5s.

**REAL (com WhatsApp):**
```powershell
npm start
```
- Escaneie o QR no terminal.
- No Telegram: `/start` para vincular o chat.
- `/groups` para listar os grupos.
- `/bind_group 1` (exemplo) para vincular pelo índice, ou use `#bind` dentro do grupo no WhatsApp.

## Observações
- Não rode dois processos com o **mesmo token** simultaneamente (evita 409).
- Para enviar a **grupos/canais no Telegram**, adicione o bot e, se canal, torne-o **admin**.
- Produção séria → considerar WhatsApp Cloud API (WABA).
