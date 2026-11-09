// lib/routes/mapa.js — Mapa 3D do Pulse ("The Sims" da operação): a planta da central em 3D com quem
// está de plantão, os eventos no ar em cada PD, chamados abertos e o CPD com os racks.
//
// Rotas (via extras-bundle, rewrite /api/mapa):
//   GET /api/mapa            → a página (Three.js, vem do cdnjs — já liberado no CSP do vercel.json)
//   GET /api/mapa?dados=1    → JSON com o estado de agora (a página busca isso a cada minuto)
//
// A planta (SALAS) está num lugar só, em metros, desenhada a partir do esboço do Guilherme (2026-11-09).
// Pra ajustar tamanho/posição/nome de uma sala, mude só o objeto dela aqui embaixo.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
import { menuItens } from '../menu.js';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';

// ── Planta ───────────────────────────────────────────────────────────────────────────────────
// x/z = canto de cima à esquerda, w = largura (eixo x), d = profundidade (eixo z); tudo em metros.
// porta: lado da parede com a porta ('W' = voltada pro corredor da esquerda, 'N' = pro norte).
// tipo: define o chão e os móveis (central | apoio | playout | pd | off | cpd | corredor).
export const SALAS = [
  { id: 'corredor', nome: 'Corredor',  tipo: 'corredor', x: 0,    z: 0,    w: 2.2,  d: 33 },
  { id: 'central',  nome: 'Central',   tipo: 'central',  x: 2.2,  z: 0,    w: 14,   d: 8,    porta: 'W' },
  { id: 'shade',    nome: 'Shade',     tipo: 'apoio',    x: 2.2,  z: 8,    w: 14,   d: 4,    porta: 'W' },
  { id: 'playout',  nome: 'Playout',   tipo: 'playout',  x: 2.2,  z: 12,   w: 14,   d: 3.5,  porta: 'W' },
  { id: 'pd6',      nome: 'PD6',       tipo: 'pd',       x: 2.2,  z: 15.5, w: 14,   d: 3,    porta: 'W' },
  { id: 'pd5',      nome: 'PD5',       tipo: 'pd',       x: 2.2,  z: 18.5, w: 14,   d: 2.2,  porta: 'W' },
  { id: 'pd4',      nome: 'PD4',       tipo: 'pd',       x: 2.2,  z: 20.7, w: 14,   d: 1.8,  porta: 'W' },
  { id: 'pd3',      nome: 'PD3',       tipo: 'pd',       x: 2.2,  z: 22.5, w: 14,   d: 1.5,  porta: 'W' },
  { id: 'pd2',      nome: 'PD2',       tipo: 'pd',       x: 2.2,  z: 24,   w: 14,   d: 2,    porta: 'W' },
  { id: 'pd1',      nome: 'PD1',       tipo: 'pd',       x: 2.2,  z: 26,   w: 14,   d: 3.2,  porta: 'W' },
  { id: 'off2',     nome: 'OFF 2',     tipo: 'off',      x: 16.2, z: 24,   w: 4,    d: 2,    porta: 'W' },
  { id: 'off1',     nome: 'OFF 1',     tipo: 'off',      x: 16.2, z: 26,   w: 4,    d: 3.2,  porta: 'W' },
  { id: 'cpd',      nome: 'CPD',       tipo: 'cpd',      x: 0,    z: 33,   w: 5.5,  d: 19,   porta: 'N' },
  // Estúdios e controles (chute a partir dos nomes do Airtable: "Estúdio 1 (SWA)", "Estúdio 2 (SWB)"...) — ajustar.
  { id: 'corredor2', nome: 'Corredor', tipo: 'corredor', x: 16.2, z: 0,    w: 1.2,  d: 22 },
  { id: 'estudio1', nome: 'Estúdio 1', tipo: 'estudio',  x: 17.4, z: 0,    w: 14,   d: 11,   porta: 'W' },
  { id: 'swa',      nome: 'SWA',       tipo: 'controle', x: 31.4, z: 0,    w: 5,    d: 11,   porta: 'W' },
  { id: 'estudio2', nome: 'Estúdio 2', tipo: 'estudio',  x: 17.4, z: 12,   w: 12,   d: 10,   porta: 'W' },
  { id: 'swb',      nome: 'SWB',       tipo: 'controle', x: 29.4, z: 12,   w: 5,    d: 10,   porta: 'W' },
  { id: 'ext',      nome: 'EXT (externas)', tipo: 'ext', x: 22,   z: 24,   w: 9,    d: 6 },
];

// Texto do Airtable ("Padrão de Produção") / alocação do equipamento → id da sala (ou null)
export function salaDoTexto(t) {
  const s = String(t || '');
  let m0 = s.match(/est[úu]dio\s*-?\s*([12])\b/i); if (m0) return 'estudio' + m0[1];
  if (/\bEXT\b|externa/i.test(s)) return 'ext';
  let m = s.match(/\bPD\s*-?\s*([1-6])\b/i); if (m) return 'pd' + m[1];
  m = s.match(/\bOFF\s*-?\s*([12])\b/i); if (m) return 'off' + m[1];
  if (/playout/i.test(s)) return 'playout';
  if (/\bshade\b|\bshape\b/i.test(s)) return 'shade';
  if (/\bcpd\b|\brack/i.test(s)) return 'cpd';
  if (/central/i.test(s)) return 'central';
  return null;
}

// SWA / SWB (switcher/controle) citado no mesmo texto: "Estúdio 1 (SWA)" → acende o estúdio E a sala SWA.
export function controleDoTexto(t) {
  const m = String(t || '').match(/\bSW([AB])\b/i);
  return m ? 'sw' + m[1].toLowerCase() : null;
}

// ── Sessão (mesmo formato do banco-horas.js) ────────────────────────────────────────────────
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const p = c.trim().split('='); const k = p.shift(); cookies[k] = p.join('=');
  });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (!assinaturaBate(h, hash(data + ts))) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    return nome ? { nome } : null;
  } catch { return null; }
}

// ── Dados de agora ──────────────────────────────────────────────────────────────────────────
function getBRT() { const a = new Date(); return new Date(a.getTime() + ((-3 * 60) - a.getTimezoneOffset()) * 60000); }
function fmtData(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function toMin(h) { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function hhmm(min) { min = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
function normalizarDf(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const p = s.split('-'); return p[2].slice(0, 2).padStart(2, '0') + '/' + p[1].padStart(2, '0'); }
  if (/^\d{1,2}\/\d{1,2}/.test(s)) { const p = s.split('/'); return p[0].padStart(2, '0') + '/' + p[1].padStart(2, '0'); }
  return s;
}
async function getSheet(range) {
  try { const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`, 'GET', null, { cache: true }); return d.values || []; }
  catch { return []; }
}

// Quem está em turno AGORA. `carry` = a linha é de ontem (turno que virou a noite): só conta a madrugada
// de hoje. Nunca inferir isso pela hora — sempre vem por parâmetro (regra do projeto, ver CLAUDE.md).
export function estaEmTurno(ent, sai, agoraMin, carry) {
  const e = toMin(ent), s = toMin(sai);
  if (e == null || s == null) return false;
  if (s > e) return !carry && agoraMin >= e && agoraMin < s;           // turno diurno
  return carry ? agoraMin < s : agoraMin >= e;                          // vira a noite
}

// Link da live: só aceita https do YouTube (o texto vem do Airtable, então valida antes de virar href).
export function linkYoutube(u) {
  try {
    const x = new URL(String(u || '').trim().split(' ')[0]);
    const h = x.hostname.toLowerCase();
    return x.protocol === 'https:' && (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') ? x.href : '';
  } catch { return ''; }
}

async function getEventosHoje(dataISO) {
  const filtro = `AND(DATESTR({fldgNvn52DK5Yu8x9})='${dataISO}',{Status}!='Cancelado')`;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=60&cellFormat=string&timeZone=America%2FSao_Paulo&userLocale=pt-BR`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    const d = await r.json();
    return (d.records || []).map(rec => {
      const f = rec.fields || {};
      const ini = toMin(f['Início do Evento BRT'] || f['PGM (horário)']);
      let fim = toMin(f['Encerramento']);
      if (ini != null && fim != null && fim <= ini) fim += 1440;
      return { nome: f['Match ID'] || 'Evento', ini, fim, local: f['Padrão de Produção'] || '', tipo: f['Tipo de Conteúdo'] || '',
        plataformas: String(f['Plataforma'] || '').split(',').map(x => x.trim()).filter(Boolean), youtube: linkYoutube(f['URL YouTube']) };
    }).filter(e => e.ini != null);
  } catch { return []; }
}

// ── Operações CazéTV (tempo real): quem está em cada PD / SW / estúdio / playout ─────────────────
// Sistema separado; o /api/bootstrap é público. Cada evento traz { studio, status, equipe:{ sw:{dtv,gc,vt,audio,opVideo},
// estudio:{cam1..,ast1..,ilum}, playout } }. A Central NÃO vem daqui — é da Escala do Pulse.
const OPS_URL = 'https://operacoes-cazecazetv.vercel.app/api/bootstrap';
const FUNCOES = { dtv: 'DTV', gc: 'GC', vt: 'VT', audio: 'Áudio', opVideo: 'Op. Vídeo', cam1: 'Câmera 1', cam2: 'Câmera 2', cam3: 'Câmera 3', ast1: 'Assistente', ast2: 'Assistente', ilum: 'Iluminador' };

// Cache de 30s no Cloudflare (caches.default, compartilhado entre as instâncias do Worker): a resposta tem
// ~330 KB e levava ~1s; com várias pessoas com o mapa aberto, todas dividem a mesma busca. Na Vercel/Node
// não existe `caches` — aí busca direto, como antes.
const OPS_CACHE_TTL = 30;
// Funções que ficam sempre na mesma sala, seja qual for o evento (regras do Guilherme, 2026-11-09):
// Op. Vídeo e Iluminador no Shade; o Áudio (sonoplasta) fica na cabine dentro do SW (ver 'sub').
const SALA_FIXA = { opVideo: 'shade', ilum: 'shade' };   // Áudio (sonoplasta) fica no SW do evento, na cabine (sub-sala) dentro dele

async function getOperacoes() {
  const chave = 'https://ops-cache.pulse.internal/bootstrap';
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (cache) {
    try { const hit = await cache.match(chave); if (hit) return await hit.json(); } catch {}
  }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(OPS_URL, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const texto = await r.text();
    if (cache) {
      try { await cache.put(chave, new Response(texto, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + OPS_CACHE_TTL } })); } catch {}
    }
    return JSON.parse(texto);
  } catch { return null; }
}
function titulo(p) { return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''; }
export function nomeCurto(n) { const p = String(n || '').trim().split(' ').filter(t => t && !t.startsWith('(')); return p.length > 1 ? titulo(p[0]) + ' ' + titulo(p[p.length - 1]) : titulo(p[0] || ''); }

// Pessoas dos eventos que estão acontecendo agora, já com a sala onde ficam.
export function pessoasDasOperacoes(ops, brt, agoraMin) {
  const dia = brt.getDate() + '/' + (brt.getMonth() + 1) + '/' + brt.getFullYear();
  const pessoas = [], aoVivo = new Set(), vistos = new Set();
  for (const e of (ops && ops.events) || []) {
    if (!String(e.data || '').startsWith(dia + ' ')) continue;
    if (/cancel/i.test(e.nome || '') || /cancel/i.test(e.status || '')) continue;
    const ini = toMin(e.horario); let fim = toMin(e.fimPrevisto);
    if (ini == null) continue;
    if (fim == null) fim = ini + 60; else if (fim <= ini) fim += 1440;
    if (!(/acontecendo/i.test(e.status || '') || (agoraMin >= ini && agoraMin < fim))) continue;
    const sala = salaDoTexto(e.studio), ctrl = controleDoTexto(e.studio);
    if (sala) aoVivo.add(sala); if (ctrl) aoVivo.add(ctrl);
    const eq = e.equipe || {};
    const salaSW = ctrl || sala, salaEst = sala || ctrl;
    const add = (nome, funcao, salaId, posto) => {
      if (!nome || !salaId) return;
      const chave = norm(nome); if (vistos.has(chave)) return; vistos.add(chave);
      pessoas.push({ nome: nomeCurto(nome), completo: nome, sala: salaId, funcao, sub: funcao === 'Áudio' ? 'audio' : '', posto: posto || '', evento: e.nome, origem: 'operacoes', turno: (e.horario || '') + '–' + (e.fimPrevisto || '') });
    };
    for (const [k, v] of Object.entries(eq.sw || {})) add(v, FUNCOES[k] || k, SALA_FIXA[k] || salaSW, k);
    for (const [k, v] of Object.entries(eq.estudio || {})) add(v, FUNCOES[k] || k, SALA_FIXA[k] || salaEst, k);
    if (eq.playout) add(eq.playout, 'Playout/MCR', 'playout', 'playout');
  }
  return { pessoas, aoVivo: [...aoVivo] };
}

export async function montarDados() {
  const brt = getBRT();
  const hojeStr = fmtData(brt);
  const ontem = new Date(brt); ontem.setDate(ontem.getDate() - 1);
  const ontemStr = fmtData(ontem);
  const agoraMin = brt.getHours() * 60 + brt.getMinutes();

  const [equipeRaw, escalaRaw, ausRaw, eventosRaw, chamadosRaw, equipRaw, opsRaw] = await Promise.all([
    getSheet('Equipe!A2:N200'),
    getSheet('Escala!A2:F5000'),
    getSheet('Ausências!A2:F500'),
    getEventosHoje(fmtAirtable(brt)),
    getSheet('Chamados!A2:S2000'),
    getSheet('Equipamentos!A2:O3000'),
    getOperacoes(),
  ]);

  const ativos = new Map(equipeRaw.filter(r => r[0] && (r[10] || 'ativo').toLowerCase() === 'ativo').map(r => [norm(r[0]), r[0]]));

  // ausência aprovada que cobre hoje (DD/MM; ano corrente, com virada de ano)
  const num = s => { const p = String(s || '').split('/'); return (+p[1]) * 100 + (+p[0]); };
  const hojeNum = num(hojeStr);
  const ausentes = new Set(ausRaw.filter(a => String(a[0] || '').startsWith('APROVADO') && a[4]).map(a => {
    const i = num(a[4]), f = num(a[5] || a[4]);
    const cobre = f >= i ? (hojeNum >= i && hojeNum <= f) : (hojeNum >= i || hojeNum <= f);
    return cobre ? norm(a[1]) : null;
  }).filter(Boolean));

  const pessoas = [];
  const jaVisto = new Set();
  for (const r of escalaRaw) {
    const df = normalizarDf(r[0]);
    const carry = df === ontemStr, hoje = df === hojeStr;
    if (!carry && !hoje) continue;
    const nome = r[2], obs = String(r[5] || '');
    if (!nome || /^folga|^f[ée]rias|dispensa/i.test(obs)) continue;
    const chave = norm(nome);
    if (!ativos.has(chave) || ausentes.has(chave) || jaVisto.has(chave)) continue;
    if (!estaEmTurno(r[3], r[4], agoraMin, carry)) continue;
    jaVisto.add(chave);
    // A Escala não diz em qual sala a pessoa está (só o horário) → todo mundo de plantão fica na Central.
    pessoas.push({ nome: ativos.get(chave), sala: 'central', turno: `${r[3]}–${r[4]}` });
  }

  // link da live: o do Airtable; se faltar, o que o sistema de Operações tiver pro mesmo evento
  const ytOps = new Map(((opsRaw && opsRaw.events) || []).filter(x => x.urlYoutube).map(x => [norm(x.nome), x.urlYoutube]));
  const eventos = eventosRaw.map(e => ({
    nome: e.nome, sala: salaDoTexto(e.local), controle: controleDoTexto(e.local), local: e.local, tipo: e.tipo,
    plataformas: e.plataformas || [], youtube: e.youtube || linkYoutube(ytOps.get(norm(e.nome))),
    inicio: hhmm(e.ini), fim: e.fim != null ? hhmm(e.fim) : '',
    noAr: e.fim != null ? (agoraMin >= e.ini && agoraMin < e.fim) : false,
  })).sort((a, b) => a.inicio.localeCompare(b.inicio));

  const locEquip = new Map(equipRaw.filter(r => r[0]).map(r => [r[0], { nome: r[2] || '', alocacao: r[6] || '' }]));
  const chamados = chamadosRaw.filter(r => r[0] && !/conclu|resolv|fecha|cancel/i.test(r[6] || 'Aberto')).map(r => {
    const eq = locEquip.get(r[1]) || { nome: r[2] || '', alocacao: '' };
    return { id: r[0], equipamento: r[2] || eq.nome, problema: r[3] || '', prioridade: r[4] || 'Baixa', status: r[6] || 'Aberto',
      sala: salaDoTexto(eq.alocacao) || salaDoTexto(r[5]) || null };
  });

  const ops = pessoasDasOperacoes(opsRaw, brt, agoraMin);
  const jaNasOperacoes = new Set(ops.pessoas.map(p => norm(p.completo)).concat(ops.pessoas.map(p => norm(p.nome))));
  const pessoasPulse = pessoas.filter(p => !jaNasOperacoes.has(norm(p.nome)));
  return { agora: hhmm(agoraMin), data: hojeStr, pessoas: [...pessoasPulse, ...ops.pessoas], salasAoVivo: ops.aoVivo, operacoes: !!opsRaw, eventos, chamados };
}

// ── Página ──────────────────────────────────────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const CSS = String.raw`
:root{--bg:#0b1020;--panel:#141b30;--panel2:#1b2440;--line:#26324f;--text:#e8edf8;--mut:#8d9bbd;--acc:#4cc9f0;--red:#ff4d5e;--amb:#ffb020;--grn:#3ddc97}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
#topo{position:fixed;inset:0 0 auto 0;height:52px;display:flex;align-items:center;gap:12px;padding:0 14px;background:linear-gradient(#0b1020ee,#0b102000);z-index:20}
#topo h1{font-size:16px;margin:0;font-weight:700;letter-spacing:.3px}#topo .sub{color:var(--mut);font-size:12px}
.sp{flex:1}.relogio{font:600 15px ui-monospace,Consolas,monospace;color:var(--acc)}
.btn{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.btn:hover{border-color:var(--acc)}
.menu{position:relative}.menu .lista{display:none;position:absolute;right:0;top:38px;min-width:230px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 10px 30px #0008}
.menu.aberto .lista{display:block}.menu a,.menu button.menu-item{display:block;color:var(--text);text-decoration:none;padding:8px 10px;border-radius:6px;font-size:13px}.menu a:hover{background:var(--panel2)}
#cena{position:fixed;inset:0}#cena canvas{display:block;width:100%;height:100%}
#painel{position:fixed;right:12px;top:60px;bottom:12px;width:310px;max-width:calc(100vw - 24px);background:#141b30ee;border:1px solid var(--line);border-radius:14px;padding:14px;overflow:auto;z-index:15;backdrop-filter:blur(6px)}
#painel h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--mut);margin:14px 0 6px}#painel h2:first-child{margin-top:0}
.res{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.res div{background:var(--panel2);border-radius:10px;padding:8px 6px;text-align:center}.res b{display:block;font-size:20px}.res span{font-size:11px;color:var(--mut)}
.ev{padding:8px 10px;border-radius:10px;background:var(--panel2);margin-bottom:6px;border-left:3px solid var(--line)}.ev.ar{border-left-color:var(--red)}
.ev small{color:var(--mut);display:block}.tag{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:5px;background:var(--red);color:#fff;margin-left:4px}
.pes{display:inline-block;background:var(--panel2);border-radius:20px;padding:3px 9px;margin:0 4px 5px 0;font-size:12px}
.cha{padding:7px 10px;border-radius:10px;background:#3a1620;margin-bottom:6px;font-size:12.5px}.cha.m{background:#3a2d12}.cha.b{background:#1d2a3a}
#atalhos{position:fixed;left:12px;bottom:12px;display:flex;gap:8px;flex-wrap:wrap;z-index:15}
#dica{position:fixed;left:12px;top:56px;color:var(--mut);font-size:11.5px;z-index:10}
.vazio{color:var(--mut);font-size:12.5px}
.plats{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}.dest{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--mut);margin-right:2px}
.plat{display:inline-block;font-size:10.5px;padding:1px 8px;border-radius:10px;background:#26324f;color:#cfe0ff}
.yt{display:inline-block;margin-top:7px;font-size:12px;color:#ff7b7b;text-decoration:none;font-weight:600}.yt:hover{text-decoration:underline}
#erro{position:fixed;inset:0;display:none;place-items:center;text-align:center;padding:30px;z-index:30;background:var(--bg)}
@media (max-width:700px){#painel{top:auto;height:42vh;left:8px;right:8px;width:auto;bottom:56px}#atalhos{bottom:8px}#dica{display:none}}
`;

// JS do navegador. ATENÇÃO: fica dentro de um template literal do servidor — nada de crases nem de
// "${" aqui dentro (use concatenação com +).
const CLIENTE = String.raw`
(function(){
var SALAS = __SALAS__;
var DEMO = __DEMO__;
var DADOS = { agora:'--:--', pessoas:[], eventos:[], chamados:[] };
var ALTURA_PAREDE = 1.15;
var porId = {}; SALAS.forEach(function(s){ porId[s.id] = s; });

var CURTO_PLAT = { 'Youtube - CazéTV':'YouTube', 'Amazon Prime Video':'Prime', 'Samsung - Fast':'Samsung', 'Stats Perform':'Stats' };
function curtoPlat(p){ return CURTO_PLAT[p] || p; }
function extraEvento(e){
  var h = '';
  if (e.plataformas && e.plataformas.length) { h += '<div class="plats"><span class="dest">Destino</span>' + e.plataformas.map(function(p){ return '<span class="plat">' + esc(curtoPlat(p)) + '</span>'; }).join('') + '</div>'; }
  if (e.youtube) { h += '<a class="yt" href="' + esc(e.youtube) + '" target="_blank" rel="noopener noreferrer">&#9654; Assistir ao vivo no YouTube</a>'; }
  return h;
}
function hashStr(s){ var h=0; for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return Math.abs(h); }
function rnd(seed){ var x=Math.sin(seed*9301+49297)*233280; return x-Math.floor(x); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (typeof THREE === 'undefined') { var e=document.getElementById('erro'); e.style.display='grid'; e.innerHTML='<div><h2>Não consegui carregar o 3D</h2><p>A biblioteca gráfica não abriu (rede bloqueada ou WebGL desligado).</p></div>'; return; }

var cena = new THREE.Scene();
cena.background = new THREE.Color(0x0b1020);
cena.fog = new THREE.Fog(0x0b1020, 60, 140);
var el = document.getElementById('cena');
var renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
el.appendChild(renderer.domElement);
var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);

cena.add(new THREE.HemisphereLight(0xcfe3ff, 0x202840, 0.85));
var sol = new THREE.DirectionalLight(0xffffff, 0.75);
sol.position.set(-20, 40, 10); sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.left=-40; sol.shadow.camera.right=40; sol.shadow.camera.top=50; sol.shadow.camera.bottom=-20; sol.shadow.camera.far=120;
cena.add(sol);

var chao = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({ color:0x0f162b, roughness:1 }));
chao.rotation.x = -Math.PI/2; chao.position.set(10,-0.06,20); chao.receiveShadow = true; cena.add(chao);

function mat(cor, extra){ var o = { color:cor, roughness:0.85, metalness:0.05 }; if(extra){ for(var k in extra) o[k]=extra[k]; } return new THREE.MeshStandardMaterial(o); }
function caixa(w,h,d,cor,x,y,z,grupo,extra){
  var m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(cor,extra));
  m.position.set(x,y+h/2,z); m.castShadow = true; m.receiveShadow = true; (grupo||cena).add(m); return m;
}
function etiqueta(texto, cor, escala){
  var c = document.createElement('canvas'); var ctx = c.getContext('2d');
  var fonte = 'bold 34px system-ui,Segoe UI,sans-serif'; ctx.font = fonte;
  var w = Math.ceil(ctx.measureText(texto).width) + 36; c.width = w; c.height = 64;
  ctx.font = fonte; ctx.fillStyle = 'rgba(11,16,32,.82)';
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(0,0,w,64,18); else ctx.rect(0,0,w,64); ctx.fill();
  ctx.fillStyle = cor || '#e8edf8'; ctx.textBaseline = 'middle'; ctx.fillText(texto, 18, 34);
  var t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, depthTest:false }));
  var k = (escala||1) * 0.011; s.scale.set(w*k, 64*k, 1); s.renderOrder = 10; return s;
}

var CORES_CHAO = { corredor:0x2a3350, central:0x1d3557, apoio:0x2b3a55, playout:0x23405c, pd:0x24324f, off:0x3a3350, cpd:0x15242f, estudio:0x1f3a34, controle:0x2a2f4a, ext:0x2d2f36, audio:0x2f2a4a };
var COM_LUZ_AO_VIVO = { pd:1, estudio:1, controle:1, ext:1 };
var grupoSalas = {};   // id -> { piso, centro:{x,z}, aoVivo:Mesh, alerta:Mesh }
var alvosClique = [];

function parede(g, x1,z1,x2,z2, vaos){
  var dx = x2-x1, dz = z2-z1, comp = Math.sqrt(dx*dx+dz*dz), esp = 0.14;
  var segs = [[0,comp]];
  (vaos||[]).forEach(function(v){ // v = [inicio, fim] ao longo da parede
    var novo=[]; segs.forEach(function(s){ if(v[1]<=s[0]||v[0]>=s[1]){ novo.push(s); } else { if(v[0]>s[0]) novo.push([s[0],v[0]]); if(v[1]<s[1]) novo.push([v[1],s[1]]); } }); segs = novo;
  });
  segs.forEach(function(s){
    var l = s[1]-s[0], t = (s[0]+s[1])/2/comp;
    var cx = x1+dx*t, cz = z1+dz*t;
    var m = caixa(dx===0?esp:l, ALTURA_PAREDE, dz===0?esp:l, 0xb9c4dc, cx, 0, cz, g, { roughness:0.9 });
  });
}

function construirSala(s){
  var g = new THREE.Group(); cena.add(g);
  var cx = s.x + s.w/2, cz = s.z + s.d/2;
  var piso = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.1, s.d), mat(CORES_CHAO[s.tipo]||0x24324f, { roughness:0.95 }));
  piso.position.set(cx, -0.05, cz); piso.receiveShadow = true; piso.userData.sala = s.id; g.add(piso); alvosClique.push(piso);
  var info = { piso:piso, centro:{x:cx,z:cz}, grupo:g, aoVivo:null, alerta:null, sala:s };
  if (s.tipo !== 'corredor' && s.tipo !== 'ext') {
    var vW = s.porta==='W' ? [[s.d/2-0.65, s.d/2+0.65]] : [];
    var vN = s.porta==='N' ? [[1.0, 2.4]] : [];
    parede(g, s.x, s.z, s.x, s.z+s.d, vW);                 // oeste
    parede(g, s.x+s.w, s.z, s.x+s.w, s.z+s.d, []);         // leste
    parede(g, s.x, s.z, s.x+s.w, s.z, vN);                 // norte
    parede(g, s.x, s.z+s.d, s.x+s.w, s.z+s.d, []);         // sul
    var rot = etiqueta(s.nome, '#e8edf8', (s.tipo==='pd' || s.tipo==='controle' || s.tipo==='audio') ? 0.8 : 1);
    rot.position.set(s.tipo==='cpd'?cx:s.x+1.8+(s.nome.length*0.15), ALTURA_PAREDE+0.35, s.tipo==='cpd'?s.z+0.8:s.z+0.45); g.add(rot);
  } else if (s.tipo === 'ext') {
    var rotE = etiqueta(s.nome, '#e8edf8', 0.9); rotE.position.set(cx, 1.2, s.z+0.6); g.add(rotE);
  }
  grupoSalas[s.id] = info;
  mobiliar(s, g, info);
}

// ── Móveis (poucos, só pra dar vida) ──
function mesaComMonitor(g, x, z, rotY, cor){
  var gr = new THREE.Group(); gr.position.set(x,0,z); gr.rotation.y = rotY||0; g.add(gr);
  caixa(1.6,0.06,0.7,0x8a93a8,0,0.72,0,gr); caixa(0.06,0.72,0.6,0x59627a,-0.7,0,0,gr); caixa(0.06,0.72,0.6,0x59627a,0.7,0,0,gr);
  caixa(0.55,0.33,0.04,0x0a0f1c,0,0.95,-0.22,gr,{ emissive:cor||0x2a6fdb, emissiveIntensity:0.9 });
  caixa(0.04,0.2,0.04,0x333c52,0,0.78,-0.22,gr);
  caixa(0.42,0.46,0.4,0x2b3350,0,0,0.65,gr);
  return gr;
}
function mobiliar(s, g, info){
  var x0=s.x, z0=s.z;
  if (s.tipo==='central') {
    caixa(10,1.8,0.12,0x05070d, x0+8,0.4,z0+0.3,g,{ emissive:0x1e5fbf, emissiveIntensity:0.55 });            // paredão de vídeo
    for (var i=0;i<4;i++){ for (var f=0;f<2;f++){ mesaComMonitor(g, x0+3.2+i*2.4, z0+3.2+f*2.6, 0, i%2?0xd9433f:0x2a6fdb); } }
  } else if (s.tipo==='playout' || s.tipo==='apoio') {
    for (var j=0;j<5;j++){ mesaComMonitor(g, x0+2.4+j*2.5, z0+s.d/2, 0, 0x2aa87a); }
  } else if (s.tipo==='pd') {
    var n = s.d > 2.5 ? 4 : 3;
    for (var k=0;k<n;k++){ mesaComMonitor(g, x0+2.6+k*3, z0+s.d-0.9, 0, 0xe0a02a); }
    // monitores de Preview (PV) e Programa (PGM) — todas as PDs têm; o PGM acende forte quando há evento no ar
    caixa(1.2,0.7,0.08,0x0a0f1c, x0+3.2, 0.5, z0+0.14, g,{ emissive:0x1f9d55, emissiveIntensity:0.8 });
    info.pgm = caixa(1.2,0.7,0.08,0x0a0f1c, x0+4.6, 0.5, z0+0.14, g,{ emissive:0xd9433f, emissiveIntensity:0.35 });
    var tPv = etiqueta('PV', '#7ee0a5', 0.32); tPv.position.set(x0+3.2, 1.4, z0+0.25); g.add(tPv);
    var tPg = etiqueta('PGM', '#ff8a8a', 0.32); tPg.position.set(x0+4.6, 1.4, z0+0.25); g.add(tPg);
    var luz = new THREE.Mesh(new THREE.BoxGeometry(s.w-0.3,0.02,s.d-0.3), new THREE.MeshBasicMaterial({ color:0xff3b4d, transparent:true, opacity:0 }));
    luz.position.set(s.x+s.w/2,0.02,s.z+s.d/2); g.add(luz); info.aoVivo = luz;
  } else if (s.tipo==='off') {
    caixa(2.2,0.45,0.9,0x6b4f86,s.x+s.w/2,0,s.z+s.d-0.7,g); caixa(2.2,0.45,0.2,0x5b4275,s.x+s.w/2,0.4,s.z+s.d-0.25,g);
    caixa(0.8,0.4,0.8,0x2b3350,s.x+0.8,0,s.z+0.9,g);
  } else if (s.tipo==='estudio') { estudio(s, g);
  } else if (s.tipo==='controle') {
    // duas fileiras de operação ao norte e, ao fundo (sul), a cabine do sonoplasta: sub-sala dentro do mesmo SW
    for (var q=0;q<3;q++){ mesaComMonitor(g, s.x+1.3+q*1.1, s.z+2.0, Math.PI/2, 0x7a5af8); mesaComMonitor(g, s.x+1.3+q*1.1, s.z+4.8, Math.PI/2, 0x2aa87a); }
    caixa(0.2,1.2,s.d-6,0x05070d,s.x+s.w-0.6,0.5,s.z+(s.d-3.6)/2,g,{ emissive:0x1e5fbf, emissiveIntensity:0.5 });
    var cab = cabineAudio(s);
    parede(g, s.x, cab.z, s.x+s.w, cab.z, [[0.5,1.7]]);                                       // divisória, com porta
    caixa(1.0,0.12,cab.d-1.2, 0x2b3350, s.x+s.w-1.5, 0.75, cab.z+cab.d/2, g);                  // mesa de som
    caixa(0.6,0.06,cab.d-1.6, 0x9aa7c7, s.x+s.w-1.5, 0.9, cab.z+cab.d/2, g, { emissive:0x7a5af8, emissiveIntensity:0.5 });
    caixa(0.5,0.5,0.4, 0x161d2e, s.x+s.w-0.7, 1.0, cab.z+0.6, g, { emissive:0x2a6fdb, emissiveIntensity:0.4 });
    caixa(0.5,0.45,0.5, 0x2b3350, s.x+s.w-2.5, 0, cab.z+cab.d/2, g);
    var rotC = etiqueta('Sonoplastia', '#c3b5ff', 0.4); rotC.position.set(s.x+s.w/2, 1.7, cab.z+cab.d/2); g.add(rotC);
  } else if (s.tipo==='ext') {
    caixa(5,2.2,2.2,0xd8dde8,s.x+s.w/2,0,s.z+s.d/2,g); caixa(1.2,1.4,2.1,0xb7bfd0,s.x+s.w/2+3.1,0,s.z+s.d/2,g);
    caixa(0.7,0.7,0.7,0x39435e,s.x+1,0,s.z+s.d-1,g);
  } else if (s.tipo==='cpd') { racks(s, g, info); }
  if (COM_LUZ_AO_VIVO[s.tipo] && !info.aoVivo) {
    var luz2 = new THREE.Mesh(new THREE.BoxGeometry(s.w-0.3,0.02,s.d-0.3), new THREE.MeshBasicMaterial({ color:0xff3b4d, transparent:true, opacity:0 }));
    luz2.position.set(s.x+s.w/2,0.02,s.z+s.d/2); g.add(luz2); info.aoVivo = luz2;
  }
}

// Estúdio: parede de tijolo ao fundo com quadros luminosos coloridos + bancada curva branca (set da Cazé TV)
function estudio(s, g){
  var cx = s.x + s.w/2;
  caixa(s.w-1.2, 3.2, 0.25, 0x8a4a3a, cx, 0, s.z+0.4, g);
  var cores = [0x2f6fed,0xf4e04d,0x7ed957,0xf4e04d,0x2f6fed,0x7ed957,0xeeeeee,0x2f6fed];
  for (var i=0;i<8;i++){ var col=i%4, lin=Math.floor(i/4); caixa(1.1,0.9,0.06, cores[i], s.x+2.4+col*((s.w-5)/3), 1.0+lin*1.15, s.z+0.58, g, { emissive:cores[i], emissiveIntensity:0.9 }); }
  var banc = new THREE.Mesh(new THREE.CylinderGeometry(2.6,2.6,0.95,32,1,false,Math.PI*0.15,Math.PI*0.7), mat(0xf1efe6,{ roughness:0.4 }));
  banc.position.set(cx, 0.48, s.z+s.d-3.2); banc.rotation.y = Math.PI*0.5+Math.PI*0.5; banc.castShadow = true; g.add(banc);
  for (var c=0;c<3;c++){ caixa(0.5,0.9,0.5,0x2b3350, cx-1.2+c*1.2, 0, s.z+s.d-5.0, g); }
  for (var k=0;k<2;k++){ caixa(0.35,1.5,0.35,0x39435e, s.x+1.5+k*(s.w-3), 0, s.z+s.d-1.2, g); }  // câmeras/tripés
}

var racksLeds = [];
function racks(s, g){
  // 14 racks numa sequência só, um depois do outro (R00 no fundo da sala, R13 perto da entrada)
  for (var i=0;i<14;i++){
    var x = s.x + s.w/2, z = s.z + 2.6 + (13 - i)*1.1;   // R00 no fundo (longe da porta), R13 perto da entrada
    var rack = new THREE.Group(); rack.position.set(x,0,z); g.add(rack);
    caixa(1.1,2.1,0.8,0x161d2e,0,0,0,rack);
    for (var u=0;u<7;u++){
      var led = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.06,0.06), new THREE.MeshBasicMaterial({ color:0x3ddc97 }));
      led.position.set(-0.56, 0.25+u*0.27, -0.28 + (u%2)*0.12); rack.add(led); racksLeds.push({ m:led, f:hashStr('r'+i+'u'+u) });
    }
    var t = etiqueta('R' + (i<10?'0':'') + i, '#8ee6c3', 0.42); t.position.set(0,2.35,0); rack.add(t);
  }
  caixa(0.9,1.1,0.5,0x39435e,s.x+s.w-0.8,0,s.z+s.d-0.6,g);   // ar condicionado
  var gerador = etiqueta('Gerador (em breve)', '#ffb020', 0.6); gerador.position.set(s.x+s.w+3.5, 1.6, s.z+s.d-3); cena.add(gerador);
  caixa(2.6,1.4,1.3,0x42506b,s.x+s.w+3.5,0,s.z+s.d-3,cena);
}

SALAS.forEach(construirSala);

// ── Estrutura elétrica (desenho esquemático da página "Estrutura elétrica 3D" do AutoPrev, do Alex) ──
// Só o desenho, sem leitura ao vivo: o estado de cada ligação é fixo (operação normal: Light com energia,
// disjuntor TIE aberto, gerador em espera, TIE dos nobreaks fechado). Fica numa camada à parte (botão Elétrica).
var ELE = { ox:-92, oz:-2 };
var grupoEle = new THREE.Group(); grupoEle.visible = false; cena.add(grupoEle);
// [id, rótulo, tipo, x, z, o que é]
var NOS = [
  ["light","LIGHT","fonte",0,4,"Concessionária: entrada de energia do prédio"],
  ["chent","Chave de entrada","chave",5,4,"Chave seccionadora de entrada"],
  ["mt","Média tensão","quadro",10,4,"Painel de média tensão"],
  ["chsec","Chave sec.","chave",15,4,"Chave seccionadora"],
  ["trafo","Transformador","trafo",20,4,"Transformador (média tensão para 220 V)"],
  ["pna","PNA","quadro",25,4,"Painel PNA"],
  ["qgbt1","QGBT1","quadro",30,4,"Quadro geral de baixa tensão 1 (onde a telemetria mede tensão, corrente e kW)"],
  ["qta","QTA","quadro",36,4,"Quadro de transferência do gerador"],
  ["gerador","Gerador","gerador",43,4,"Gerador (em espera; entra quando a Light cai)"],
  ["tie","Disjuntor TIE","tie",36,9,"Disjuntor de interligação (normalmente aberto)"],
  ["qdnrec","QDN-RECEPÇÃO","carga",6,18,"Quadro de distribuição: recepção"],
  ["qdncor","QDN-CORREDOR","carga",10.8,18,"Quadro de distribuição: corredor"],
  ["qdn2p","QDN-2P","carga",15.6,18,"Quadro de distribuição: 2º pavimento"],
  ["qdn3p","QDN-3P","carga",20.4,18,"Quadro de distribuição: 3º pavimento"],
  ["qdn4p","QDN-4P","carga",25.2,18,"Quadro de distribuição: 4º pavimento"],
  ["qdn5p","QDN-5P","carga",30,18,"Quadro de distribuição: 5º pavimento"],
  ["qfac3p","QFAC-3P","carga",34.8,18,"Quadro de ar-condicionado: 3º pavimento"],
  ["qfac4p","QFAC-4P","carga",39.6,18,"Quadro de ar-condicionado: 4º pavimento"],
  ["qfac5p","QFAC-5P","carga",44.4,18,"Quadro de ar-condicionado: 5º pavimento"],
  ["elev","ELEVADOR","carga",49.2,18,"Elevador"],
  ["resist","RESIST. CPD","carga",54,18,"Resistência do CPD"],
  ["qdnst1","QDN-STUDIO-01","carga",58.8,18,"Quadro de distribuição: Estúdio 1"],
  ["qgbt2","QGBT2","quadro",64,18,"Quadro geral de baixa tensão 2 (alimenta os nobreaks)"],
  ["nba","Nobreak A","nobreak",58,26,"Nobreak A (bateria; a telemetria mede carga e autonomia)"],
  ["nbb","Nobreak B","nobreak",70,26,"Nobreak B (bateria; a telemetria mede carga e autonomia)"],
  ["tienb","TIE NB-A/B","tie",64,26,"Interligação entre os nobreaks A e B (normalmente fechada)"],
  ["qfaccpd","QFAC-CPD","carga",4,38,"Quadro de ar-condicionado do CPD"],
  ["qfac1p","QFAC-1P","carga",8.8,38,"Quadro de ar-condicionado: 1º pavimento"],
  ["qfac2p","QFAC-2P","carga",13.6,38,"Quadro de ar-condicionado: 2º pavimento"],
  ["ilum1","ILUM. STUDIO-01","carga",18.4,38,"Iluminação cênica do Estúdio 1"],
  ["ilum2","ILUM. STUDIO-02","carga",23.2,38,"Iluminação cênica do Estúdio 2"],
  ["qdnea","QDNE-A","carga",28,38,"Quadro de distribuição essencial A"],
  ["qdneb","QDNE-B","carga",32.8,38,"Quadro de distribuição essencial B"],
  ["qdnec","QDNE-C","carga",37.6,38,"Quadro de distribuição essencial C"],
  ["qdne1","QDNE-EST-01","carga",42.4,38,"Quadro essencial do Estúdio 1"],
  ["qdne2","QDNE-EST-02","carga",47.2,38,"Quadro essencial do Estúdio 2"],
  ["qdne2p","QDNE-2P","carga",52,38,"Quadro essencial: 2º pavimento"],
  ["qdne3p","QDNE-3P","carga",56.8,38,"Quadro essencial: 3º pavimento"],
  ["qdne4p","QDNE-4P","carga",61.6,38,"Quadro essencial: 4º pavimento"],
  ["qdne5p","QDNE-5P","carga",66.4,38,"Quadro essencial: 5º pavimento"],
  ["livemode","LIVEMODE","carga",71.2,38,"Carga LiveMode (operação)"]
];
var nosPorId = {}; NOS.forEach(function(n){ nosPorId[n[0]] = { id:n[0], rot:n[1], tipo:n[2], x:n[3], z:n[4], desc:n[5], de:[], para:[] }; });
var BARRAS = { bar1:{ z:12, x1:6, x2:64 }, bar2:{ z:32, x1:4, x2:71.2 } };
// ligações: [de, para, estado]  estado: on = energizado | off = aberto | standby = em espera
var LIGACOES = [
  ['light','chent','on'],['chent','mt','on'],['mt','chsec','on'],['chsec','trafo','on'],['trafo','pna','on'],['pna','qgbt1','on'],
  ['qgbt1','qta','on'],['gerador','qta','standby'],['qta','tie','off'],
  ['qgbt2','nba','on'],['qgbt2','nbb','on'],['nba','tienb','on'],['tienb','nbb','on']
];
// ramais ligados a uma barra (o cabo sai do quadro e vai até a barra)
var RAMAIS = [['qgbt1','bar1','on'],['tie','bar1','off'],['qgbt2','bar1','on'],['nba','bar2','on'],['nbb','bar2','on']];
var IDS_BAR1 = ["qdnrec","qdncor","qdn2p","qdn3p","qdn4p","qdn5p","qfac3p","qfac4p","qfac5p","elev","resist","qdnst1"];
var IDS_BAR2 = ["qfaccpd","qfac1p","qfac2p","ilum1","ilum2","qdnea","qdneb","qdnec","qdne1","qdne2","qdne2p","qdne3p","qdne4p","qdne5p","livemode"];
IDS_BAR1.forEach(function(id){ RAMAIS.push([id,'bar1','on']); });
IDS_BAR2.forEach(function(id){ RAMAIS.push([id,'bar2','on']); });
var COR_LIGACAO = { on:0x4cc9f0, off:0x7b8499, standby:0xffb020 };
var COR_NO = { fonte:0xffb020, chave:0x8ea3c7, quadro:0x3b6fd4, trafo:0x7a5af8, gerador:0xf4802a, tie:0xe5c33d, nobreak:0x2fb67c, carga:0x2a9d8f };
var fluxos = [];   // pontinhos que andam pelos cabos energizados
function ew(x){ return ELE.ox + x; } function ez(z){ return ELE.oz + z; }
function cabo(pts, estado){
  var cor = COR_LIGACAO[estado] || 0x4cc9f0, tracejado = estado !== "on";
  for (var i=0;i<pts.length-1;i++){
    var a = pts[i], b = pts[i+1], dx = b[0]-a[0], dz = b[1]-a[1], comp = Math.sqrt(dx*dx+dz*dz); if (comp < 0.01) continue;
    var passo = tracejado ? 0.9 : comp, n = Math.max(1, Math.round(comp/passo));
    for (var k=0;k<n;k++){
      if (tracejado && k%2===1) continue;
      var t0 = k/n, t1 = tracejado ? (k+0.55)/n : (k+1)/n;
      var mx = a[0]+dx*(t0+t1)/2, mz = a[1]+dz*(t0+t1)/2, l = comp*(t1-t0);
      var m = new THREE.Mesh(new THREE.BoxGeometry(dx===0?0.16:l, 0.06, dz===0?0.16:l), new THREE.MeshBasicMaterial({ color:cor }));
      m.position.set(ew(mx), 0.04, ez(mz)); grupoEle.add(m);
    }
  }
  if (estado === "on") {   // energia correndo: um pontinho a cada ~5 m ao longo do caminho
    var total = 0, trechos = [];
    for (var j=0;j<pts.length-1;j++){ var d1 = Math.sqrt(Math.pow(pts[j+1][0]-pts[j][0],2)+Math.pow(pts[j+1][1]-pts[j][1],2)); trechos.push(d1); total += d1; }
    var qtd = Math.max(1, Math.round(total/5));
    for (var q=0;q<qtd;q++){ var bola = new THREE.Mesh(new THREE.SphereGeometry(0.2,10,8), new THREE.MeshBasicMaterial({ color:0xffffff })); grupoEle.add(bola); fluxos.push({ m:bola, pts:pts, trechos:trechos, total:total, off:q/qtd }); }
  }
}
function posNoFluxo(f, t){
  var d = ((t + f.off) % 1) * f.total;
  for (var i=0;i<f.trechos.length;i++){ if (d <= f.trechos[i] || i === f.trechos.length-1){ var u = f.trechos[i] ? Math.min(1, d/f.trechos[i]) : 0, a = f.pts[i], b = f.pts[i+1]; return [a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u]; } d -= f.trechos[i]; }
  return f.pts[0];
}
function caminhoEntre(a, b){   // reta se alinhados; senão sai na vertical, anda na horizontal e chega na vertical
  if (a.z === b.z || a.x === b.x) return [[a.x,a.z],[b.x,b.z]];
  var meio = (a.z + b.z) / 2; return [[a.x,a.z],[a.x,meio],[b.x,meio],[b.x,b.z]];
}
var alvosEle = [];
function construirEletrica(){
  LIGACOES.forEach(function(l){ var a = nosPorId[l[0]], b = nosPorId[l[1]]; a.para.push(b.rot); b.de.push(a.rot); cabo(caminhoEntre(a,b), l[2]); });
  RAMAIS.forEach(function(r){ var n = nosPorId[r[0]], bz = BARRAS[r[1]].z; cabo([[n.x,n.z],[n.x,bz]], r[2]); });
  Object.keys(BARRAS).forEach(function(k){ var b = BARRAS[k]; cabo([[b.x1,b.z],[b.x2,b.z]], "on"); });
  NOS.forEach(function(d){
    var n = nosPorId[d[0]], cor = COR_NO[n.tipo] || 0x3b6fd4;
    var w = n.tipo==="gerador" ? 4 : n.tipo==="nobreak" ? 3.6 : (n.tipo==="chave"||n.tipo==="tie") ? 1.6 : 3.2;
    var h = n.tipo==="gerador" ? 1.6 : n.tipo==="fonte" ? 2.2 : 1, pr = n.tipo==="gerador" ? 2.6 : 2;
    var cx = caixa(w, h, pr, cor, ew(n.x), 0, ez(n.z), grupoEle, { emissive:cor, emissiveIntensity:0.25 }); cx.userData.eletr = n.id; alvosEle.push(cx);
    var rot = etiqueta(n.rot, "#e8f1ff", 0.55); rot.position.set(ew(n.x), h + 0.9, ez(n.z)); grupoEle.add(rot);
  });
  var tit = etiqueta("Estrutura elétrica (esquema)", "#4cc9f0", 0.9); tit.position.set(ew(35), 3.2, ez(-3)); grupoEle.add(tit);
  var base = new THREE.Mesh(new THREE.PlaneGeometry(84, 50), new THREE.MeshBasicMaterial({ color:0x101a33, transparent:true, opacity:0.75 })); base.rotation.x = -Math.PI/2; base.position.set(ew(37), -0.02, ez(20)); grupoEle.add(base);
}
construirEletrica();
var modoEle = false;
function mostrarEletrica(on){ modoEle = on; grupoEle.visible = on; if (on) { alvoDest.set(ew(37), 0, ez(20)); distDest = 92; phiDest = 0.5; thetaDest = 0; painelEletrica(); } }
function painelEletrica(){
  var h = '<h2>Estrutura elétrica</h2><div class="vazio">Desenho esquemático da estrutura montada pelo Alex (AutoPrev). Por enquanto o estado das ligações é fixo, sem leitura ao vivo. Clique num quadro para ver o que é.</div>';
  h += '<h2>Legenda</h2><div class="ev"><b style="color:#4cc9f0">Ciano com pontinhos</b><small>Energizado, energia fluindo</small></div><div class="ev"><b style="color:#7b8499">Cinza tracejado</b><small>Aberto (Disjuntor TIE)</small></div><div class="ev"><b style="color:#ffb020">Laranja tracejado</b><small>Gerador em espera</small></div>';
  h += '<h2>Caminho da energia</h2><div class="vazio">Light, chave de entrada, média tensão, chave seccionadora, transformador, PNA e QGBT1. Dali segue para os quadros do prédio, para o QTA com o gerador e, pelo QGBT2, para os nobreaks A e B e os quadros do CPD.</div>';
  document.getElementById('painel').innerHTML = h;
}
function painelNo(id){
  var n = nosPorId[id]; if (!n) return painelEletrica();
  var h = '<button class="btn" id="voltarEle">← Estrutura elétrica</button><h2>' + esc(n.rot) + '</h2><div class="vazio">' + esc(n.desc) + '</div>';
  h += '<h2>Recebe de</h2>' + (n.de.length ? n.de.map(function(x){ return '<span class="pes">' + esc(x) + '</span>'; }).join('') : '<div class="vazio">Alimentado pelo barramento acima.</div>');
  h += '<h2>Alimenta</h2>' + (n.para.length ? n.para.map(function(x){ return '<span class="pes">' + esc(x) + '</span>'; }).join('') : '<div class="vazio">Carga final ou barramento abaixo.</div>');
  document.getElementById('painel').innerHTML = h;
  document.getElementById('voltarEle').onclick = painelEletrica;
}

// ── Pessoas ──
var atores = {};   // nome -> { grupo, sala, alvo, vel }
var CORES_PESSOA = [0xef476f,0xffd166,0x06d6a0,0x4cc9f0,0xb388eb,0xff9f1c,0x80ed99,0xf72585,0x90e0ef,0xe5989b];
function criarAtor(p){
  var grupo = new THREE.Group();
  var cor = CORES_PESSOA[hashStr(p.nome) % CORES_PESSOA.length];
  var corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.24,0.75,14), mat(cor,{ roughness:0.6 })); corpo.position.y = 0.45; corpo.castShadow = true; grupo.add(corpo);
  var cab = new THREE.Mesh(new THREE.SphereGeometry(0.19,16,12), mat(0xf1d3b3,{ roughness:0.7 })); cab.position.y = 1.0; cab.castShadow = true; grupo.add(cab);
  var primeiro = p.nome.split(' ')[0];
  var et = etiqueta(primeiro + (p.funcao ? ' · ' + p.funcao : ''), '#ffffff', 0.5); et.position.y = 1.45; grupo.add(et);
  cena.add(grupo);
  return grupo;
}
// Assento de cada posição: quem tem posto fixo senta na cadeira da sua bancada, de frente pro monitor.
// SW (controle): DTV, GC e VT nas 3 primeiras bancadas da fileira de cima; Áudio na cadeira da mesa de som, na cabine.
// PD: GC, VT, DTV nas bancadas; Playout: 1ª bancada; Shade (apoio): Op. Vídeo e Iluminador.
function assento(salaId, posto){
  var s = porId[salaId]; if (!s || !posto) return null;
  if (s.tipo === 'controle') {
    if (posto === 'audio') { var c = cabineAudio(s); return { x: s.x+s.w-2.5, z: c.z+c.d/2, rot: Math.PI/2 }; }
    var q = { dtv:0, gc:1, vt:2 }[posto]; if (q == null) return null;
    return { x: s.x+1.3+q*1.1+0.65, z: s.z+2.0, rot: -Math.PI/2 };
  }
  if (s.tipo === 'pd') { var k = { gc:0, vt:1, dtv:2 }[posto]; if (k == null) return null; return { x: s.x+2.6+k*3, z: s.z+s.d-0.25, rot: Math.PI }; }
  if (s.tipo === 'playout') { return posto === 'playout' ? { x: s.x+2.4, z: s.z+s.d/2+0.65, rot: Math.PI } : null; }
  if (s.tipo === 'apoio') { var j = { opVideo:0, ilum:1 }[posto]; if (j == null) return null; return { x: s.x+2.4+j*2.5, z: s.z+s.d/2+0.65, rot: Math.PI }; }
  return null;
}
function cabineAudio(s){ return { x: s.x + 0.3, z: s.z + s.d - 3.6, w: s.w - 0.6, d: 3.4 }; }   // sub-sala do sonoplasta, no fundo do SW
function pontoNaSala(salaId, seed, sub){
  var s = porId[salaId] || porId.central; var m = Math.min(0.8, s.w*0.3, s.d*0.3);
  if (sub === 'audio' && s.tipo === 'controle') { var c = cabineAudio(s); return { x: c.x + 0.6 + rnd(seed)*(c.w-1.2), z: c.z + 0.6 + rnd(seed+7)*(c.d-1.2) }; }
  return { x: s.x + m + rnd(seed)*(s.w-2*m), z: s.z + m + rnd(seed+7)*(s.d-2*m) };
}
function sincronizarPessoas(){
  var vivos = {};
  DADOS.pessoas.forEach(function(p, i){
    vivos[p.nome] = true;
    var a = atores[p.nome];
    if (!a || a.sala !== p.sala) {
      if (!a) { a = atores[p.nome] = { grupo:criarAtor(p), pos:null, alvo:null, espera:0 }; }
      a.sala = p.sala; a.sub = p.sub || ''; a.posto = p.posto || ''; a.fixo = assento(p.sala, a.posto);
      var pt = a.fixo || pontoNaSala(p.sala, hashStr(p.nome), a.sub); a.grupo.position.set(pt.x, 0, pt.z); a.alvo = pt; a.espera = 0;
      if (a.fixo) { a.grupo.rotation.y = a.fixo.rot; a.grupo.scale.set(1, 0.8, 1); } else { a.grupo.scale.set(1, 1, 1); }
    }
    a.dados = p;
  });
  Object.keys(atores).forEach(function(n){ if(!vivos[n]){ cena.remove(atores[n].grupo); delete atores[n]; } });
}
function animarPessoas(dt, t){
  Object.keys(atores).forEach(function(n, idx){
    var a = atores[n], g = a.grupo;
    if (a.fixo) { g.position.y = Math.sin(t*1.5+idx)*0.008; return; }   // sentado na bancada
    if (a.espera > 0) { a.espera -= dt; g.position.y = Math.abs(Math.sin(t*2+idx))*0.015; return; }
    var dx = a.alvo.x - g.position.x, dz = a.alvo.z - g.position.z, dist = Math.sqrt(dx*dx+dz*dz);
    if (dist < 0.08) { a.espera = 1.5 + Math.random()*4; a.alvo = pontoNaSala(a.sala, Math.floor(Math.random()*1e6), a.sub); return; }
    var v = 0.7*dt; g.position.x += dx/dist*v; g.position.z += dz/dist*v; g.rotation.y = Math.atan2(dx,dz);
    g.position.y = Math.abs(Math.sin(t*7+idx))*0.04;
  });
}

// ── Eventos no ar / chamados ──
var marcadoresChamado = {};
function sincronizarEstado(){
  var noAr = {};
  DADOS.eventos.forEach(function(e){ if (e.noAr) { if (e.sala) noAr[e.sala] = true; if (e.controle) noAr[e.controle] = true; } });
  (DADOS.salasAoVivo||[]).forEach(function(id){ noAr[id] = true; });
  var dest = {};   // sala -> "YouTube · Prime · Disney +3" do evento que está no ar nela
  DADOS.eventos.forEach(function(e){ if (e.noAr && e.sala && e.plataformas && e.plataformas.length && !dest[e.sala]) { dest[e.sala] = e.plataformas.slice(0,3).map(curtoPlat).join(' · ') + (e.plataformas.length>3 ? ' +' + (e.plataformas.length-3) : ''); } });   // salas com evento acontecendo agora (sistema de Operações)
  Object.keys(grupoSalas).forEach(function(id){
    var gi = grupoSalas[id];
    if (gi.aoVivo) { gi.aoVivo.userData.ligado = !!noAr[id]; }
    if (noAr[id] && !gi.placa) {
      var p = etiqueta('NO AR', '#ff4d5e', 0.7); p.position.set(gi.sala.x+gi.sala.w-1.6, ALTURA_PAREDE+0.35, gi.sala.z+0.45); gi.grupo.add(p); gi.placa = p;
    } else if (!noAr[id] && gi.placa) { gi.grupo.remove(gi.placa); gi.placa = null; }
    var tx = noAr[id] ? (dest[id] || '') : '';
    if (gi.destTexto !== tx) {
      if (gi.destSprite) { gi.grupo.remove(gi.destSprite); gi.destSprite = null; }
      gi.destTexto = tx;
      if (tx) { var dsp = etiqueta('→ ' + tx, '#9ad7ff', 0.5); dsp.position.set(gi.sala.x+gi.sala.w-5.2, ALTURA_PAREDE+1.0, gi.sala.z+0.45); gi.grupo.add(dsp); gi.destSprite = dsp; }
    }
  });
  Object.keys(marcadoresChamado).forEach(function(k){ cena.remove(marcadoresChamado[k]); }); marcadoresChamado = {};
  DADOS.chamados.forEach(function(c, i){
    var gi = c.sala ? grupoSalas[c.sala] : null; if(!gi) return;   // sem sala no cadastro do equipamento = sem marcador (só no painel)
    var cor = c.prioridade==='Alta' ? 0xff4d5e : c.prioridade==='Média' ? 0xffb020 : 0x4cc9f0;
    var m = new THREE.Mesh(new THREE.ConeGeometry(0.22,0.5,4), new THREE.MeshBasicMaterial({ color:cor }));
    m.rotation.x = Math.PI; m.position.set(gi.centro.x - gi.sala.w/2 + 1.5 + (i%6)*0.7, ALTURA_PAREDE+1.1, gi.centro.z); cena.add(m); marcadoresChamado['c'+i] = m;
  });
}

// ── Painel lateral ──
function painelGeral(){
  var ar = DADOS.eventos.filter(function(e){ return e.noAr; });
  var h = '<h2>Agora · ' + esc(DADOS.agora) + '</h2>';
  h += '<div class="res"><div><b>' + DADOS.pessoas.length + '</b><span>de plantão</span></div><div><b>' + ar.length + '</b><span>no ar</span></div><div><b>' + DADOS.chamados.length + '</b><span>chamados</span></div></div>';
  h += '<h2>Eventos de hoje</h2>';
  if (!DADOS.eventos.length) h += '<div class="vazio">Sem eventos hoje.</div>';
  DADOS.eventos.forEach(function(e){
    h += '<div class="ev' + (e.noAr?' ar':'') + '"><b>' + esc(e.nome) + '</b>' + (e.noAr?'<span class="tag">NO AR</span>':'') +
         '<small>' + esc(e.inicio) + (e.fim?'–'+esc(e.fim):'') + ' · ' + (e.sala ? esc(porId[e.sala].nome) + (e.controle ? ' · ' + esc(porId[e.controle].nome) : '') : esc(e.local||'sem sala no mapa')) + '</small>' + extraEvento(e) + '</div>';
  });
  h += '<h2>De plantão</h2>';
  if (!DADOS.pessoas.length) h += '<div class="vazio">Ninguém em turno agora.</div>';
  DADOS.pessoas.forEach(function(p){ h += '<span class="pes" title="' + esc(p.turno) + '">' + esc(p.nome.split(' ')[0]) + '</span>'; });
  if (DADOS.chamados.length) {
    h += '<h2>Chamados abertos</h2>';
    DADOS.chamados.forEach(function(c){ h += '<div class="cha ' + (c.prioridade==='Alta'?'':c.prioridade==='Média'?'m':'b') + '"><b>' + esc(c.id) + '</b> · ' + esc(c.equipamento) + '<br><small>' + esc(c.problema) + ' · ' + (c.sala?esc(porId[c.sala].nome):'sem local definido') + '</small></div>'; });
  }
  document.getElementById('painel').innerHTML = h;
}
function painelSala(id){
  var s = porId[id]; if(!s) return painelGeral();
  var evs = DADOS.eventos.filter(function(e){ return e.sala===id || e.controle===id; });
  var pes = DADOS.pessoas.filter(function(p){ return p.sala===id; });
  var chs = DADOS.chamados.filter(function(c){ return c.sala===id; });
  var h = '<button class="btn" id="voltar">← Visão geral</button><h2>' + esc(s.nome) + '</h2>';
  h += '<h2>Eventos</h2>'; if(!evs.length) h += '<div class="vazio">Nenhum evento nesta sala hoje.</div>';
  evs.forEach(function(e){ h += '<div class="ev' + (e.noAr?' ar':'') + '"><b>' + esc(e.nome) + '</b>' + (e.noAr?'<span class="tag">NO AR</span>':'') + '<small>' + esc(e.inicio) + (e.fim?'–'+esc(e.fim):'') + '</small>' + extraEvento(e) + '</div>'; });
  h += '<h2>Pessoas aqui</h2>'; if(!pes.length) h += '<div class="vazio">Ninguém.</div>';
  pes.forEach(function(p){ h += '<span class="pes" title="' + esc(p.evento||'') + '">' + esc(p.nome) + ' · ' + esc(p.funcao || p.turno) + '</span>'; });
  h += '<h2>Chamados</h2>'; if(!chs.length) h += '<div class="vazio">Nenhum chamado aberto.</div>';
  chs.forEach(function(c){ h += '<div class="cha ' + (c.prioridade==='Alta'?'':c.prioridade==='Média'?'m':'b') + '"><b>' + esc(c.id) + '</b> · ' + esc(c.equipamento) + '<br><small>' + esc(c.problema) + '</small></div>'; });
  document.getElementById('painel').innerHTML = h;
  document.getElementById('voltar').onclick = function(){ irPara(null); painelGeral(); };
}

// ── Câmera (orbit simples: arrastar = girar, Shift/botão direito = mover, roda/pinça = zoom) ──
var alvo = new THREE.Vector3(17, 0, 19), alvoDest = alvo.clone();
var theta = -0.45, phi = 0.72, dist = 58, distDest = dist, thetaDest = theta, phiDest = phi;
function irPara(id){
  if (!id) { alvoDest.set(17,0,19); distDest = 58; phiDest = 0.72; thetaDest = -0.45; return; }
  var g = grupoSalas[id]; if (!g) return;
  alvoDest.set(g.centro.x, 0, g.centro.z); distDest = Math.max(12, Math.max(g.sala.w, g.sala.d)*1.5); phiDest = 0.85;
}
function posCamera(){
  alvo.lerp(alvoDest, 0.12); dist += (distDest-dist)*0.12; theta += (thetaDest-theta)*0.2; phi += (phiDest-phi)*0.2;
  camera.position.set(alvo.x + dist*Math.sin(phi)*Math.sin(theta), alvo.y + dist*Math.cos(phi), alvo.z + dist*Math.sin(phi)*Math.cos(theta));
  camera.lookAt(alvo);
}
var arrasto = null, moveu = false;
function ptr(e){ return { x:e.clientX, y:e.clientY }; }
renderer.domElement.addEventListener('contextmenu', function(e){ e.preventDefault(); });
renderer.domElement.addEventListener('pointerdown', function(e){ arrasto = { x:e.clientX, y:e.clientY, pan:(e.button===2||e.shiftKey) }; moveu = false; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', function(e){
  if(!arrasto) return; var dx=e.clientX-arrasto.x, dy=e.clientY-arrasto.y; if(Math.abs(dx)+Math.abs(dy)>3) moveu = true;
  arrasto.x=e.clientX; arrasto.y=e.clientY;
  if (arrasto.pan) { var k=dist*0.0016; alvoDest.x -= (dx*Math.cos(theta) + dy*Math.sin(theta))*k; alvoDest.z -= (-dx*Math.sin(theta) + dy*Math.cos(theta))*k; }
  else { thetaDest -= dx*0.006; phiDest = Math.max(0.15, Math.min(1.45, phiDest - dy*0.006)); }
});
renderer.domElement.addEventListener('pointerup', function(e){ arrasto=null; if(!moveu) clicar(e); });
renderer.domElement.addEventListener('wheel', function(e){ e.preventDefault(); distDest = Math.max(6, Math.min(90, distDest*(1+e.deltaY*0.001))); }, { passive:false });
var toques = {};
renderer.domElement.addEventListener('touchstart', function(e){ if(e.touches.length===2){ var a=e.touches[0],b=e.touches[1]; toques.d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); } }, { passive:true });
renderer.domElement.addEventListener('touchmove', function(e){ if(e.touches.length===2){ var a=e.touches[0],b=e.touches[1]; var d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); if(toques.d){ distDest=Math.max(6,Math.min(90,distDest*(toques.d/d))); } toques.d=d; } }, { passive:true });

var ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function clicar(e){
  var r = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-r.left)/r.width)*2-1; mouse.y = -((e.clientY-r.top)/r.height)*2+1;
  ray.setFromCamera(mouse, camera);
  if (modoEle) { var hitE = ray.intersectObjects(alvosEle, false)[0]; if (hitE) { painelNo(hitE.object.userData.eletr); } return; }
  var hit = ray.intersectObjects(alvosClique, false)[0];
  if (hit && hit.object.userData.sala && hit.object.userData.sala!=='corredor') { irPara(hit.object.userData.sala); painelSala(hit.object.userData.sala); }
}
Array.prototype.forEach.call(document.querySelectorAll('[data-vai]'), function(b){ b.onclick = function(){ var v=b.getAttribute('data-vai'); if(v==='eletrica'){ mostrarEletrica(true); return; } mostrarEletrica(false); if(v==='geral'){ irPara(null); painelGeral(); } else { irPara(v); painelSala(v); } }; });

function redimensionar(){ var w=window.innerWidth,h=window.innerHeight; renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', redimensionar); redimensionar();

// ── Loop ──
var relogio = new THREE.Clock();
function laco(){
  var dt = Math.min(relogio.getDelta(), 0.1), t = relogio.elapsedTime;
  posCamera(); animarPessoas(dt, t);
  Object.keys(grupoSalas).forEach(function(id){ var gi = grupoSalas[id], m = gi.aoVivo; if(m){ m.material.opacity = m.userData.ligado ? 0.16 + 0.1*Math.sin(t*3) : 0; } if(gi.pgm){ gi.pgm.material.emissiveIntensity = (m && m.userData.ligado) ? 1.5 + 0.4*Math.sin(t*3) : 0.35; } });
  Object.keys(marcadoresChamado).forEach(function(k, i){ var m=marcadoresChamado[k]; m.rotation.y = t*2; m.position.y = ALTURA_PAREDE+1.1+Math.sin(t*3+i)*0.1; });
  if (modoEle) { fluxos.forEach(function(f){ var q = posNoFluxo(f, t*0.08); f.m.position.set(ew(q[0]), 0.18, ez(q[1])); }); }
  racksLeds.forEach(function(l){ var on = Math.sin(t*(1.5+(l.f%5)*0.4)+l.f) > -0.7; l.m.material.color.setHex(on?0x3ddc97:0x16573f); });
  renderer.render(cena, camera);
  requestAnimationFrame(laco);
}

function aplicar(d){ DADOS = d; document.getElementById('relogio').textContent = d.agora; sincronizarPessoas(); sincronizarEstado(); if (!modoEle) painelGeral(); }
function buscar(){
  if (DEMO) { aplicar(DEMO); return; }
  fetch('/api/mapa?dados=1', { credentials:'same-origin' }).then(function(r){ if(r.status===401){ location.href='/api/app'; return null; } return r.json(); })
    .then(function(d){ if(d && d.pessoas) aplicar(d); }).catch(function(){});
}
buscar(); if (!DEMO) setInterval(buscar, 60000);
var mn = document.getElementById('menu-btn'); if (mn) mn.onclick = function(ev){ ev.stopPropagation(); mn.parentNode.classList.toggle('aberto'); };
document.addEventListener('click', function(){ var m=document.querySelector('.menu'); if(m) m.classList.remove('aberto'); });
laco();
})();
`;

export function paginaMapa({ isGestor = false, demo = null } = {}) {
  const script = CLIENTE.replace('__SALAS__', JSON.stringify(SALAS)).replace('__DEMO__', demo ? JSON.stringify(demo) : 'null');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mapa 3D — Pulse</title><meta name="theme-color" content="#0b1020">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.json">
<style>${CSS}</style></head><body>
<div id="topo"><h1>Mapa 3D</h1><span class="sub">central ao vivo</span><span class="sp"></span><span class="relogio" id="relogio">--:--</span>
  <div class="menu"><button class="btn" id="menu-btn" aria-label="Menu">&#9776;</button><div class="lista">${menuItens(isGestor, { classe: '' })}</div></div></div>
<div id="cena"></div><div id="painel"></div><div id="dica">Arraste = girar · Shift/botão direito = mover · roda = zoom · clique numa sala</div>
<div id="atalhos"><button class="btn" data-vai="geral">Visão geral</button><button class="btn" data-vai="central">Central</button><button class="btn" data-vai="playout">Playout</button><button class="btn" data-vai="estudio1">Estúdio 1</button><button class="btn" data-vai="estudio2">Estúdio 2</button><button class="btn" data-vai="cpd">CPD</button><button class="btn" data-vai="eletrica">&#9889; Elétrica</button></div>
<div id="erro"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>${script}</script></body></html>`;
}

// ── Handler ─────────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.query.dados) return res.status(401).json({ error: 'Não autenticado' });
    return res.redirect(302, '/api/app');
  }
  if (req.query.dados) {
    try { return res.status(200).json(await montarDados()); }
    catch (e) { return res.status(500).json({ error: 'Falha ao montar o mapa' }); }
  }
  const equipe = await getSheet('Equipe!A2:L200');
  const isGestor = equipe.find(r => r[0] === session.nome)?.[8] === 'gestor';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(paginaMapa({ isGestor }));
}
