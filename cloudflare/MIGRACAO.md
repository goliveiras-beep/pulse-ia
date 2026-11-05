# Migração Vercel → Cloudflare Workers

Mesmo código das rotas (`api/` e `lib/routes/`), sem reescrever handlers. O que muda:

- `worker.js` — entrada do Worker; `cloudflare/adapter.js` traduz Request/Response ↔ `(req, res)`.
- `cloudflare/rotas.js` — lê os `rewrites`/`headers`/`crons` do `vercel.json` (fonte única das rotas).
- `wrangler.toml` — config, Cron Triggers (mesmos horários UTC) e `PULSE_BASE_URL`.
- `scripts/cf-assets.mjs` — copia estáticos da raiz para `.cf-assets/` (nunca inclui `worker.js`).
- `lib/google-auth.js` — JWT da service account via WebCrypto (roda em Node e Workers; sem `google-auth-library`).

A Vercel continua funcionando sem mudança de comportamento até o domínio ser trocado.

## Comandos

```bash
npm run cf:dev      # local em http://localhost:8787 (usa .dev.vars, que NÃO vai pro git)
npm run cf:deploy   # publica na conta logada no wrangler
```

## Segredos (`wrangler secret put NOME`, um por vez)

Obrigatórios: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`AIRTABLE_API_KEY`, `GROQ_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_RH_CHANNEL`,
`CRON_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `DRIVE_ATESTADOS_FOLDER_ID`.

Conforme uso: `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`, `AIRTABLE_PAT`, `IMPORT_TOKEN`,
`PULSE_REPOSITORY_FOLDER_ID`, `MAESTRO_SHEET_ID`, `MAESTRO_AGENT_TOKEN`, `GEMINI_API_KEY`,
`EXTRACTION_MODEL`, `GMAIL_BOOKING_REFRESH_TOKEN`, `SLACK_BOOKING_CHANNEL`, `ANTHROPIC_API_KEY`
(se `gerar-escala` usar).

**Não copiar** `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID`: sem eles, `/api/auth/drive-token` e
`/api/auth/gmail-token` caem no modo "copie o token e cadastre manualmente" (agora com
`wrangler secret put GOOGLE_DRIVE_REFRESH_TOKEN`).

`PULSE_BASE_URL` já está no `wrangler.toml` (`https://pulse.livemode.ai`).

## Antes de apontar `pulse.livemode.ai`

1. Zona `livemode.ai` na conta Cloudflare (ou CNAME `pulse` apontando pro Worker).
2. Descomentar `[[routes]]` no `wrangler.toml`.
3. Google Cloud Console → credenciais OAuth: adicionar `https://pulse.livemode.ai/api/auth/callback`
   (e os callbacks de `drive-token` / `gmail-token`).
4. Slack: trocar a Request URL de Event Subscriptions para `https://pulse.livemode.ai/api/pulse`.
5. Agente do Maestro (`maestro-agent/.env`): trocar a URL base.
6. Todos precisam logar de novo (cookie é por domínio).

## Plano Cloudflare

O plano gratuito limita a **10 ms de CPU por requisição**; as páginas do Pulse renderizam HTML grande e
tendem a estourar isso. Assumir o plano **Workers Paid (US$ 5/mês)**: 30 s de CPU, sem limite de funções.

## Testado localmente (wrangler dev)

Estáticos e headers de segurança, login (redirect OAuth com a URL nova), callback com erro, POST JSON,
multipart, 404, assinatura HMAC do Slack (corpo bruto), Cron Trigger (com `CRON_SECRET`) chegando na rota.
Não testado: acesso real ao Sheets/Airtable/Slack (faltam os segredos), `unpdf`/`mammoth`/`mailparser`
do Booking (empacotam, mas não foram exercitados).
