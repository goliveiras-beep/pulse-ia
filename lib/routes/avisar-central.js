// lib/routes/avisar-central.js — "Avisar a central": o gestor digita um recado no Pulse e a Echo da central fala em voz alta.
// Rotas (via extras-bundle, rewrite /api/avisar-central):
//   GET  /api/avisar-central  → abre o Mapa 3D já no painel "Falar com a central" (a tela fica no mapa desde 2026-11-09)
//   POST /api/avisar-central  → { texto } → manda o recado pra Echo (chamado pelo painel do mapa)
//
// A Amazon não deixa um sistema de fora mandar a Echo falar; quem faz isso é o Voice Monkey (voicemonkey.io), uma skill
// ativada na conta Amazon da Echo da central. O Pulse só chama a API dele:
//   POST https://api-v3.voicemonkey.io/announce  { token, device, speech, [language], [voice] }
// Segredos do Cloudflare: VOICEMONKEY_TOKEN, VOICEMONKEY_DEVICE (id do "Speaker" criado no painel do Voice Monkey).
// Opcional: VOICEMONKEY_LANGUAGE = pt-BR (sem isso a Echo fica muda). A voz sai de vozDoNome() (quem manda o recado).
// Plano grátis do Voice Monkey: 200 recados por mês.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
export const MAX_TEXTO = 300;

// ── Sessão (mesmo formato do mapa.js / banco-horas.js) ──
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => { const p = c.trim().split('='); const k = p.shift(); cookies[k] = p.join('='); });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe), h = d.slice(secondPipe + 1, lastPipe), ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (!assinaturaBate(h, hash(data + ts))) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    return nome ? { nome } : null;
  } catch { return null; }
}

// Equipe: 8=perfil, 10=status de aprovação
async function ehGestorAtivo(nome) {
  const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:L200')}`);
  const r = (d.values || []).find(x => x[0] === nome);
  return !!r && r[8] === 'gestor' && (r[10] || 'ativo').toLowerCase() === 'ativo';
}

// texto pra voz: tira emoji/símbolos que a Alexa leria em voz alta, junta espaços, corta no limite
export function limparRecado(t) {
  return String(t || '').replace(/[^\p{L}\p{N}\s.,:;!?()+\-/#%]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
}
export const falaDoRecado = (nome, texto) => 'Recado do Pulse, de ' + String(nome || '').trim().split(' ')[0] + '. ' + texto;

// Voz de quem manda o recado (vozes pt-BR do Voice Monkey: Camila e Vitória femininas, Ricardo masculina).
// O cadastro não tem campo de sexo; por decisão do Guilherme (2026-11-09) a voz é deduzida pelo PRIMEIRO NOME:
// termina em "a" (fora as exceções masculinas) ou está na lista/terminações femininas abaixo → Camila ou Vitória
// (sempre a mesma pra mesma pessoa); o resto → Ricardo. Pode errar em nome incomum — aí é só incluir na lista certa.
const FEMININOS = ['beatriz', 'raquel', 'isabel', 'isabelle', 'ester', 'esther', 'ruth', 'rute', 'carmen', 'lourdes', 'mercedes', 'ines', 'iris', 'lis', 'liz',
  'thais', 'tais', 'lais', 'deise', 'alice', 'rose', 'ingrid', 'miriam', 'yasmin', 'jasmin', 'karen', 'ellen', 'helen', 'hellen', 'marlene', 'irene', 'ivone',
  'nicole', 'michelle', 'simone', 'ivonne', 'raissa', 'sueli', 'sheila', 'agnes', 'abigail', 'rachel', 'monique', 'yara', 'kelly', 'keli', 'evelyn', 'jennifer', 'joyce', 'gabrielle'];
const MASCULINOS_EM_A = ['luca', 'nicola', 'andrea', 'joshua', 'jonata', 'ilya', 'mustafa', 'josua', 'garcia'];
const TERMINACOES_FEMININAS = ['iane', 'ine', 'ele', 'elle', 'ise', 'any', 'ely', 'aly', 'ily', 'ane'];
export function vozDoNome(nome) {
  const p = String(nome || '').trim().split(' ')[0].normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();
  const feminino = !!p && !MASCULINOS_EM_A.includes(p) && (p.endsWith('a') || FEMININOS.includes(p) || TERMINACOES_FEMININAS.some(t => p.endsWith(t)));
  if (!feminino) return 'Ricardo';
  let h = 0; for (const c of p) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 ? 'Vitoria' : 'Camila';
}

async function enviarParaEcho(fala, voz) {
  const corpo = { token: process.env.VOICEMONKEY_TOKEN, device: process.env.VOICEMONKEY_DEVICE, speech: fala };
  if (process.env.VOICEMONKEY_LANGUAGE) corpo.language = process.env.VOICEMONKEY_LANGUAGE;
  if (voz) corpo.voice = voz;
  const r = await fetch('https://api-v3.voicemonkey.io/announce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error('Voice Monkey ' + r.status + ': ' + txt.slice(0, 160));
  return txt;
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.method === 'POST') return res.status(401).json({ error: 'Não autenticado' });
    return res.redirect(302, '/api/app');
  }
  let gestor = false;
  try { gestor = await ehGestorAtivo(session.nome); } catch { return res.status(503).json({ error: 'Não consegui ler a planilha agora' }); }
  if (!gestor) {
    if (req.method === 'POST') return res.status(403).json({ error: 'Só gestor pode avisar a central' });
    return res.redirect(302, '/api/app');
  }
  const configurado = !!(process.env.VOICEMONKEY_TOKEN && process.env.VOICEMONKEY_DEVICE);

  if (req.method === 'POST') {
    if (!configurado) return res.status(503).json({ error: 'A Echo da central ainda não foi conectada (Voice Monkey não configurado).' });
    const texto = limparRecado(req.body && req.body.texto);
    if (!texto) return res.status(400).json({ error: 'Escreva o recado.' });
    try {
      await enviarParaEcho(falaDoRecado(session.nome, texto), vozDoNome(session.nome));
      console.log('avisar-central: recado enviado por', session.nome);
      return res.status(200).json({ ok: true, falado: falaDoRecado(session.nome, texto) });
    } catch (e) {
      console.error('avisar-central:', e && e.message);
      return res.status(502).json({ error: 'A Echo não recebeu o recado. Tente de novo em instantes.' });
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  return res.redirect(302, '/api/mapa?falar=1');   // link antigo/favorito: abre o painel no mapa
}

export const PRONTOS = [
  'Alguém da central, por favor me ligue.',
  'Atenção: confiram o que está no ar.',
  'Atenção: chamado urgente aberto no Pulse.',
  'Confiram o Slack, por favor.',
];
