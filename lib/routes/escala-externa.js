// lib/routes/escala-externa.js — API SOMENTE-LEITURA da escala (aba Escala) para sistemas de fora do Pulse.
//
//   GET /api/escala-externa?de=2026-11-20&ate=2026-12-20&nome=rafael
//   Authorization: Bearer <token>
//
// Tokens ficam no secret ESCALA_API_TOKENS, no formato "quem:token,quem2:token2" (ex.: "ste:abc123...").
// Cada consumidor tem o próprio token: dá pra revogar um sem mexer nos outros, e o log mostra quem chamou.
// Não grava nada, não expõe dado pessoal além de nome + horário (nada de CPF/telefone/e-mail da aba Equipe).
import { sheetsRequest } from '../google-auth.js';

const MAX_DIAS = 120;     // janela máxima por chamada
const PADRAO_DIAS = 30;   // sem "ate": hoje + 30 dias

function tokensConfigurados() {
  const m = new Map();
  for (const par of String(process.env.ESCALA_API_TOKENS || '').split(',')) {
    const i = par.indexOf(':');
    if (i <= 0) continue;
    const quem = par.slice(0, i).trim(), tok = par.slice(i + 1).trim();
    if (quem && tok.length >= 24) m.set(tok, quem);   // token curto demais é ignorado de propósito
  }
  return m;
}

// comparação em tempo constante (não vaza, pelo tempo de resposta, quantos caracteres batem)
function igual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function quemEh(req) {
  const h = String(req.headers?.authorization || '');
  const tok = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
  if (!tok) return null;
  for (const [t, quem] of tokensConfigurados()) if (igual(t, tok)) return quem;
  return null;
}

// "Hoje" em Brasília, como data pura (sem hora)
function hojeBRT() {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  const [a, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
const iso = d => d.toISOString().slice(0, 10);
function lerISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
}

// A aba guarda só "DD/MM" (sem ano). Escolhe o ano que deixa a data mais perto de hoje
// (turno de jan/27 visto em nov/26 vira 2027; turno de out/26 visto em jan/27 continua 2026).
function dataDaLinha(ddmm, hoje) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(ddmm || '').trim());
  if (!m) return null;
  const dia = +m[1], mes = +m[2];
  let melhor = null;
  for (const ano of [hoje.getUTCFullYear() - 1, hoje.getUTCFullYear(), hoje.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCMonth() !== mes - 1) continue;
    if (!melhor || Math.abs(d - hoje) < Math.abs(melhor - hoje)) melhor = d;
  }
  return melhor;
}

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Só GET' });

  const quem = quemEh(req);
  if (!quem) return res.status(401).json({ error: 'Token ausente ou inválido' });

  const hoje = hojeBRT();
  const de = req.query.de ? lerISO(req.query.de) : hoje;
  if (!de) return res.status(400).json({ error: 'Parâmetro "de" inválido (use AAAA-MM-DD)' });
  const ate = req.query.ate ? lerISO(req.query.ate) : new Date(de.getTime() + PADRAO_DIAS * 86400000);
  if (!ate) return res.status(400).json({ error: 'Parâmetro "ate" inválido (use AAAA-MM-DD)' });
  if (ate < de) return res.status(400).json({ error: '"ate" é antes de "de"' });
  if ((ate - de) / 86400000 > MAX_DIAS) return res.status(400).json({ error: `Janela máxima de ${MAX_DIAS} dias` });
  const filtroNome = semAcento(req.query.nome);

  let linhas;
  try {
    const raw = await sheetsRequest(process.env.GOOGLE_SHEET_ID, '/values/Escala!A2:F10000', 'GET', null, { cache: true });
    linhas = raw.values || [];
  } catch (e) {
    console.error('escala-externa: falha lendo Sheets', e?.message);
    return res.status(503).json({ error: 'Não consegui ler a escala agora, tente de novo em instantes' });
  }

  const vistos = new Set();
  const turnos = [];
  for (const r of linhas) {
    const nome = String(r[2] || '').trim();
    if (!nome) continue;
    const d = dataDaLinha(r[0], hoje);
    if (!d || d < de || d > ate) continue;
    if (filtroNome && !semAcento(nome).includes(filtroNome)) continue;
    const entrada = String(r[3] || '').trim(), saida = String(r[4] || '').trim(), obs = String(r[5] || '').trim();
    const chave = [iso(d), nome, entrada, saida, obs].join('|');
    if (vistos.has(chave)) continue;   // a aba às vezes tem a mesma linha repetida
    vistos.add(chave);
    turnos.push({
      data: iso(d),
      nome,
      entrada: entrada || null,
      saida: saida || null,
      folga: /^folga/i.test(obs) || (!entrada && !saida),
      observacao: obs || null,
    });
  }
  turnos.sort((a, b) => a.data.localeCompare(b.data) || (a.entrada || '').localeCompare(b.entrada || '') || a.nome.localeCompare(b.nome));

  console.log(`escala-externa: ${quem} leu ${turnos.length} turnos (${iso(de)} a ${iso(ate)})`);
  return res.status(200).json({
    fusoHorario: 'America/Sao_Paulo',
    de: iso(de),
    ate: iso(ate),
    total: turnos.length,
    turnos,
  });
}
