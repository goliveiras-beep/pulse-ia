# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Pulse IA** is LiveMode's (a Brazilian live-TV production company) internal AI assistant and operations
portal. It has two faces:

1. A **Slack bot** (DM the "Pulse IA" app) for quick Q&A, checking the live-broadcast schedule, and
   self-reporting absences.
2. A **web portal** (`/api/app`) — server-rendered HTML dashboards for two roles: `colaborador`
   (collaborator: sees own shifts/schedule, requests time off) and `gestor` (manager: edits the team
   schedule, approves requests, generates schedules with AI, HR/hour-bank reports, document repository).

Everything is in Brazilian Portuguese — code comments, UI copy, variable/function names, and git commit
messages. Keep new code consistent with that.

## Stack & constraints

- Plain **Node.js ESM serverless functions** deployed on **Vercel** — every file in `api/` (and
  `api/auth/`) is an independent handler exporting `default async function handler(req, res)`, no shared
  router/framework (no Express/Next.js).
- **No build step, no bundler, no TypeScript, no linter/formatter config, and no test suite.** `package.json`
  declares a single dependency (`google-auth-library`) and zero scripts. There is nothing to `npm run
  build`/`test`/`lint` — verifying a change means reading the code carefully and, where possible, exercising
  the deployed endpoint.
- Static files (`index.html` marketing landing page, `privacy.html`, the Google site-verification file) are
  served as-is by Vercel; they are unrelated to the dynamic portal in `api/app.js`.
- `vercel.json` sets `maxDuration: 30` for all `api/*.js` functions and defines two cron schedules that hit
  `/api/monitor?token=pulse_monitor_2026` (roughly every hour during the day, half-hourly overnight).

## Running / deploying

- There is no local dev server checked into the repo. To run locally you'd use the Vercel CLI
  (`vercel dev`), which needs all the env vars below set in `.env.local` (copy `.env.example` as a starting
  point — it only lists two of them, the rest must be sourced from Vercel project settings or teammates).
- Deploys happen automatically on push via Vercel's GitHub integration (see `README.md` for the original
  setup steps: create the Vercel project, wire env vars, point the Slack app's Event Subscriptions URL at
  `/api/pulse`).
- There's no staging environment in this repo — changes to `api/*.js` go live on the next deploy.

### Environment variables actually read by the code

| Var | Used by |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `lib/google-auth.js` — service-account JSON (as a string) for all Google Sheets access |
| `GOOGLE_SHEET_ID` | the single spreadsheet acting as the app's database |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login flow (`api/app.js`, `api/auth/*`) |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | `api/upload-atestado.js` — uploads sick-note files to Drive under a fixed manager account |
| `PULSE_BASE_URL` | OAuth redirect URI base |
| `SLACK_BOT_TOKEN` | posting/reading via Slack Web API (`api/pulse.js`, `api/monitor.js`) |
| `SLACK_RH_CHANNEL` | HR notification channel for absence reports |
| `GROQ_API_KEY` | fast/cheap LLM calls (`llama-3.1-8b-instant` via Groq's OpenAI-compatible endpoint) — general Q&A, command parsing, motivational phrases |
| `ANTHROPIC_API_KEY` | `api/gerar-escala.js` only — calls Claude directly for AI-assisted schedule generation |
| `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` / `AIRTABLE_TABLE_ID` | the live-broadcast event calendar ("grade"), read from Airtable, cross-referenced against the work schedule everywhere |
| `CRON_TOKEN` | must equal the token in `vercel.json`'s cron paths for `api/monitor.js` to accept the request |
| `GITHUB_TOKEN` | `api/monitor.js` commits `data/grade_snapshot.json` back to this repo via the GitHub API to diff schedule changes over time |
| `DRIVE_ATESTADOS_FOLDER_ID` / `PULSE_REPOSITORY_FOLDER_ID` | Drive folder targets for uploads / the document repository (`api/repositorio.js`) |
| `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` | `api/auth/drive-token.js`, a manual one-off tool that mints a Drive refresh token and pushes it into Vercel env vars |
| `IMPORT_TOKEN` | bearer-token gate for `api/import-escala.js` (defaults to `pulse_import_2026`) |

## Architecture

### Google Sheets is the database

There's no real database — one Google Sheet (`GOOGLE_SHEET_ID`) is the system of record, accessed through
`lib/google-auth.js`'s `sheetsRequest(sheetId, path, method, body)` (JWT auth via service account, token
cached in-process). Every `api/*.js` file builds its own thin `getSheet`/`setSheet`/`appendSheet` wrappers
around it and reads/writes specific tabs by A1-notation range, e.g. `Escala!A2:F2000`. Key tabs:

- **`Equipe`** — the team roster. **Its column layout is not consistent across files** — e.g.
  `api/equipe.js` treats it as 9 columns (`nome, cargo, nucleo, email, slackId, regime, status,
  senhaHash, perfil`), while `api/equipe-view.js`/`api/app.js` treat it as 13 columns including
  `cpf, rg, nascimento, endereco, telefone, tipoContrato`. **Read the specific file's column-index usage
  before assuming a column's meaning** — don't cross-reference indices between files blindly.
- **`Escala`** — the work schedule. Row shape: `[data DD/MM, (unused), nome, entrada HH:MM, saída HH:MM,
  obs]`, where `obs` is one of `''`, `Folga`, `Férias`, `Dispensa Médica`, `Gerado IA`, `Ajustado IA`.
  Shifts crossing midnight are represented as `saída < entrada` (see `duracaoTurno`/`estaDeServico` for the
  overnight-wrap math, duplicated in several files).
- **`Ausências`** — absence requests/approvals. ID prefixes double as status: `PLS-...` = pending,
  `APROVADO-...` = approved, `RECUSADO`/`CANCELADO` = terminal negative states. Note the tab name is
  spelled with the accent (`Ausências`) in most files but **without it (`Ausencias`) in `api/escalas.js`** —
  check which one a given file targets.
- **`PulseConfig`** — generic key/value config sheet (currently just `publicacao_horizonte`, the DD/MM
  cutoff controlling how far ahead non-managers can see the published schedule). Auto-created on first
  write if missing (see `api/publicar.js`/`api/setup-config.js` for the create-tab-then-retry pattern).
- **`Ajustes`** — append-only audit log of schedule edits (who/what/when), written alongside every
  `Escala` mutation.
- Role checks are always "look up the user's row in `Equipe` by name/email, check the `perfil`/status
  column equals `'gestor'`/`'ativo'`" — there's no separate roles table.

Because everything is row-index arithmetic against a live spreadsheet (`rows.findIndex(...)`, writing to
`Escala!A${idx+2}:F${idx+2}`), sheet edits from the UI, from Airtable-derived logic, and from manual
spreadsheet edits can race or drift out of sync — be careful with any change that assumes a row's position
is stable across an `await`.

### Auth: hand-rolled cookie sessions, not a library

There's no auth framework/JWT library for the portal session. `pulse_session` is a cookie holding
`base64(payload|sha256(payload+ts+'pulse2026')|timestamp)`, checked for a 7-day expiry and signature match.
**Two incompatible payload formats exist in the wild**: an older `nome|hash|ts` format (`api/equipe.js`,
`api/gerar-escala.js`) and a newer one supporting an intermediate OAuth state via `~~` separators
(`nome~~accessToken~~refreshToken|hash|ts`, with a `~~OAUTH~~...` prefix used mid-login before the user is
matched to an `Equipe` row) used by `api/app.js` and most other files. When touching session logic, match
the newer format and be aware older files haven't been migrated.

Login flow: `/api/app` with no valid cookie renders a "Sign in with Google" page → Google OAuth →
`api/auth/callback.js` exchanges the code, sets an intermediate `~~OAUTH~~`-prefixed cookie → redirects to
`api/auth/register.js`, which matches the email against `Equipe`. If found & active, swaps in the final
session cookie; if the person is new, inserts a `pendente` row and shows a waiting page that polls
`api/auth/check-status.js`.

Two other cookies exist: `pulse_pending_action` (`api/chat.js`) holds a signed, TTL'd pending
schedule-change action awaiting the user's "confirmar"/"cancelar" reply — the AI-driven chat command flow
is propose-then-confirm, never a direct write.

**Not every route is auth/role-gated equally** — e.g. `api/meu-turno.js` (view someone's shift by name
slug) has no session check at all, and `api/dashboard.js` doesn't appear to check for a gestor role either.
Don't assume a new `api/*.js` file is protected just because most of its siblings are; check explicitly.

### Two LLM providers, used for different jobs

- **Groq** (`llama-3.1-8b-instant`, OpenAI-compatible chat completions endpoint) handles cheap/fast text
  tasks: general Slack Q&A (`api/pulse.js`), natural-language command→JSON-action interpretation for the
  chat-driven schedule editor (`api/chat.js`), and short motivational "frase do dia" copy (`api/app.js`).
- **Anthropic's API called directly** (model `claude-haiku-4-5-20251001`, no SDK — raw `fetch`) is used only
  in `api/gerar-escala.js` for the heavier reasoning involved in AI-assisted schedule generation (filling
  coverage gaps, suggesting days off based on fatigue/consecutive-days analysis).

### Airtable is the live-event calendar ("grade")

The broadcast schedule (individual live events/matches — separate from the *work* schedule in
`Escala`) lives in Airtable (base `appqPBoDUYfX2edOp`, table `tblkqT3nDu1Gw6bnf`), fetched read-only via
`fetch` + `filterByFormula`. Nearly every dashboard cross-references "who is on shift" (`Escala`) against
"what's airing" (Airtable events) to compute coverage — see `estaDeServico`/`statusTurno`/`cruzarEventos`
in `api/app.js` (duplicated with small variations in `api/dashboard.js`, `api/gerar-escala.js`,
`api/banco-horas.js`, `api/meu-turno.js`). `api/monitor.js` runs on a Vercel cron, diffs tomorrow's Airtable
schedule against `data/grade_snapshot.json` (committed back to this repo via the GitHub API), and posts
changes to Slack.

### Labor-law rule engine

`lib/escalas-engine.js` is the one file of pure, sheet-agnostic functions: shift duration math handling
midnight-crossing turnos, interjornada (rest-between-shifts) calculation, and `analisarDia`/`analisarEscala`
which flag CLT violations (>10h jornada, missing 1h break over 8h, <11h interjornada, 6th/7th consecutive
day without a folga). Reuse these instead of re-deriving the math elsewhere.

### Server-rendered HTML portal (`api/app.js`, ~1900 lines)

The largest file in the repo. It renders full HTML documents as JS template strings — no templating engine.
Conventions to follow when touching it (or the similar `api/equipe-view.js`, `api/escalas.js`,
`api/repositorio.js`, `api/ausencias.js`):

- A shared `baseHTML(titulo, conteudo, script)` wrapper defines the `<head>`/theme CSS; light/dark theme is
  done entirely with CSS custom properties (`--bg`, `--text`, `--card`, ...) swapped under an `html.dark`
  class, toggled client-side via `localStorage['pulse-theme']`.
  User-supplied strings interpolated into HTML must go through the `esc()` escaping helper defined locally
  in each file — there's no shared escaping utility, so if you add a new HTML-rendering file, add your own.
- Business logic that determines what to render (metrics, per-day status, coverage) is computed **twice**:
  once server-side for the initial page render, and reimplemented in the inline `<script>` block so
  day/week/month navigation doesn't need a server round-trip. When changing a rule (e.g. what counts as
  "on shift"), grep for all client-side JS reimplementations of the same logic in the same file, not just
  the server-side function.
  - Interaction is via inline `onclick="..."` handlers, not `addEventListener`, and a floating AI chat
  widget (`CHAT_IA` constant, posts to `/api/chat`) plus an absence-request widget (`SOLICITAR_BTN`) are
  appended to most authenticated pages.
- Dates are BRT (`America/Sao_Paulo`, UTC-3) computed with manual offset arithmetic (`getBRT()`,
  `agoraBrasil()`, `hojeBrasil()`, or `toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})`) — this
  pattern is copy-pasted per file rather than shared; there's no timezone library. The canonical
  human-facing date format is `DD/MM` (year omitted — assumed current year).

### One-off / admin scripts

`api/setup-*.js` and `api/fix-gestor.js` are manually-triggered, GET-based scripts (gated by a hardcoded
`?token=pulse_setup_2026` query param, not tied to any env var) used once to bootstrap sheet tabs and seed
data — they are not part of normal request flow and mutate the spreadsheet with hardcoded values when
visited. `api/import-escala.js` is a similar one-off backfill for a specific date range. Treat these as
historical/break-glass tools, not endpoints to build on.

## Conventions worth following

- Git commits: lowercase, no accents, conventional-style prefixes (`feat:`, `fix:`, `refactor:`), written in
  Portuguese, e.g. `fix: usar campo ENCODERS GERAL (via cellFormat=string) em vez de Encoder Auxiliar`.
- Match the file you're editing's existing session-cookie format, sheet column indices, and BRT date-math
  style rather than introducing a new pattern — this codebase has several competing conventions already
  (see the "Auth" and "Google Sheets" sections above) and consistency-within-file matters more than
  consistency-across-repo here.
- Several magic strings act as informal secrets (session salt `'pulse2026'`, setup token
  `'pulse_setup_2026'`, cron token, import token default) — they're hardcoded rather than derived from env
  vars in most places. Don't "fix" this as a drive-by refactor; treat it as existing behavior unless asked
  to change it.
