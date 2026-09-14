// lib/setup-guard.js — gate compartilhado pras rotas administrativas de setup/fix (api/setup-*,
// api/fix-gestor). Substitui o token fixo 'pulse_setup_2026' (hardcoded, visível no repositório
// público) por sessão de gestor de verdade — achado crítico do SentinelaMODE 2026-09-14.
import { sheetsRequest } from './google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => { const p = c.trim().split('='); cookies[p.shift()] = p.join('='); });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const last = d.lastIndexOf('|'), sec = d.lastIndexOf('|', last - 1);
    const data = d.slice(0, sec), h = d.slice(sec + 1, last), ts = d.slice(last + 1);
    if (Date.now() - parseInt(ts, 10) > 7 * 24 * 3600 * 1000) return null;
    if (h !== hash(data + ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    return { nome: data.split('~~')[0] };
  } catch { return null; }
}

// Retorna true (segue o handler) se quem está logado é gestor; senão já responde 403/redirect
// e retorna false — o handler deve fazer "if (!(await exigirSessaoDeGestor(req, res))) return;"
// como primeira linha.
export async function exigirSessaoDeGestor(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(403).json({ error: 'Acesso negado — faça login como gestor em /api/app antes de acessar esta rota.' });
    return false;
  }
  try {
    const eq = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:I200').then(d => d.values || []);
    const u = eq.find(r => r[0] === session.nome);
    if (u?.[8] !== 'gestor') {
      res.status(403).json({ error: 'Acesso negado — esta rota é restrita a gestores.' });
      return false;
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
    return false;
  }
  return true;
}
