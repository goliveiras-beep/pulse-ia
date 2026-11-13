// /api/push — avisos no celular (Web Push). Ver lib/notificacoes.js, lib/push.js e sw.js.
//   GET  ?acao=chave        → chave pública VAPID (o navegador precisa pra se inscrever)
//   GET  ?acao=estado       → { inscrito } esta pessoa já tem algum aparelho cadastrado?
//   GET  ?acao=pendentes    → textos dos últimos minutos (o service worker busca quando chega o push)
//   POST ?acao=inscrever    → { endpoint, aparelho }
//   POST ?acao=desinscrever → { endpoint }
//   POST ?acao=testar       → manda um aviso de teste pra própria pessoa
import { createHash, timingSafeEqual } from 'crypto';
import { chavePublica } from '../push.js';
import { inscrever, desinscrever, temInscricao, pendentes, notificarPessoa } from '../notificacoes.js';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function bate(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach((c) => { const p = c.trim().split('='); cookies[p.shift()] = p.join('='); });
  const t = cookies[COOKIE_NAME]; if (!t) return null;
  try {
    const d = Buffer.from(t, 'base64').toString('utf8');
    const last = d.lastIndexOf('|'), sec = d.lastIndexOf('|', last - 1);
    const data = d.slice(0, sec), h = d.slice(sec + 1, last), ts = d.slice(last + 1);
    if (Date.now() - parseInt(ts, 10) > 7 * 24 * 3600 * 1000) return null;
    if (!bate(h, hash(data + ts)) || data.startsWith('~~OAUTH~~')) return null;
    return { nome: data.split('~~')[0] };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const acao = req.query.acao || '';
  if (acao === 'chave') return res.status(200).json({ chave: chavePublica() });
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Não autenticado' });
  try {
    if (req.method === 'GET' && acao === 'estado') return res.status(200).json({ inscrito: await temInscricao(s.nome) });
    if (req.method === 'GET' && acao === 'pendentes') return res.status(200).json({ itens: await pendentes(s.nome) });
    if (req.method === 'POST' && acao === 'inscrever') {
      const b = req.body || {};
      await inscrever(s.nome, String(b.endpoint || ''), b.aparelho);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && acao === 'desinscrever') {
      await desinscrever(s.nome, String((req.body || {}).endpoint || ''));
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && acao === 'testar') {
      const r = await notificarPessoa(s.nome, 'Teste do Pulse', 'Se você está lendo isso, os avisos de escala estão funcionando.');
      return res.status(200).json({ ok: true, ...r });
    }
  } catch (e) {
    console.error('push', acao, e && e.message);
    return res.status(400).json({ error: 'Não foi possível' });
  }
  return res.status(404).json({ error: 'Ação desconhecida' });
}
