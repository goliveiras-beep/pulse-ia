// cloudflare/rotas.js — monta a tabela de rotas a partir do vercel.json (rewrites) e dos handlers
// standalone de api/. Não duplica nada: se uma rota é adicionada ao vercel.json, ela passa a valer aqui.
import vercel from '../vercel.json' with { type: 'json' };
import crons from './crons.json' with { type: 'json' };
import app from '../api/app.js';
import chat from '../api/chat.js';
import escalas from '../api/escalas.js';
import gerarEscala from '../api/gerar-escala.js';
import pulse from '../api/pulse.js';
import chamados from '../api/chamados.js';
import equipamentos from '../api/equipamentos.js';
import authBundle from '../api/auth-bundle.js';
import setupBundle from '../api/setup-bundle.js';
import gestaoBundle from '../api/gestao-bundle.js';
import extrasBundle from '../api/extras-bundle.js';
import maestroBundle from '../api/maestro-bundle.js';

const ARQUIVOS = {
  'app': app, 'chat': chat, 'escalas': escalas, 'gerar-escala': gerarEscala, 'pulse': pulse,
  'chamados': chamados, 'equipamentos': equipamentos,
  'auth-bundle': authBundle, 'setup-bundle': setupBundle, 'gestao-bundle': gestaoBundle,
  'extras-bundle': extrasBundle, 'maestro-bundle': maestroBundle,
};

// Handlers com bodyParser desligado (leem o corpo bruto: assinatura HMAC do Slack).
const SEM_BODY_PARSER = new Set(['pulse']);

const tabela = new Map();
for (const nome of Object.keys(ARQUIVOS)) {
  if (!nome.endsWith('-bundle')) tabela.set(`/api/${nome}`, { arquivo: nome, extraQuery: {} });
}
for (const { source, destination } of vercel.rewrites) {
  const u = new URL(destination, 'http://x');
  const arquivo = u.pathname.replace(/^\/api\//, '');
  if (!ARQUIVOS[arquivo]) throw new Error(`rewrite sem handler: ${destination}`);
  tabela.set(source, { arquivo, extraQuery: Object.fromEntries(u.searchParams) });
}

export function resolverRota(pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const r = tabela.get(p);
  if (!r) return null;
  return { handler: ARQUIVOS[r.arquivo], extraQuery: r.extraQuery, bodyParser: !SEM_BODY_PARSER.has(r.arquivo) };
}

export const CABECALHOS = (vercel.headers?.[0]?.headers || []).map(({ key, value }) => [key, value]);
// Crons ficam só aqui (não no vercel.json) pra não rodar em dobro enquanto a Vercel ainda está no ar.
export const CRONS = crons;
