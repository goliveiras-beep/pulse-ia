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
import { sheetsRequest, invalidarCacheSheets } from '../google-auth.js';
import { menuItens } from '../menu.js';
import { PRONTOS as RECADOS_PRONTOS, MAX_TEXTO as MAX_RECADO } from './avisar-central.js';
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
  { id: 'central',  nome: 'Central',   tipo: 'central',  x: 8.8,  z: 0,    w: 7.4,  d: 12,   porta: 'W' },   // toda pra trás da linha da divisória (como o estúdio das PDs) e descendo atrás da Shade; na frente, o hall
  { id: 'shade',    nome: 'Shade',     tipo: 'apoio',    x: 2.2,  z: 8,    w: 6.6,  d: 4,    porta: 'W' },   // só a frente; o fundo é parede fechada com a Central
  { id: 'playout',  nome: 'Playout',   tipo: 'playout',  x: 2.2,  z: 12,   w: 6.6,  d: 3.5,  porta: 'W' },   // do tamanho da Shade
  { id: 'pd6b',     nome: 'Estúdio PD6', tipo: 'pdext',  x: 8.8,  z: 12,   w: 7.4,  d: 3.5,  liga: 'pd6', abertoS: [[0, 7.4]], semOeste: true },   // estúdio da PD6 crescendo pra trás do Playout
  { id: 'pd6',      nome: 'PD6',       tipo: 'pd',       x: 2.2,  z: 15.5, w: 14,   d: 3,    porta: 'W', abertoN: [[6.6, 14]] },   // o estúdio abre pra trás (pd6b)
  { id: 'pd5',      nome: 'PD5',       tipo: 'pd',       x: 2.2,  z: 18.5, w: 14,   d: 2.2,  porta: 'W' },
  { id: 'pd4',      nome: 'PD4',       tipo: 'pd',       x: 2.2,  z: 20.7, w: 14,   d: 1.8,  porta: 'W' },
  { id: 'pd3',      nome: 'PD3',       tipo: 'pd',       x: 2.2,  z: 22.5, w: 14,   d: 1.5,  porta: 'W' },
  { id: 'pd2',      nome: 'PD2',       tipo: 'pd',       x: 2.2,  z: 24,   w: 14,   d: 2,    porta: 'W' },
  { id: 'pd1',      nome: 'PD1',       tipo: 'pd',       x: 2.2,  z: 26,   w: 14,   d: 3.2,  porta: 'W' },
  { id: 'off2',     nome: 'OFF 2',     tipo: 'off',      x: 17.4, z: 24,   w: 4,    d: 2,    porta: 'W' },   // do outro lado do corredor do estúdio
  { id: 'off1',     nome: 'OFF 1',     tipo: 'off',      x: 17.4, z: 26,   w: 4,    d: 3.2,  porta: 'W' },
  { id: 'cpd',      nome: 'CPD',       tipo: 'cpd',      x: 0,    z: 33,   w: 5.5,  d: 19,   porta: 'N' },
  // Estúdios e controles (chute a partir dos nomes do Airtable: "Estúdio 1 (SWA)", "Estúdio 2 (SWB)"...) — ajustar.
  { id: 'corredor2', nome: 'Corredor', tipo: 'corredor', x: 16.2, z: 0,    w: 1.2,  d: 29.2 },   // desce até as OFFs (passa entre as PDs e as OFFs)
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

// ── Racks do CPD ──
// Vêm da aba MapaRacks da planilha. NÃO ficam no repositório (ele é público e os dados têm IPs da rede).
// Colunas: Rack | Ordem | Função do rack | Topo U | Base U | Categoria | Equipamento | Modelo | IP | Fora de U
export async function getRacks() {
  const v = await getSheet('MapaRacks!A2:J1000');
  const por = new Map();
  for (const r of v) {
    if (!r[0]) continue;
    if (!por.has(r[0])) por.set(r[0], { codigo: r[0], ordem: Number(r[1]) || 0, funcao: r[2] || '', itens: [], fora: [] });
    const rk = por.get(r[0]);
    if (String(r[9] || '').toLowerCase() === 'sim') { rk.fora.push({ nome: r[6] || '', ip: r[8] || '' }); continue; }
    const t = Number(r[3]), b = Number(r[4]);
    if (t >= b && b >= 1 && t <= 60) rk.itens.push({ t, b, cat: r[5] || 'pas', nome: r[6] || '', modelo: r[7] || '', ip: r[8] || '' });
  }
  const lista = [...por.values()].sort((a, b) => a.ordem - b.ordem);
  lista.forEach(rk => rk.itens.sort((a, b) => b.t - a.t));
  return lista;
}
// Só o desenho (U e categoria), sem nomes nem IPs — vai embutido na página.
export function racksLayout(racks) { return (racks || []).map(r => ({ c: r.codigo, o: r.ordem, f: r.funcao, i: r.itens.map(i => [i.t, i.b, i.cat]) })); }
// Detalhes, entregues sob demanda; o IP só sai pra gestor.
export function racksDetalhes(racks, gestor) {
  return (racks || []).map(r => ({
    codigo: r.codigo, funcao: r.funcao,
    itens: r.itens.map(i => ({ t: i.t, b: i.b, nome: i.nome, modelo: i.modelo, ip: gestor ? i.ip : '' })),
    fora: r.fora.map(i => ({ nome: i.nome, ip: gestor ? i.ip : '' })),
  }));
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

// ── Avatares: cada pessoa escolhe o próprio boneco no mapa ──────────────────────────────────
// Aba MapaAvatares: A = nome (igual ao da Equipe), B = JSON da escolha, C = quando mudou. Criada na 1ª gravação.
// Só valores desta lista são aceitos (o JSON vai pro navegador de todo mundo, então nada de texto livre).
export const AVATAR_OPC = {
  pele: ['#f1d3b3', '#e3b98f', '#c99266', '#9a6440', '#6b4128', '#4a2c1a'],
  roupa: ['#ef476f', '#ffd166', '#06d6a0', '#4cc9f0', '#b388eb', '#ff9f1c', '#1d3557', '#2b2d42', '#f1faee', '#e63946'],
  cabelo: ['careca', 'curto', 'medio', 'longo', 'coque', 'moicano'],
  corCabelo: ['#1b1b1b', '#4a2c1a', '#8a5a2b', '#d9b26a', '#b0b0b0', '#c0392b', '#3a86ff'],
  acessorio: ['nenhum', 'fone', 'bone', 'oculos'],
};
export function validarAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  const v = {};
  for (const k of Object.keys(AVATAR_OPC)) { if (!AVATAR_OPC[k].includes(a[k])) return null; v[k] = a[k]; }
  return v;
}
async function getAvatares() {
  const linhas = await getSheet('MapaAvatares!A2:B500');
  const m = new Map();
  for (const r of linhas) { try { const v = validarAvatar(JSON.parse(r[1] || '')); if (r[0] && v) m.set(norm(r[0]), v); } catch { /* linha estragada: ignora */ } }
  return m;
}
async function salvarAvatar(nome, avatar) {
  const SHEET = process.env.GOOGLE_SHEET_ID;
  let linhas;
  try { linhas = (await sheetsRequest(SHEET, `/values/${encodeURIComponent('MapaAvatares!A1:A500')}`)).values || []; }
  catch {   // aba ainda não existe: cria com cabeçalho
    await sheetsRequest(SHEET, ':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: 'MapaAvatares' } } }] });
    linhas = [];
  }
  if (!linhas.length) {
    await sheetsRequest(SHEET, `/values/${encodeURIComponent('MapaAvatares!A1:C1')}?valueInputOption=RAW`, 'PUT', { values: [['Nome', 'Avatar (JSON)', 'Atualizado']] });
    linhas = [['Nome']];
  }
  let idx = linhas.findIndex((r, i) => i > 0 && norm(r[0]) === norm(nome));
  if (idx < 0) { idx = linhas.length; if (idx >= 500) throw new Error('aba MapaAvatares cheia'); }
  const n = idx + 1;
  await sheetsRequest(SHEET, `/values/${encodeURIComponent(`MapaAvatares!A${n}:C${n}`)}?valueInputOption=RAW`, 'PUT',
    { values: [[nome, JSON.stringify(avatar), new Date().toISOString()]] });
  await invalidarCacheSheets();
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

// ID do vídeo (pra TV do mapa): watch?v=ID, youtu.be/ID, /live/ID, /embed/ID. Link de canal (/@canal/live) não tem ID → sem TV.
export function idYoutube(u) {
  try {
    const x = new URL(linkYoutube(u));
    let id = x.hostname.toLowerCase() === 'youtu.be' ? x.pathname.split('/')[1] : x.searchParams.get('v');
    if (!id) { const p = x.pathname.split('/').filter(Boolean); const i = p.findIndex(t => ['live', 'embed', 'shorts'].includes(t)); id = i >= 0 ? p[i + 1] : ''; }
    return /^[A-Za-z0-9_-]{6,20}$/.test(id || '') ? id : '';
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
  eventos.forEach(e => { e.youtubeId = idYoutube(e.youtube); });

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
.sp{flex:1}.clima{color:var(--mut);font-size:12px;white-space:nowrap}@media (max-width:700px){.clima{display:none}}.relogio{font:600 15px ui-monospace,Consolas,monospace;color:var(--acc)}
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
.btn-mostrar{display:none;background:#7a5af8;border-color:#a48bff;color:#fff;font-weight:700}body.passeio .btn-mostrar{display:inline-block}
#olha{position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:25;background:#141b30f2;border:1px solid var(--acc);border-radius:12px;padding:8px 10px 8px 14px;display:flex;gap:8px;align-items:center;font-size:13px;box-shadow:0 10px 30px #0009;max-width:calc(100vw - 32px)}
#olha[hidden]{display:none}
.btn-passear{background:#1d6f5a;border-color:#3ddc97;color:#fff;font-weight:700}
#joy{display:none;position:fixed;left:18px;bottom:64px;width:120px;height:120px;border-radius:50%;background:#141b30aa;border:2px solid var(--line);z-index:16;touch-action:none}
#joy-pino{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:var(--acc);opacity:.85;pointer-events:none}
body.passeio #joy{display:block}
#fechar-painel{display:none;position:fixed;right:14px;z-index:17}
@media (max-width:700px){body.passeio #painel{display:none}body.passeio.com-painel #painel{display:block}body.passeio.com-painel #fechar-painel{display:block;bottom:calc(56px + 42vh - 40px)}body.passeio #joy{bottom:118px;width:110px;height:110px}body.passeio #joy-pino{left:30px;top:30px}}
.vazio{color:var(--mut);font-size:12.5px}
.plats{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}.dest{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--mut);margin-right:2px}
.plat{display:inline-block;font-size:10.5px;padding:1px 8px;border-radius:10px;background:#26324f;color:#cfe0ff}
.yt{display:inline-block;margin-top:7px;font-size:12px;color:#ff7b7b;text-decoration:none;font-weight:600}.yt:hover{text-decoration:underline}
.av-previa{position:relative;height:170px;background:radial-gradient(#26324f,#141b30);border-radius:12px;margin:8px 0 4px;overflow:hidden;contain:paint}.av-previa canvas{display:block}
.av-opc{display:flex;flex-wrap:wrap;gap:6px}
.av-cor{width:30px;height:30px;border-radius:50%;border:2px solid var(--line);cursor:pointer;padding:0}
.av-txt{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:16px;padding:5px 11px;font:inherit;font-size:12px;cursor:pointer}
.av-cor.sel,.av-txt.sel{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc)}
.av-acoes{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.av-salvar{background:var(--acc);color:#06121f;border-color:var(--acc);font-weight:700}
.btn-falar{background:#e5233a;border-color:#e5233a;color:#fff;font-weight:700}.btn-falar:hover{border-color:#fff}
.falar-texto{width:100%;min-height:90px;resize:vertical;margin:10px 0 8px;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;font-size:14px}
@media (max-width:700px){.btn-falar .rot{display:none}}
#cena-tv{position:fixed;inset:0;pointer-events:none;z-index:5}
.tv3d{width:640px;height:360px;background:#000;border:14px solid #11151f;border-radius:18px;box-shadow:0 0 0 3px #ff2d45,0 20px 60px #000c;position:relative;pointer-events:none}
.tv3d iframe{width:100%;height:100%;border:0;display:block}
.tv3d-selo{position:absolute;left:12px;top:10px;background:#e5233a;color:#fff;font:800 22px system-ui,sans-serif;padding:4px 12px;border-radius:8px}
.tv3d-capa{position:absolute;inset:0;display:block;pointer-events:auto;cursor:pointer;background:#000}
.tv3d-capa img{width:100%;height:100%;object-fit:cover;display:block;opacity:.75}
.tv3d-ver{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#e5233a;color:#fff;font:800 30px system-ui,sans-serif;padding:14px 26px;border-radius:14px;box-shadow:0 8px 30px #000a;white-space:nowrap}
.tv3d-som{position:absolute;right:12px;bottom:12px;pointer-events:auto;background:#0b1020e6;color:#fff;border:2px solid #fff;border-radius:10px;font:700 22px system-ui,sans-serif;padding:6px 14px;cursor:pointer}
#erro{position:fixed;inset:0;display:none;place-items:center;text-align:center;padding:30px;z-index:30;background:var(--bg)}
@media (max-width:700px){#painel{top:auto;height:42vh;left:8px;right:8px;width:auto;bottom:56px}#atalhos{bottom:8px}#dica{display:none}}
`;

// JS do navegador. ATENÇÃO: fica dentro de um template literal do servidor — nada de crases nem de
// "${" aqui dentro (use concatenação com +).
const CLIENTE = String.raw`
(function(){
var SALAS = __SALAS__;
var DEMO = __DEMO__;
var RACKS_LAYOUT = __RACKS__;   // [{ c:'R00', o:0, f:'função', i:[[topoU, baseU, categoria], ...] }] — só o desenho, sem nomes/IPs
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
var css3 = THREE.CSS3DRenderer ? new THREE.CSS3DRenderer() : null;   // TVs com vídeo (se o script não carregar, o mapa segue sem TV)
if (css3) { css3.domElement.id = 'cena-tv'; document.body.appendChild(css3.domElement); }

var hemi = new THREE.HemisphereLight(0xcfe3ff, 0x202840, 0.85); cena.add(hemi);
var sol = new THREE.DirectionalLight(0xffffff, 0.75);
sol.position.set(-20, 40, 10); sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.left=-40; sol.shadow.camera.right=40; sol.shadow.camera.top=50; sol.shadow.camera.bottom=-20; sol.shadow.camera.far=120;
cena.add(sol);

var chao = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({ color:0x0f162b, roughness:1 }));
chao.rotation.x = -Math.PI/2; chao.position.set(10,-0.06,20); chao.receiveShadow = true; cena.add(chao);

// ── Entorno: Botafogo (Rio) — a Livemode fica em Botafogo ──
// Paisagem estilizada (fora de escala, pra caber no quadro): enseada e praia de Botafogo a leste, Pão de Açúcar e Urca a
// sudeste (com o bondinho), Corcovado com o Cristo a oeste (o sol se põe atrás dele), Aterro do Flamengo e Marina ao norte,
// Santos Dumont a nordeste (pista no aterro, avião decolando) e o bairro em volta.
// O céu segue a HORA de Brasília (madrugada, amanhecer, dia, tarde, pôr do sol, noite) e o TEMPO real de Botafogo
// (open-meteo, já liberado no CSP): nuvens, chuva, neblina, tempestade; a temperatura puxa o horizonte pro quente ou pro frio.
// Pra testar/mostrar um momento: ?hora=18.5&tempo=sol|nublado|chuva|tempestade|neblina&temp=31
var RIO = new THREE.Group(); cena.add(RIO);
var PARAM = {}; location.search.replace('?', '').split('&').forEach(function(p){ var kv = p.split('='); if (kv[0]) PARAM[kv[0]] = decodeURIComponent(kv[1] || ''); });
function rioMat(cor, extra){ return mat(cor, extra); }
function torre(x, z, w, d, h, cor){ var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), predioMat(cor)); m.position.set(x, h/2 - 0.1, z); RIO.add(m); return m; }
// janelas: uma textura compartilhada; à noite o emissivo sobe e a cidade acende
var texJanelas = (function(){ var c = document.createElement('canvas'); c.width = 64; c.height = 64; var k = c.getContext('2d');
  k.fillStyle = '#ffffff'; k.fillRect(0,0,64,64);
  for (var i=0;i<6;i++) for (var j=0;j<6;j++){ k.fillStyle = Math.random() < 0.5 ? '#ffd27a' : '#3a4150'; k.fillRect(3+i*10, 3+j*10, 6, 6); }
  var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
var MATS_PREDIO = [];
function predioMat(cor){ var m = new THREE.MeshStandardMaterial({ color:cor, map:texJanelas, emissive:0xffc66a, emissiveMap:texJanelas, emissiveIntensity:0, roughness:0.85 }); MATS_PREDIO.push(m); return m; }
function morro(x, z, perfil, cor, rochaCor){
  var pts = perfil.map(function(p){ return new THREE.Vector2(p[0], p[1]); }).reverse();   // de baixo pra cima: normais pra fora
  var m = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), rioMat(cor, { roughness:1, flatShading:true }));
  m.position.set(x, -0.2, z); RIO.add(m);
  if (rochaCor) { var topo = pts.filter(function(p){ return p.y > perfil[0][1]*0.4; });
    var r = new THREE.Mesh(new THREE.LatheGeometry(topo, 28), rioMat(rochaCor, { roughness:0.9, flatShading:true })); r.position.set(x, -0.15, z); r.scale.set(1.01, 1, 1.01); RIO.add(r); }
  return m;
}
function palmeira(x, z){ var t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 7, 6), rioMat(0x7a5a3c)); t.position.set(x, 3.4, z); RIO.add(t);
  for (var i=0;i<5;i++){ var f = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 0.9), rioMat(0x2f7d4a)); f.position.set(x, 7, z); f.rotation.y = i*1.25; f.rotation.z = -0.35; RIO.add(f); } }

// chão do bairro (oeste da orla) e água da baía / enseada
var agua = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color:0x1d4f78, roughness:0.25, metalness:0.35 }));
agua.rotation.x = -Math.PI/2; agua.position.set(300, -0.35, 0); RIO.add(agua);
chao.geometry = new THREE.PlaneGeometry(1000, 2400); chao.position.set(-430, -0.06, 0);   // terra só até a orla (x 70)
var areia = new THREE.Mesh(new THREE.RingGeometry(104, 118, 48, 1, Math.PI*0.62, Math.PI*0.78), rioMat(0xe8d6a8, { roughness:1 }));
areia.rotation.x = -Math.PI/2; areia.position.set(180, -0.12, 30); RIO.add(areia);   // praia de Botafogo em arco
var terraOrla = new THREE.Mesh(new THREE.RingGeometry(118, 150, 48, 1, Math.PI*0.62, Math.PI*0.78), rioMat(0x4a4f57, { roughness:1 }));
terraOrla.rotation.x = -Math.PI/2; terraOrla.position.set(180, -0.1, 30); RIO.add(terraOrla);
var avenida = new THREE.Mesh(new THREE.RingGeometry(120, 128, 48, 1, Math.PI*0.62, Math.PI*0.78), rioMat(0x26292e, { roughness:0.9 }));
avenida.rotation.x = -Math.PI/2; avenida.position.set(180, -0.08, 30); RIO.add(avenida);   // Av. Praia de Botafogo
// Aterro do Flamengo (verde com palmeiras) e Marina da Glória, ao norte
var aterro = new THREE.Mesh(new THREE.BoxGeometry(70, 0.3, 260), rioMat(0x3f7a45, { roughness:1 })); aterro.position.set(95, -0.15, -190); aterro.rotation.y = -0.18; RIO.add(aterro);
for (var pa = 0; pa < 18; pa++) palmeira(78 + (pa%3)*16 - pa*1.2, -90 - pa*14);
for (var bm = 0; bm < 14; bm++) { var b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 5), rioMat(0xf4f6f8)); b.position.set(140 + (bm%4)*4, 0.2, -250 - Math.floor(bm/4)*8); RIO.add(b); }
// Santos Dumont (aterro com pista na baía) a nordeste
var sdu = new THREE.Mesh(new THREE.BoxGeometry(90, 0.6, 210), rioMat(0x56606b, { roughness:1 })); sdu.position.set(190, -0.1, -430); RIO.add(sdu);
var pista = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 190), rioMat(0x2b2e33)); pista.position.set(180, 0.15, -430); RIO.add(pista);
for (var fx = 0; fx < 18; fx++) { var tr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 5), new THREE.MeshBasicMaterial({ color:0xf2f2f2 })); tr.position.set(180, 0.2, -515 + fx*10); RIO.add(tr); }
torre(212, -410, 18, 40, 9, 0xd7dbe2); var etSdu = etiqueta('Aeroporto Santos Dumont', '#e8edf8', 1.6); etSdu.position.set(200, 22, -430); RIO.add(etSdu);
var aviao = new THREE.Group(); RIO.add(aviao);
(function(){ var f = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 22, 12), rioMat(0xf4f6f8, { metalness:0.3 })); f.rotation.x = Math.PI/2; aviao.add(f);
  var asa = new THREE.Mesh(new THREE.BoxGeometry(24, 0.4, 4), rioMat(0xdfe4ea)); aviao.add(asa);
  var cauda = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 3.5), rioMat(0xe5233a)); cauda.position.set(0, 2.5, 9.5); aviao.add(cauda);
  var est = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 2.5), rioMat(0xdfe4ea)); est.position.set(0, 0.5, 9.5); aviao.add(est); })();
// Pão de Açúcar + Urca (a sudeste, depois da enseada), com o bondinho
var pao = morro(265, 150, [[0,72],[8,70],[15,63],[20,50],[24,32],[27,14],[34,0]], 0x4f8a55, 0xa59c8f);
var urca = morro(212, 112, [[0,34],[10,32],[18,24],[25,10],[30,0]], 0x4f8a55, 0x9d968a);
var caboBondinho = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 4), new THREE.MeshBasicMaterial({ color:0x222222 }));
(function(){ var a = new THREE.Vector3(212, 33.5, 112), b2 = new THREE.Vector3(265, 71.5, 150), meio = a.clone().add(b2).multiplyScalar(0.5);
  caboBondinho.scale.y = a.distanceTo(b2); caboBondinho.position.copy(meio); caboBondinho.lookAt(b2); caboBondinho.rotateX(Math.PI/2); RIO.add(caboBondinho); })();
var bondinho = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), rioMat(0xe5233a, { emissive:0x400000, emissiveIntensity:0.3 })); RIO.add(bondinho);
var etPao = etiqueta('Pão de Açúcar', '#e8edf8', 1.6); etPao.position.set(265, 84, 150); RIO.add(etPao);
// Corcovado + Cristo (a oeste) e morros do bairro
morro(-230, 170, [[0,108],[5,106],[12,94],[22,72],[38,42],[58,16],[76,0]], 0x3f7a48, 0x7b857c);
morro(-110, 70, [[0,42],[16,38],[30,22],[44,0]], 0x467f4d);           // Dona Marta
morro(-60, 230, [[0,48],[18,42],[34,24],[50,0]], 0x467f4d);           // São João
morro(150, 230, [[0,40],[14,36],[28,20],[42,0]], 0x467f4d);           // Babilônia
var cristo = new THREE.Group(); cristo.position.set(-230, 107.5, 170); RIO.add(cristo);
var matCristo = rioMat(0xe9eef3, { emissive:0xfff2d0, emissiveIntensity:0 });
(function(){ var base = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), rioMat(0xb9bec6)); base.position.y = 1.5; cristo.add(base);
  var corpo = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.6, 9, 8), matCristo); corpo.position.y = 7.5; cristo.add(corpo);
  var bracos = new THREE.Mesh(new THREE.BoxGeometry(11, 1.1, 1.1), matCristo); bracos.position.y = 10.6; cristo.add(bracos);
  var cab = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), matCristo); cab.position.y = 12.6; cristo.add(cab); })();
cristo.rotation.y = -0.6;   // de braços abertos pra baía
var etCristo = etiqueta('Cristo Redentor', '#e8edf8', 1.6); etCristo.position.set(-230, 128, 170); RIO.add(etCristo);
var etBot = etiqueta('Praia de Botafogo', '#e8edf8', 1.3); etBot.position.set(78, 6, 30); RIO.add(etBot);
var etAterro = etiqueta('Aterro do Flamengo', '#e8edf8', 1.3); etAterro.position.set(95, 8, -170); RIO.add(etAterro);
// bairro: prédios baixos em volta (fora do terreno da Livemode e longe dos morros)
(function(){ var s = 11; function r(){ s = (s*9301 + 49297) % 233280; return s/233280; }
  var cores = [0xc9c3b8, 0xb8bfc9, 0xd8d2c4, 0x9aa3ae, 0xe2ddd2];
  for (var n = 0; n < 150; n++) {
    var x = -260 + r()*320, z = -260 + r()*520;
    if (x > -40 && x < 60 && z > -40 && z < 92) continue;            // terreno da Livemode + folga (prédios longe da central)
    if (x > 40) continue;                                            // orla/água
    if (Math.hypot(x+230, z-170) < 80 || Math.hypot(x+110, z-70) < 46 || Math.hypot(x+60, z-230) < 52) continue;
    var w = 10 + r()*14, d = 10 + r()*14, h = 6 + r()*(Math.hypot(x, z) < 90 ? 22 : 40);
    torre(x, z, w, d, h, cores[n % cores.length]);
  }
})();
// barcos na enseada
var barcos = [];
for (var bo = 0; bo < 9; bo++) { var bb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 5), rioMat(0xf4f6f8)); var an = 2.2 + bo*0.17; bb.position.set(180 + Math.cos(an)*70, 0.1, 30 + Math.sin(an)*70*1.1); bb.rotation.y = bo; RIO.add(bb); barcos.push(bb); }

// ── Céu ──
var ceuCanvas = document.createElement('canvas'); ceuCanvas.width = 4; ceuCanvas.height = 256;
var ceuTex = new THREE.CanvasTexture(ceuCanvas);
var ceu = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.MeshBasicMaterial({ map:ceuTex, side:THREE.BackSide, fog:false, depthWrite:false }));
cena.add(ceu); camera.far = 4000; camera.updateProjectionMatrix();
var estrelas = (function(){ var g = new THREE.BufferGeometry(), p = [];
  for (var i=0;i<700;i++){ var th = Math.random()*Math.PI*2, ph = Math.random()*Math.PI*0.45, R = 1400; p.push(R*Math.sin(ph)*Math.cos(th), R*Math.cos(ph), R*Math.sin(ph)*Math.sin(th)); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  var m = new THREE.Points(g, new THREE.PointsMaterial({ color:0xffffff, size:3, sizeAttenuation:false, transparent:true, opacity:0, fog:false })); cena.add(m); return m; })();
var lua = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), new THREE.MeshBasicMaterial({ color:0xf3f1e6, fog:false, transparent:true })); cena.add(lua);
var discoSol = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 12), new THREE.MeshBasicMaterial({ color:0xfff1c1, fog:false, transparent:true })); cena.add(discoSol);
sol.target.position.set(18, 0, 25); cena.add(sol.target); sol.shadow.camera.far = 900;
// nuvens e chuva
var nuvens = (function(){ var c = document.createElement('canvas'); c.width = c.height = 128; var k = c.getContext('2d');
  var g = k.createRadialGradient(64,64,6,64,64,62); g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(1,'rgba(255,255,255,0)'); k.fillStyle = g; k.fillRect(0,0,128,128);
  var t = new THREE.CanvasTexture(c), lista = [];
  for (var i=0;i<46;i++){ var s = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, opacity:0, depthWrite:false, fog:false }));
    s.position.set(-500 + Math.random()*1100, 160 + Math.random()*90, -600 + Math.random()*1100); var k2 = 120 + Math.random()*160; s.scale.set(k2*1.8, k2*0.7, 1); cena.add(s); lista.push(s); }
  return lista; })();
var chuva = (function(){ var g = new THREE.BufferGeometry(), p = [];
  for (var i=0;i<3500;i++) p.push(-120 + Math.random()*300, Math.random()*160, -120 + Math.random()*300);
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  var m = new THREE.Points(g, new THREE.PointsMaterial({ color:0xaebfd6, size:0.35, transparent:true, opacity:0.75 })); m.visible = false; cena.add(m); return m; })();

// paleta do céu por hora: [hora, topo, horizonte, sol, ambiente]
var CEU = [[0,'#03060f','#121a33',0,0.42],[4.8,'#050a1c','#1d2645',0,0.42],[5.6,'#2a2f5e','#ff8f6b',0.25,0.55],[6.6,'#4c79c7','#ffd2a1',0.6,0.7],
  [8,'#3a86e0','#cfe9ff',0.9,0.85],[15.5,'#3f8ae0','#d8efff',0.9,0.85],[17,'#4a73b8','#ffd08a',0.75,0.8],[18,'#3a3a78','#ff7a45',0.4,0.65],
  [18.8,'#1c1d4a','#c2475a',0.1,0.5],[19.6,'#070b1d','#232c52',0,0.42],[24,'#03060f','#121a33',0,0.42]];
function hex(c){ return new THREE.Color(c); }
function mistura(a, b, t){ return a.clone().lerp(b, t); }
var TEMPO = { codigo:0, temp:null, nome:'', carregado:false };
function horaBRT(){
  if (PARAM.hora) return +PARAM.hora;
  var p = new Date().toLocaleString('en-GB', { timeZone:'America/Sao_Paulo', hour12:false }).split(' ')[1].split(':');
  return (+p[0]) + (+p[1])/60;
}
function tipoTempo(){
  var t = PARAM.tempo; if (t) return t;
  var c = TEMPO.codigo;
  if (c >= 95) return 'tempestade'; if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'chuva';
  if (c === 45 || c === 48) return 'neblina'; if (c >= 2) return 'nublado'; return 'sol';
}
var NOMES_TEMPO = { sol:'Céu limpo', nublado:'Nublado', chuva:'Chuva', tempestade:'Tempestade', neblina:'Neblina' };
function atualizarCeu(){
  var h = horaBRT(), i = 0; while (i < CEU.length - 2 && CEU[i+1][0] <= h) i++;
  var a = CEU[i], b = CEU[i+1], t = (h - a[0]) / Math.max(0.001, b[0] - a[0]);
  var topo = mistura(hex(a[1]), hex(b[1]), t), hor = mistura(hex(a[2]), hex(b[2]), t), forcaSol = a[3] + (b[3]-a[3])*t, amb = a[4] + (b[4]-a[4])*t;
  var tp = tipoTempo(), cinza = { sol:0, nublado:0.45, chuva:0.7, tempestade:0.85, neblina:0.6 }[tp] || 0;
  var lum = 0.25 + forcaSol*0.75, cinzaCor = new THREE.Color(0.55*lum, 0.58*lum, 0.62*lum);
  topo.lerp(cinzaCor, cinza); hor.lerp(cinzaCor, cinza*0.85);
  var temp = PARAM.temp ? +PARAM.temp : TEMPO.temp;
  if (temp != null) { if (temp >= 28) hor.lerp(hex('#ffb36b'), Math.min(0.3, (temp-28)/25)); else if (temp <= 20) hor.lerp(hex('#9cc8ff'), Math.min(0.3, (20-temp)/25)); }
  var k = ceuCanvas.getContext('2d'), g = k.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + topo.getHexString()); g.addColorStop(0.55, '#' + mistura(topo, hor, 0.6).getHexString()); g.addColorStop(1, '#' + hor.getHexString());
  k.fillStyle = g; k.fillRect(0, 0, 4, 256); ceuTex.needsUpdate = true;
  cena.background = hor.clone();
  var neb = tp === 'neblina'; cena.fog.color.copy(hor); cena.fog.near = neb ? 40 : 260; cena.fog.far = neb ? 260 : 1600;
  // sol: nasce sobre a baía (leste) e se põe atrás do Corcovado (oeste)
  var ang = Math.max(-0.3, Math.min(Math.PI + 0.3, (h - 6) / 12.5 * Math.PI));
  var sx = Math.cos(ang) * 900, sy = Math.sin(ang) * 700, sz = 120;
  sol.position.set(18 + sx*0.12, Math.max(8, sy*0.12), 25 + sz*0.12);
  discoSol.position.set(18 + sx, sy, 25 + sz); discoSol.visible = sy > -40 && cinza < 0.7;
  discoSol.material.color.copy(mistura(hex('#ff9a4a'), hex('#fff6d6'), Math.min(1, Math.max(0, sy/400))));
  sol.intensity = forcaSol * (1 - cinza*0.6); sol.color.copy(mistura(hex('#ffb37a'), hex('#ffffff'), Math.min(1, Math.max(0, sy/350))));
  hemi.intensity = amb * (1 - cinza*0.2); hemi.color.copy(mistura(hex('#8fa6d6'), hex('#cfe3ff'), forcaSol));
  var noite = 1 - Math.min(1, forcaSol / 0.35);
  estrelas.material.opacity = noite * (1 - cinza); lua.visible = noite > 0.3; lua.position.set(18 - sx*0.9, Math.max(250, -sy), -300);
  MATS_PREDIO.forEach(function(m){ m.emissiveIntensity = 0.03 + noite*0.42; });
  matCristo.emissiveIntensity = noite * 0.9;
  agua.material.color.copy(mistura(hex('#0b1a33'), hex('#1f6a9a'), forcaSol)).lerp(hex('#55606b'), cinza*0.5);
  chao.material.color.copy(mistura(hex('#141a24'), hex('#4a515b'), forcaSol));
  nuvens.forEach(function(s){ s.material.opacity = cinza > 0 ? 0.35 + cinza*0.55 : 0.08; s.material.color.copy(mistura(hex('#2a2f3a'), hex('#ffffff'), lum)).lerp(hex('#8a9099'), cinza*0.6); });
  chuva.visible = tp === 'chuva' || tp === 'tempestade';
  CHUVA_FORTE = tp === 'tempestade';
  var cl = document.getElementById('clima');
  if (cl) { var hh = Math.floor(h), mm = Math.round((h - hh)*60); cl.textContent = 'Botafogo · ' + (temp != null ? Math.round(temp) + '°C · ' : '') + (NOMES_TEMPO[tp] || ''); }
}
var CHUVA_FORTE = false, relampago = 0;
function animarRio(dt, t){
  // avião: taxia, decola pra baía e some; recomeça a cada ~70 s
  var c = (t % 70) / 70, z = -515 + c*600, y = c < 0.25 ? 1.8 : 1.8 + Math.pow((c-0.25)*5, 2)*14;
  aviao.position.set(180, y, z); aviao.rotation.x = c < 0.25 ? 0 : -0.18; aviao.visible = c < 0.9;
  var cb = (Math.sin(t*0.12) + 1) / 2; bondinho.position.set(212 + (265-212)*cb, 33.5 + (71.5-33.5)*cb - 1.6, 112 + (150-112)*cb);
  barcos.forEach(function(b, i){ b.position.y = 0.1 + Math.sin(t*1.3 + i)*0.15; });
  nuvens.forEach(function(s, i){ s.position.x += dt*(2 + i%3); if (s.position.x > 650) s.position.x = -550; });
  if (chuva.visible) { var p = chuva.geometry.attributes.position, v = CHUVA_FORTE ? 110 : 70;
    chuva.position.set(alvo.x - 30, 0, alvo.z - 30);
    for (var i = 1; i < p.array.length; i += 3) { p.array[i] -= v*dt; if (p.array[i] < 0) p.array[i] += 160; } p.needsUpdate = true;
    if (CHUVA_FORTE && Math.random() < dt*0.25) relampago = 0.18; }
  if (relampago > 0) { relampago -= dt; hemi.intensity = 2.6; if (relampago <= 0) atualizarCeu(); }
}
function buscarTempo(){
  fetch('https://api.open-meteo.com/v1/forecast?latitude=-22.951&longitude=-43.183&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')
    .then(function(r){ return r.json(); }).then(function(d){ if (d && d.current) { TEMPO.codigo = d.current.weathercode; TEMPO.temp = d.current.temperature_2m; TEMPO.carregado = true; atualizarCeu(); } }).catch(function(){});
}
atualizarCeu(); buscarTempo(); setInterval(atualizarCeu, 60000); setInterval(buscarTempo, 10*60000);


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

var CORES_CHAO = { pdext:0x24324f, corredor:0x2a3350, central:0x1d3557, apoio:0x2b3a55, playout:0x23405c, pd:0x24324f, off:0x3a3350, cpd:0x15242f, estudio:0x1f3a34, controle:0x2a2f4a, ext:0x2d2f36, audio:0x2f2a4a };
var COM_LUZ_AO_VIVO = { pd:1, pdext:1, estudio:1, controle:1, ext:1 };
var grupoSalas = {};   // id -> { piso, centro:{x,z}, aoVivo:Mesh, alerta:Mesh }
var alvosClique = [];

var PAREDES = [];   // retângulos das paredes (centro + meia largura/profundidade) pra colisão no modo Passear
var MUROS = [];     // meshes das paredes: no passeio sobem pro pé-direito real (PE_DIREITO)
function parede(g, x1,z1,x2,z2, vaos){
  var dx = x2-x1, dz = z2-z1, comp = Math.sqrt(dx*dx+dz*dz), esp = 0.14;
  var segs = [[0,comp]];
  (vaos||[]).forEach(function(v){ // v = [inicio, fim] ao longo da parede
    var novo=[]; segs.forEach(function(s){ if(v[1]<=s[0]||v[0]>=s[1]){ novo.push(s); } else { if(v[0]>s[0]) novo.push([s[0],v[0]]); if(v[1]<s[1]) novo.push([v[1],s[1]]); } }); segs = novo;
  });
  segs.forEach(function(s){
    var l = s[1]-s[0], t = (s[0]+s[1])/2/comp;
    var cx = x1+dx*t, cz = z1+dz*t;
    var m = caixa(dx===0?esp:l, ALTURA_PAREDE, dz===0?esp:l, 0xd3d7de, cx, 0, cz, g, { roughness:0.9 }); MUROS.push(m);
    PAREDES.push({ x:cx, z:cz, hw:(dx===0?esp:l)/2, hd:(dz===0?esp:l)/2 });
  });
}

function matPorcelanato(w, d){
  var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d');
  x.fillStyle = '#a99f8b'; x.fillRect(0,0,128,128); x.strokeStyle = '#8e8572'; x.lineWidth = 3; x.strokeRect(0,0,128,128);
  var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w/0.8, d/0.8);
  return new THREE.MeshStandardMaterial({ map:t, roughness:0.75, metalness:0.02 });
}
// Hall: a Central é a única sala recuada (desenho); na frente dela o corredor alarga até a parede.
// Gera só piso (tipo corredor), sem paredes; o clique em corredor não abre painel.
SALAS.filter(function(s){ return s.porta === 'W' && s.x > 2.2 && s.x < 16; }).forEach(function(s){
  var dh = s.d; SALAS.forEach(function(o){ if (o !== s && o.tipo !== 'corredor' && o.x < s.x && o.x + o.w > 2.2 && o.z >= s.z && o.z < s.z + dh) dh = o.z - s.z; });
  var h = { id:'hall-' + s.id, nome:'Corredor', tipo:'corredor', x:2.2, z:s.z, w:s.x - 2.2, d:dh, hall:true }; SALAS.push(h); porId[h.id] = h;
});
// posição da porta na parede oeste (distância a partir do canto norte da sala). A Central só encosta no hall
// nos primeiros 8 m (o resto da parede é a Shade); a porta fica colada onde a parede da Shade termina.
function portaZ(s){ return s.id === 'central' ? 7.25 : s.d/2; }
var ROTULOS_SALA = [];   // nomes flutuando sobre as salas (somem no passeio — lá tem a plaquinha na porta)
function construirSala(s){
  var g = new THREE.Group(); cena.add(g);
  var cx = s.x + s.w/2, cz = s.z + s.d/2;
  var piso = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.1, s.d), s.tipo === 'corredor' ? matPorcelanato(s.w, s.d) : mat(CORES_CHAO[s.tipo]||0x24324f, { roughness:0.95 }));
  piso.position.set(cx, -0.05, cz); piso.receiveShadow = true; piso.userData.sala = s.liga || s.id; g.add(piso); alvosClique.push(piso);
  var info = { piso:piso, centro:{x:cx,z:cz}, grupo:g, aoVivo:null, alerta:null, sala:s };
  if (s.tipo !== 'corredor' && s.tipo !== 'ext') {
    var pz = portaZ(s), vW = s.porta==='W' ? [[pz-0.65, pz+0.65]] : [];
    var vN = s.porta==='N' ? [[1.0, 2.4]] : [];
    if (!s.semOeste) parede(g, s.x, s.z, s.x, s.z+s.d, vW);                 // oeste
    parede(g, s.x+s.w, s.z, s.x+s.w, s.z+s.d, []);         // leste
    parede(g, s.x, s.z, s.x+s.w, s.z, vN.concat(s.abertoN || []));                 // norte
    parede(g, s.x, s.z+s.d, s.x+s.w, s.z+s.d, s.abertoS || []);         // sul
    var rot = etiqueta(s.nome, '#e8edf8', (s.tipo==='pd' || s.tipo==='controle' || s.tipo==='audio') ? 0.8 : 1);
    rot.position.set(s.tipo==='cpd'?cx:s.x+1.8+(s.nome.length*0.15), ALTURA_PAREDE+0.35, s.tipo==='cpd'?s.z+0.8:s.z+0.45); g.add(rot); ROTULOS_SALA.push(rot);
  } else if (s.id === 'corredor') {
    parede(g, s.x, s.z, s.x, s.z+s.d, []);                 // parede externa do corredor principal
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
// Monitor de multiviewer: tela com 4 quadros (fonte + "PGM"); a borda do quadro fica vermelha quando aquela sala está no ar.
var FONTES_MV = [['PD1','pd1'],['PD2','pd2'],['PD3','pd3'],['PD4','pd4'],['PD5','pd5'],['PD6','pd6'],['PLAYOUT 1','playout'],['PLAYOUT 2','playout'],
  ['PLAYOUT 3','playout'],['PLAYOUT 4','playout'],['SWA','swa'],['SWB','swb'],['ESTÚDIO 1','estudio1'],['ESTÚDIO 2','estudio2'],['EXT','ext'],['OFF 1','off1'],['OFF 2','off2']];
var MULTIVIEWS = [], contMV = 0;
function desenharMV(mv, noAr){
  var c = mv.ctx, W = 512, H = 288;
  c.fillStyle = '#05070c'; c.fillRect(0,0,W,H);
  mv.fontes.forEach(function(f, i){
    var x = (i%2)*W/2, y = Math.floor(i/2)*H/2, w = W/2, h = H/2, hs = hashStr(f[0]);
    var g = c.createLinearGradient(x, y, x+w, y+h); g.addColorStop(0, 'hsl(' + (hs%360) + ',55%,32%)'); g.addColorStop(1, 'hsl(' + ((hs*7)%360) + ',60%,14%)');
    c.fillStyle = g; c.fillRect(x+3, y+3, w-6, h-6);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x+20+(hs%60), y+30+(hs%30), 60+(hs%50), 40);   // "imagem"
    c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(x+3, y+h-30, w-6, 27);
    c.fillStyle = '#fff'; c.font = '600 17px system-ui,sans-serif'; c.textBaseline = 'middle'; c.fillText(f[0] + ' PGM', x+10, y+h-16);
    var ar = noAr && noAr[f[1]];
    c.strokeStyle = ar ? '#ff2d45' : '#2a3142'; c.lineWidth = ar ? 6 : 3; c.strokeRect(x+3, y+3, w-6, h-6);
    if (ar) { c.fillStyle = '#ff2d45'; c.fillRect(x+w-58, y+8, 50, 20); c.fillStyle = '#fff'; c.font = '800 13px system-ui,sans-serif'; c.fillText('AO AR', x+w-53, y+18); }
  });
  mv.tex.needsUpdate = true;
}
function telaMV(g, w, h, x, y, z, rotY){
  var cv = document.createElement('canvas'); cv.width = 512; cv.height = 288;
  var fontes = []; for (var i=0;i<4;i++){ fontes.push(FONTES_MV[(contMV + i) % FONTES_MV.length]); } contMV += 4;
  var tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
  var mv = { ctx: cv.getContext('2d'), tex: tex, fontes: fontes }; desenharMV(mv, null); MULTIVIEWS.push(mv);
  var tela = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  tela.position.set(x, y, z); tela.rotation.y = rotY || 0; g.add(tela);
  var moldura = new THREE.Mesh(new THREE.BoxGeometry(w+0.05, h+0.05, 0.04), mat(0x0b0d12, { roughness:0.5 }));
  moldura.position.set(x, y, z); moldura.rotation.y = rotY || 0; moldura.translateZ(-0.025); g.add(moldura);
  return tela;
}
var chaveMV = '';
function atualizarMultiviews(noAr){ var k = Object.keys(noAr).sort().join(','); if (k === chaveMV) return; chaveMV = k; MULTIVIEWS.forEach(function(mv){ desenharMV(mv, noAr); }); }
// Paredão em C da Central (entrando pela porta, que fica a oeste): parede do fundo (leste), lateral direita (sul) e a própria
// parede da porta, dos dois lados dela. A lateral esquerda (norte) é um quadro negro, não tem tela.
function paredaoC(s, g){
  var tw = 1.25, th = 0.7, folga = 0.08, linhas = [1.05, 1.8];
  function fileira(x1, z1, x2, z2, rotY){
    var comp = Math.hypot(x2-x1, z2-z1), n = Math.max(1, Math.floor(comp / (tw + folga)));
    for (var i=0;i<n;i++){ var t = (i + 0.5) / n, x = x1 + (x2-x1)*t, z = z1 + (z2-z1)*t;
      linhas.forEach(function(y){ telaMV(g, tw, th, x, y + th/2, z, rotY); }); }
  }
  var x0 = s.x, z0 = s.z, x1 = s.x + s.w, z1 = s.z + s.d, e = 0.12, pz = s.z + portaZ(s);
  // norte: quadro negro com moldura de alumínio
  caixa(s.w - 1.2, 1.2, 0.04, 0x1f2a24, s.x + s.w/2, 0.85, z0 + 0.09, g, { roughness:0.95 });
  caixa(s.w - 1.1, 0.05, 0.08, 0xa7adb6, s.x + s.w/2, 0.8, z0 + 0.12, g); caixa(s.w - 1.1, 0.05, 0.06, 0xa7adb6, s.x + s.w/2, 2.05, z0 + 0.11, g);
  fileira(x1 - e, z0 + 0.5, x1 - e, z1 - 1.0, -Math.PI/2);        // leste (fundo)
  fileira(x1 - 1.0, z1 - e, x0 + 1.0, z1 - e, Math.PI);           // sul (lateral direita)
  // parede da porta: só 2 colunas, no trecho entre a porta e o canto sul (o lado do hall fica sem TV)
  var zs = z1 - 1.0, zp2 = pz + 0.75, col = 1.25 + 0.08, zc = (zs + zp2) / 2;
  [zc - col/2, zc + col/2].forEach(function(z){ linhas.forEach(function(y){ telaMV(g, tw, th, x0 + e, y + th/2, z, Math.PI/2); }); });
  // cantos: onde duas paredes de TV se encontram, uma coluna na diagonal cortando o canto (não em L)
  [[x1 - 0.42, z1 - 0.42, -3*Math.PI/4], [x0 + 0.42, z1 - 0.42, 3*Math.PI/4]].forEach(function(c){
    linhas.forEach(function(y){ telaMV(g, 1.0, th, c[0], y + th/2, c[1], c[2]); });
  });
}
function mesaDupla(g, x, z, cor){   // posição de operação com 2 monitores independentes
  var gr = mesaComMonitor(g, x, z, 0, cor);
  caixa(0.55,0.33,0.04,0x0a0f1c,0.32,0.95,-0.2,gr,{ emissive:cor, emissiveIntensity:0.9 }); gr.children[3].position.x = -0.3;
  return gr;
}
function cameraTripe(g, x, z, rotY){
  var gr = new THREE.Group(); gr.position.set(x, 0, z); gr.rotation.y = rotY; g.add(gr);
  [0, 2.1, 4.2].forEach(function(a){ var p = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.02,1.25,6), mat(0x22262e)); p.position.set(Math.cos(a)*0.22, 0.6, Math.sin(a)*0.22); p.rotation.z = Math.cos(a)*0.18; p.rotation.x = -Math.sin(a)*0.18; gr.add(p); });
  caixa(0.22,0.2,0.4,0x1a1d24,0,1.2,0,gr);
  var lente = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.08,0.22,14), mat(0x0c0d10, { metalness:0.5, roughness:0.3 })); lente.rotation.x = Math.PI/2; lente.position.set(0, 1.3, -0.3); gr.add(lente);
  caixa(0.03,0.03,0.03,0xff2d45,0.08,1.42,-0.12,gr,{ emissive:0xff2d45, emissiveIntensity:1 });   // tally
  return gr;
}
// PD: 3 mesas juntas (GC, VT, DTV) de frente pro PV/PGM; divisória com porta; no fundo o estúdio de narração
// (uma mesa só pros narradores, câmera no tripé e painel de LED atrás).
var PD_DIVISORIA = 6.6;
function pdMontar(s, g, info){
  var x0 = s.x, z0 = s.z, d = s.d, zm = z0 + d - 0.9;
  caixa(4.2,0.06,0.7,0x8a93a8, x0+3.1, 0.72, zm, g);
  [x0+1.05, x0+3.1, x0+5.15].forEach(function(x){ caixa(0.06,0.72,0.6,0x59627a, x, 0, zm, g); });
  [0,1,2].forEach(function(k){ var x = x0+1.7+k*1.4;
    caixa(0.55,0.33,0.04,0x0a0f1c, x, 0.95, zm-0.22, g, { emissive:0xe0a02a, emissiveIntensity:0.9 });
    caixa(0.42,0.46,0.4,0x2b3350, x, 0, zm+0.65, g); });
  caixa(1.2,0.7,0.08,0x0a0f1c, x0+2.4, 1.2, z0+0.14, g,{ emissive:0x1f9d55, emissiveIntensity:0.8 });
  info.pgm = caixa(1.2,0.7,0.08,0x0a0f1c, x0+3.8, 1.2, z0+0.14, g,{ emissive:0xd9433f, emissiveIntensity:0.35 });
  var tPv = etiqueta('PV', '#7ee0a5', 0.32); tPv.position.set(x0+2.4, 2.05, z0+0.25); g.add(tPv);
  var tPg = etiqueta('PGM', '#ff8a8a', 0.32); tPg.position.set(x0+3.8, 2.05, z0+0.25); g.add(tPg);
  var xd = x0 + PD_DIVISORIA, porta = Math.min(0.9, d - 0.4);
  parede(g, xd, z0, xd, z0 + d, [[d/2 - porta/2, d/2 + porta/2]]);
  var xe = xd + (s.w - PD_DIVISORIA) * 0.62, zc = z0 + d/2;
  caixa(Math.min(1.8, d - 0.3) > 0.9 ? 0.7 : 0.6, 0.06, Math.min(1.8, d - 0.3), 0x6b5a46, xe, 0.72, zc, g);   // mesa de narração (uma só)
  caixa(0.06,0.72,Math.min(1.6, d - 0.5),0x4a3d30, xe+0.25, 0, zc, g);
  [-1, 1].forEach(function(sg){ var zz = zc + sg * Math.min(0.45, d/4);
    caixa(0.42,0.46,0.4,0x2b3350, xe+0.65, 0, zz, g);
    var mic = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.22,8), mat(0x111111)); mic.position.set(xe-0.1, 0.9, zz); g.add(mic); });
  caixa(0.06, 1.0, Math.min(2.4, d - 0.2), 0x05070d, s.x + s.w - 0.1, 0.6, zc, g, { emissive:0x7a5af8, emissiveIntensity:0.6 });   // painel de LED atrás
  cameraTripe(g, xd + 1.1, zc, Math.PI/2 + Math.PI);   // câmera olhando pra mesa
  var rot = etiqueta('Estúdio ' + s.nome, '#c3b5ff', 0.36); rot.position.set(xe, 1.75, zc); g.add(rot);
}
var ASSENTOS_CENTRAL = [];   // cadeiras da bancada em L da Central (quem está de plantão senta nelas, na ordem)
function mobiliar(s, g, info){
  var x0=s.x, z0=s.z;
  if (s.tipo==='central') {
    paredaoC(s, g);   // multiviewer em C com todos os PGMs (PDs, playout, SWs, estúdios)
    // bancada em L: começa no fundo (parede leste) e vira pra direita (parede sul), de frente pro paredão
    ASSENTOS_CENTRAL = [];
    var xL = x0 + s.w - 1.05, zL = z0 + s.d - 1.05, passo = 1.65;
    for (var zi = z0 + 1.2; zi <= zL - 0.9; zi += passo) {   // trecho do fundo: olhando pro leste
      mesaComMonitor(g, xL, zi, -Math.PI/2, 0x2a6fdb); ASSENTOS_CENTRAL.push({ x: xL - 0.6, z: zi, rot: Math.PI/2 });
    }
    mesaComMonitor(g, xL, zL, -3*Math.PI/4, 0xd9433f); ASSENTOS_CENTRAL.push({ x: xL - 0.45, z: zL - 0.45, rot: Math.PI/4 });   // canto do L
    for (var xi = xL - passo; xi >= x0 + 1.4; xi -= passo) {  // trecho da direita: olhando pro sul
      mesaComMonitor(g, xi, zL, Math.PI, 0xd9433f); ASSENTOS_CENTRAL.push({ x: xi, z: zL - 0.6, rot: 0 });
    }
  } else if (s.tipo==='apoio') {
    // Shade: 3 TVs de 53" com multiviewer na parede da frente
    [-1.3, 0, 1.3].forEach(function(dx){ telaMV(g, 1.17, 0.66, x0+s.w/2+dx, 1.45, z0+0.1, 0); });
    for (var j=0;j<3;j++){ mesaComMonitor(g, x0+1.5+j*2.0, z0+s.d/2, 0, 0x2aa87a); }
  } else if (s.tipo==='playout') {
    // Playout: 4 posições de operação com monitores independentes + 3 TVs de multiviewer na parede da frente
    [-1.3, 0, 1.3].forEach(function(dx){ telaMV(g, 1.17, 0.66, x0+s.w/2+dx, 1.45, z0+0.1, 0); });
    for (var j2=0;j2<4;j2++){ mesaDupla(g, x0+1.0+j2*1.55, z0+s.d/2, 0x2aa87a); }
  } else if (s.tipo==='pd') {
    pdMontar(s, g, info);
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
var alvosRack = [];
var CORES_CAT = { pas:0x3a4256, aud:0x7a5af8, rx:0x1fa8a0, vid:0x2f6fed, srv:0xe58a2a, net:0x2fb67c, ws:0xe0b030, sync:0xe35d8a };
var UNIDADE = 0.047;   // altura de 1U (42U = ~2 m)
function racks(s, g){
  // Uma sequência só (R00 no fundo da sala, R13 perto da entrada). Com os dados reais, cada rack mostra os
  // equipamentos nos seus Us, coloridos por categoria; sem dados (aba ainda não carregada) cai nos 14 racks genéricos.
  var lista = (RACKS_LAYOUT && RACKS_LAYOUT.length) ? RACKS_LAYOUT : null;
  var n = lista ? lista.length : 14;
  for (var k=0;k<n;k++){
    var def = lista ? lista[k] : { c:'R' + (k<10?'0':'') + k, o:k, f:'', i:[] };
    var x = s.x + s.w/2, z = s.z + 2.6 + (13 - def.o)*1.1;
    // rotation PI: a frente dos equipamentos (e os LEDs) fica pro lado leste — como é na sala de verdade (Guilherme, 2026-11-09)
    var rack = new THREE.Group(); rack.position.set(x,0,z); rack.rotation.y = Math.PI; g.add(rack);
    var corpo = caixa(1.1,2.1,0.8,0x161d2e,0,0,0,rack); corpo.userData.rack = def.c; alvosRack.push(corpo);
    if (lista) {
      def.i.forEach(function(it, ix){
        var alt = (it[0]-it[1]+1)*UNIDADE, y = 0.05 + (it[1]-1)*UNIDADE, cor = CORES_CAT[it[2]] || 0x3a4256;
        var peca = caixa(0.1, Math.max(0.03, alt-0.012), 0.7, cor, -0.57, y, 0, rack, it[2]==='pas' ? { roughness:0.9 } : { emissive:cor, emissiveIntensity:0.18 });
        peca.userData.rack = def.c; alvosRack.push(peca);
        if (it[2] !== 'pas') { var led = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.03,0.04), new THREE.MeshBasicMaterial({ color:0x3ddc97 })); led.position.set(-0.64, y + alt/2, 0.26 - (ix%3)*0.07); rack.add(led); racksLeds.push({ m:led, f:hashStr(def.c + 'u' + ix) }); }
      });
    } else {
      for (var u=0;u<7;u++){
        var led2 = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.06,0.06), new THREE.MeshBasicMaterial({ color:0x3ddc97 }));
        led2.position.set(-0.56, 0.25+u*0.27, -0.28 + (u%2)*0.12); rack.add(led2); racksLeds.push({ m:led2, f:hashStr('r'+k+'u'+u) });
      }
    }
    var t = etiqueta(def.c, '#8ee6c3', 0.42); t.position.set(0,2.35,0); rack.add(t);
  }
  caixa(0.9,1.1,0.5,0x39435e,s.x+s.w-0.8,0,s.z+s.d-0.6,g);   // ar condicionado
  var gerador = etiqueta('Gerador (em breve)', '#ffb020', 0.6); gerador.position.set(s.x+s.w+3.5, 1.6, s.z+s.d-3); cena.add(gerador);
  caixa(2.6,1.4,1.3,0x42506b,s.x+s.w+3.5,0,s.z+s.d-3,cena);
}

SALAS.forEach(construirSala);

// ── Cara de empresa (do vídeo do corredor): só aparece no modo Passear ──
// Pé-direito real, teto escuro com spots em linha e eletrocalha, portas cinza com visor e maçaneta preta,
// plaquinha "PD 5 ●" com luz de status ao lado da porta (verde; vermelha quando a sala está no ar),
// janelas escuras pras salas grandes, extintores e ar-condicionado.
var PE_DIREITO = 2.7;
var grupoPasseio = new THREE.Group(); grupoPasseio.visible = false; cena.add(grupoPasseio);
var plaquetas = {};   // sala -> { mat, nome, noAr }
function texPlaqueta(nome, noAr){
  var c = document.createElement('canvas'); c.width = 256; c.height = 96; var x = c.getContext('2d');
  x.fillStyle = '#eef0f3'; x.fillRect(0,0,256,96); x.strokeStyle = '#c4c8cf'; x.lineWidth = 4; x.strokeRect(2,2,252,92);
  x.fillStyle = '#3b3f47'; x.font = '600 44px system-ui,Segoe UI,sans-serif'; x.textBaseline = 'middle'; x.fillText(nome, 18, 50);
  x.fillStyle = noAr ? '#ff2d45' : '#3ddc97'; x.beginPath(); x.arc(224, 48, 17, 0, Math.PI*2); x.fill();
  var t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
}
function mudarPlaqueta(id, noAr){ var p = plaquetas[id]; if (!p || p.noAr === noAr) return; p.noAr = noAr; p.mat.map = texPlaqueta(p.nome, noAr); p.mat.needsUpdate = true; }
function porta(px, pz, eixoZ, largura){
  // eixoZ: vão ao longo de z (parede oeste) → folha abre pra dentro (+x); senão vão ao longo de x (parede norte) → abre pra +z
  var gp = new THREE.Group(); gp.position.set(px, 0, pz); if (!eixoZ) gp.rotation.y = -Math.PI/2; grupoPasseio.add(gp);
  var folha = new THREE.Group(); folha.position.set(0.12, 0, 0); gp.add(folha);
  caixa(largura-0.06, 2.1, 0.045, 0xc6cad1, (largura-0.06)/2, 0, 0.03, folha, { roughness:0.6 });
  caixa(0.3, 0.32, 0.05, 0x0d1626, (largura-0.06)*0.6, 1.35, 0.03, folha, { roughness:0.1, metalness:0.3, emissive:0x1b3a66, emissiveIntensity:0.25 });   // visor
  caixa(0.14, 0.03, 0.07, 0x111111, largura-0.2, 1.0, 0.03, folha);   // maçaneta
  folha.rotation.y = Math.PI/2 + 0.12;   // aberta, encostada na parede
  caixa(0.06, 2.16, 0.18, 0xb8bdc6, 0, 0, 0, gp); caixa(0.06, 2.16, 0.18, 0xb8bdc6, 0, 0, largura, gp);   // batentes
  caixa(0.06, 0.06, largura+0.06, 0xb8bdc6, 0, 2.13, largura/2, gp);
}
SALAS.forEach(function(s){
  if (s.tipo === 'corredor' || s.tipo === 'ext' || !s.porta) return;
  if (s.porta === 'W') {
    var z0 = s.z + portaZ(s) - 0.65;
    porta(s.x, z0, true, 1.3);
    var mp = new THREE.MeshBasicMaterial({ map: texPlaqueta(s.nome, false) });
    var pl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), mp); pl.rotation.y = -Math.PI/2;
    var zp = s.z + portaZ(s) + 0.95; if (zp > s.z + s.d - 0.2 || s.id === 'central') zp = s.z + portaZ(s) - 0.95;
    pl.position.set(s.x - 0.08, 1.55, zp); grupoPasseio.add(pl); plaquetas[s.id] = { mat:mp, nome:s.nome, noAr:false };
    if (s.d >= 6) {   // janela escura pra dentro da sala (como as das salas de controle no vídeo)
      var jw = Math.min(2.2, s.d/2 - 1.6), jz = s.z + 0.8 + jw/2;
      caixa(0.03, 1.0, jw, 0x05080f, s.x - 0.085, 1.0, jz, grupoPasseio, { roughness:0.05, metalness:0.6, emissive:0x223a6a, emissiveIntensity:0.35 });
      caixa(0.05, 0.05, jw+0.1, 0x9aa1ab, s.x - 0.09, 0.97, jz, grupoPasseio); caixa(0.05, 0.05, jw+0.1, 0x9aa1ab, s.x - 0.09, 2.0, jz, grupoPasseio);
    }
  } else if (s.porta === 'N') {
    porta(s.x + 2.4, s.z, false, 1.4);
    var mp2 = new THREE.MeshBasicMaterial({ map: texPlaqueta(s.nome, false) });
    var pl2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), mp2); pl2.rotation.y = Math.PI;
    pl2.position.set(s.x + 3.0, 1.55, s.z - 0.08); grupoPasseio.add(pl2); plaquetas[s.id] = { mat:mp2, nome:s.nome, noAr:false };
  }
});
(function(){
  var minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  SALAS.forEach(function(s){ if (s.tipo === 'ext') return; minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x + s.w); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z + s.d); });
  var teto = new THREE.Mesh(new THREE.PlaneGeometry(maxX-minX, maxZ-minZ), new THREE.MeshStandardMaterial({ color:0x15171c, roughness:1, side:THREE.DoubleSide }));
  teto.rotation.x = Math.PI/2; teto.position.set((minX+maxX)/2, PE_DIREITO, (minZ+maxZ)/2); grupoPasseio.add(teto);
  var mSpot = new THREE.MeshBasicMaterial({ color:0xfff4e0 }), gSpot = new THREE.CircleGeometry(0.09, 16);
  function spot(x, z){ var m = new THREE.Mesh(gSpot, mSpot); m.rotation.x = Math.PI/2; m.position.set(x, PE_DIREITO-0.01, z); grupoPasseio.add(m); }
  SALAS.forEach(function(s){
    if (s.tipo === 'ext') return;
    if (s.tipo === 'corredor') {   // linha de spots no meio + eletrocalha encostada numa lateral
      for (var z = s.z + 1; z < s.z + s.d; z += 2.2) spot(s.x + s.w/2, z);
      if (!s.hall) caixa(0.3, 0.08, s.d, 0x7b818b, s.x + s.w - 0.35, PE_DIREITO - 0.35, s.z + s.d/2, grupoPasseio, { metalness:0.6, roughness:0.4 });
    } else {
      for (var xx = s.x + 1.5; xx < s.x + s.w; xx += 3) for (var zz = s.z + Math.min(1.5, s.d/2); zz < s.z + s.d; zz += 3) spot(xx, zz);
    }
  });
  var mExt = { emissive:0x400000, emissiveIntensity:0.2, roughness:0.4 };
  [[0.15, 7.3], [0.15, 31.5], [17.25, 11.6]].forEach(function(p){
    var e = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 14), mat(0xd01f1f, mExt)); e.position.set(p[0], 0.55, p[1]); grupoPasseio.add(e);
    caixa(0.2, 0.25, 0.2, 0xd01f1f, p[0], 1.45, p[1], grupoPasseio, mExt);   // placa de extintor
  });
  var c = SALAS.filter(function(s){ return s.id === 'central'; })[0];
  if (c) caixa(1.0, 0.3, 0.22, 0xf2f4f7, c.x + c.w/2, PE_DIREITO - 0.6, c.z + 0.2, grupoPasseio, { roughness:0.5 });   // split
})();
function modoEmpresa(on){
  grupoPasseio.visible = on;
  ROTULOS_SALA.forEach(function(r){ r.visible = !on; });
  var k = on ? PE_DIREITO/ALTURA_PAREDE : 1;
  MUROS.forEach(function(m){ m.scale.y = k; m.position.y = ALTURA_PAREDE*k/2; });
}

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
function painelEletrica(){ editandoAvatar = false; rascunhoAv = null; falando = false;
  var h = '<h2>Estrutura elétrica</h2><div class="vazio">Desenho esquemático da estrutura montada pelo Alex (AutoPrev). Por enquanto o estado das ligações é fixo, sem leitura ao vivo. Clique num quadro para ver o que é.</div>';
  h += '<h2>Legenda</h2><div class="ev"><b style="color:#4cc9f0">Ciano com pontinhos</b><small>Energizado, energia fluindo</small></div><div class="ev"><b style="color:#7b8499">Cinza tracejado</b><small>Aberto (Disjuntor TIE)</small></div><div class="ev"><b style="color:#ffb020">Laranja tracejado</b><small>Gerador em espera</small></div>';
  h += '<h2>Caminho da energia</h2><div class="vazio">Light, chave de entrada, média tensão, chave seccionadora, transformador, PNA e QGBT1. Dali segue para os quadros do prédio, para o QTA com o gerador e, pelo QGBT2, para os nobreaks A e B e os quadros do CPD.</div>';
  document.getElementById('painel').innerHTML = h;
}
function painelNo(id){ editandoAvatar = false; rascunhoAv = null; falando = false;
  var n = nosPorId[id]; if (!n) return painelEletrica();
  var h = '<button class="btn" id="voltarEle">← Estrutura elétrica</button><h2>' + esc(n.rot) + '</h2><div class="vazio">' + esc(n.desc) + '</div>';
  h += '<h2>Recebe de</h2>' + (n.de.length ? n.de.map(function(x){ return '<span class="pes">' + esc(x) + '</span>'; }).join('') : '<div class="vazio">Alimentado pelo barramento acima.</div>');
  h += '<h2>Alimenta</h2>' + (n.para.length ? n.para.map(function(x){ return '<span class="pes">' + esc(x) + '</span>'; }).join('') : '<div class="vazio">Carga final ou barramento abaixo.</div>');
  document.getElementById('painel').innerHTML = h;
  document.getElementById('voltarEle').onclick = painelEletrica;
}

// ── Pessoas ──
var atores = {};   // nome -> { grupo, sala, alvo, vel }
function hexCor(s){ return parseInt(String(s).slice(1), 16); }
// Monta o boneco. Sem avatar escolhido: boneco todo cinza (pedido do Guilherme — quem não escolheu fica cinza).
// A frente do boneco é +z (óculos e aba do boné ficam desse lado).
function montarBoneco(grupo, nome, av){
  var corRoupa = av ? hexCor(av.roupa) : 0x7c828e;
  var corPele = av ? hexCor(av.pele) : 0xa9aeb8;
  var corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.24,0.75,14), mat(corRoupa,{ roughness:0.6 })); corpo.position.y = 0.45; corpo.castShadow = true; grupo.add(corpo);
  var cab = new THREE.Mesh(new THREE.SphereGeometry(0.19,16,12), mat(corPele,{ roughness:0.7 })); cab.position.y = 1.0; cab.castShadow = true; grupo.add(cab);
  if (!av) return;
  var mc = mat(hexCor(av.corCabelo), { roughness:0.9 });
  function peca(geo, m, x, y, z){ var o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; grupo.add(o); return o; }
  var c = av.cabelo;
  if (c !== 'careca' && c !== 'moicano') peca(new THREE.SphereGeometry(0.205,16,10,0,Math.PI*2,0,Math.PI*0.48), mc, 0, 1.01, -0.01);   // topo
  if (c === 'medio') peca(new THREE.CylinderGeometry(0.2,0.21,0.16,16,1,true), mc, 0, 0.98, -0.02);
  if (c === 'longo') peca(new THREE.CylinderGeometry(0.205,0.23,0.42,16,1,true,Math.PI*0.25,Math.PI*1.5), mc, 0, 0.86, -0.02);
  if (c === 'coque') peca(new THREE.SphereGeometry(0.09,12,10), mc, 0, 1.2, -0.12);
  if (c === 'moicano') peca(new THREE.BoxGeometry(0.06,0.1,0.34), mc, 0, 1.2, 0);
  var a = av.acessorio;
  if (a === 'fone') {
    var mf = mat(0x111418, { roughness:0.5 });
    var arco = peca(new THREE.TorusGeometry(0.215,0.022,8,24,Math.PI), mf, 0, 1.0, 0); arco.rotation.y = Math.PI/2;
    peca(new THREE.CylinderGeometry(0.075,0.075,0.05,14), mf, 0.2, 0.99, 0).rotation.z = Math.PI/2;
    peca(new THREE.CylinderGeometry(0.075,0.075,0.05,14), mf, -0.2, 0.99, 0).rotation.z = Math.PI/2;
  }
  if (a === 'bone') {
    var mb = mat(corRoupa, { roughness:0.7 });
    peca(new THREE.SphereGeometry(0.212,16,10,0,Math.PI*2,0,Math.PI*0.45), mb, 0, 1.03, 0);
    peca(new THREE.CylinderGeometry(0.15,0.15,0.02,16,1,false,-Math.PI/2,Math.PI), mb, 0, 1.08, 0.1);
  }
  if (a === 'oculos') {
    var mo = mat(0x0b0b0f, { roughness:0.3, metalness:0.4 });
    peca(new THREE.BoxGeometry(0.09,0.05,0.02), mo, 0.065, 1.03, 0.18);
    peca(new THREE.BoxGeometry(0.09,0.05,0.02), mo, -0.065, 1.03, 0.18);
    peca(new THREE.BoxGeometry(0.06,0.012,0.012), mo, 0, 1.04, 0.185);
  }
}
function criarAtor(p){
  var grupo = new THREE.Group();
  montarBoneco(grupo, p.nome, p.avatar || null);
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
  if (s.tipo === 'central') { var nc = /^c[0-9]+$/.test(posto) ? +posto.slice(1) : -1; return ASSENTOS_CENTRAL[nc] || null; }
  if (s.tipo === 'pd') { var k = { gc:0, vt:1, dtv:2 }[posto]; if (k == null) return null; return { x: s.x+1.7+k*1.4, z: s.z+s.d-0.25, rot: Math.PI }; }
  if (s.tipo === 'playout') { return posto === 'playout' ? { x: s.x+1.0, z: s.z+s.d/2+0.65, rot: Math.PI } : null; }
  if (s.tipo === 'apoio') { var j = { opVideo:0, ilum:1 }[posto]; if (j == null) return null; return { x: s.x+1.5+j*2.0, z: s.z+s.d/2+0.65, rot: Math.PI }; }
  return null;
}
function cabineAudio(s){ return { x: s.x + 0.3, z: s.z + s.d - 3.6, w: s.w - 0.6, d: 3.4 }; }   // sub-sala do sonoplasta, no fundo do SW
function pontoNaSala(salaId, seed, sub){
  var s = porId[salaId] || porId.central; var m = Math.min(0.8, s.w*0.3, s.d*0.3);
  if (sub === 'audio' && s.tipo === 'controle') { var c = cabineAudio(s); return { x: c.x + 0.6 + rnd(seed)*(c.w-1.2), z: c.z + 0.6 + rnd(seed+7)*(c.d-1.2) }; }
  return { x: s.x + m + rnd(seed)*(s.w-2*m), z: s.z + m + rnd(seed+7)*(s.d-2*m) };
}
function sincronizarPessoas(){
  var vivos = {}, nCentral = 0;
  DADOS.pessoas.forEach(function(p){ if (p.sala === 'central' && !p.posto) p.posto = 'c' + (nCentral++); });
  DADOS.pessoas.forEach(function(p, i){
    vivos[p.nome] = true;
    var a = atores[p.nome];
    var chaveAv = JSON.stringify(p.avatar || null);
    if (a && a.av !== chaveAv) { cena.remove(a.grupo); delete atores[p.nome]; a = null; }   // trocou de avatar: refaz o boneco
    if (!a || a.sala !== p.sala) {
      if (!a) { a = atores[p.nome] = { grupo:criarAtor(p), pos:null, alvo:null, espera:0, av:chaveAv }; }
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
// Placa grande "● NO AR" (vermelha, 2 linhas: selo + nome do evento) flutuando sobre a sala.
function placaNoAr(nomeEv){
  var c = document.createElement('canvas'), ctx = c.getContext('2d');
  var f1 = '900 64px system-ui,Segoe UI,sans-serif', f2 = '600 34px system-ui,Segoe UI,sans-serif';
  var linha2 = String(nomeEv || '').replace(/[^0-9A-Za-zÀ-ÿ |:.,()+&x-]/g, '').trim(); if (linha2.length > 38) linha2 = linha2.slice(0, 37) + '…';
  ctx.font = f1; var w1 = ctx.measureText('● NO AR').width; ctx.font = f2; var w2 = linha2 ? ctx.measureText(linha2).width : 0;
  var w = Math.ceil(Math.max(w1, w2)) + 60, h = linha2 ? 150 : 100; c.width = w; c.height = h;
  ctx.fillStyle = '#e5233a'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(0,0,w,h,26); else ctx.rect(0,0,w,h); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = f1; ctx.fillText('● NO AR', w/2, linha2 ? 52 : 52);
  if (linha2) { ctx.font = f2; ctx.fillStyle = '#ffe3e6'; ctx.fillText(linha2, w/2, 115); }
  var t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, depthTest:false }));
  var k = 0.0085; s.scale.set(w*k, h*k, 1); s.renderOrder = 12; return s;
}
// Destaque completo da sala no ar: placa, contorno vermelho no topo das paredes, feixe de luz subindo.
// TV virtual com o vídeo do YouTube, flutuando sobre a sala (CSS3D: um iframe posicionado em 3D por cima do canvas).
// Sempre sem som; o botão liga o som desta TV e silencia as outras. No máximo MAX_TVS tocando ao mesmo tempo (pesa).
var MAX_TVS = 4;
function urlTv(id, comSom){ return 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&mute=' + (comSom ? 0 : 1) + '&playsinline=1&controls=0&rel=0&modestbranding=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin); }
// Quando o dono do conteúdo bloqueia tocar fora do YouTube (ex.: "LiveMode O&O bloqueou a exibição neste site"), o player
// avisa por postMessage (onError 100/101/150/153). Aí a TV troca o player pela capa da live + botão "Assistir no YouTube".
function escutarPlayer(fr){ fr.addEventListener('load', function(){ try { fr.contentWindow.postMessage(JSON.stringify({ event:'listening', id:1, channel:'widget' }), '*'); } catch(e){} }); }
function mostrarCapa(box){
  if (box.capa) return; box.capa = true;
  var id = box.idVideo, link = 'https://www.youtube.com/watch?v=' + id;
  box.innerHTML = '';
  var a = document.createElement('a'); a.className = 'tv3d-capa'; a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
  var img = document.createElement('img'); img.alt = ''; img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault_live.jpg';
  img.onerror = function(){ if (img.src.indexOf('hqdefault.jpg') < 0) img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; };
  var bt = document.createElement('span'); bt.className = 'tv3d-ver'; bt.textContent = '▶ Assistir no YouTube';
  a.appendChild(img); a.appendChild(bt); box.appendChild(a);
  // a capa de uma live no YouTube é atualizada de tempos em tempos: recarrega a cada 60 s pra ficar "quase ao vivo"
  box.timerCapa = setInterval(function(){ if (!document.body.contains(box)) { clearInterval(box.timerCapa); return; } var base = img.src.split('?')[0]; img.src = base + '?t=' + Date.now(); }, 60000);
  var selo = document.createElement('span'); selo.className = 'tv3d-selo'; selo.textContent = '● AO VIVO'; box.appendChild(selo);
}
window.addEventListener('message', function(ev){
  if (!/^https:[/][/](www[.])?youtube(-nocookie)?[.]com$/.test(ev.origin)) return;
  var d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch(e){ return; }
  if (!d || d.event !== 'onError') return;
  Array.prototype.forEach.call(document.querySelectorAll('.tv3d'), function(box){ var fr = box.querySelector('iframe'); if (fr && fr.contentWindow === ev.source) mostrarCapa(box); });
});
function tvsAbertas(){ return Object.keys(grupoSalas).filter(function(id){ var p = grupoSalas[id].placa; return p && p.userData.tv; }).length; }
function criarTv(id, nomeEv){
  var box = document.createElement('div'); box.className = 'tv3d';
  var fr = document.createElement('iframe'); fr.src = urlTv(id, false); fr.allow = 'autoplay; encrypted-media; picture-in-picture'; fr.title = nomeEv || 'Ao vivo'; box.appendChild(fr); escutarPlayer(fr);
  var selo = document.createElement('span'); selo.className = 'tv3d-selo'; selo.textContent = '● AO VIVO'; box.appendChild(selo);
  var som = document.createElement('button'); som.className = 'tv3d-som'; som.textContent = 'Ligar som'; box.appendChild(som);
  som.onclick = function(ev){
    ev.stopPropagation(); var ligar = !box.comSom;
    Array.prototype.forEach.call(document.querySelectorAll('.tv3d'), function(b){ if (b.comSom) { b.comSom = false; b.querySelector('iframe').src = urlTv(b.idVideo, false); b.querySelector('.tv3d-som').textContent = 'Ligar som'; } });
    if (ligar && !box.capa) { box.comSom = true; fr.src = urlTv(id, true); som.textContent = 'Sem som'; }
  };
  box.idVideo = id;
  var o = new THREE.CSS3DObject(box); o.scale.set(0.0075, 0.0075, 0.0075); return o;
}
function destaqueNoAr(gi, nomeEv, idVideo, soContorno){
  var s = gi.sala, g = new THREE.Group(), cx = s.x + s.w/2, cz = s.z + s.d/2;
  var tv = (!soContorno && idVideo && css3 && tvsAbertas() < MAX_TVS) ? criarTv(idVideo, nomeEv) : null;
  // PDs são estreitas e vizinhas: TV menor e deslocada ao longo da sala (PD1 mais à esquerda ... PD4 mais à direita, repete),
  // senão as TVs de PDs vizinhas ficam umas por cima das outras
  var estreita = s.tipo === 'pd', tx = cx, ty = ALTURA_PAREDE + 2.4, topo = ALTURA_PAREDE + 4.75;
  if (estreita) { var nPd = parseInt(String(s.id).replace(/[^0-9]/g, ''), 10) || 1; tx = s.x + 2.4 + ((nPd - 1) % 4) * 3.2; ty = ALTURA_PAREDE + 1.75; topo = ALTURA_PAREDE + 3.1; if (tv) tv.scale.set(0.0042, 0.0042, 0.0042); }
  if (tv) { tv.position.set(tx, ty, cz); g.add(tv); }
  var placa = null;
  if (!soContorno) { placa = placaNoAr(nomeEv); placa.position.set(tv ? tx : cx, tv ? topo : ALTURA_PAREDE + 1.5, cz); if (estreita) placa.scale.multiplyScalar(0.75); g.add(placa); }
  var mBorda = new THREE.MeshBasicMaterial({ color:0xff2d45, transparent:true, opacity:0.9 });
  var e = 0.1, y = ALTURA_PAREDE + 0.04;
  // contorno: pula os trechos abertos (abertoN/abertoS), pra PD6 + estúdio ampliado formarem um contorno só
  function trechos(total, vaos){ var seg = [[0, total]]; (vaos || []).forEach(function(v){ var n = []; seg.forEach(function(a){ if (v[1] <= a[0] || v[0] >= a[1]) n.push(a); else { if (v[0] > a[0]) n.push([a[0], v[0]]); if (v[1] < a[1]) n.push([v[1], a[1]]); } }); seg = n; }); return seg; }
  function borda(w, d, x, z){ var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mBorda); m.position.set(x, y, z); g.add(m); }
  trechos(s.w, s.abertoN).forEach(function(a){ borda(a[1]-a[0], e, s.x + (a[0]+a[1])/2, s.z); });
  trechos(s.w, s.abertoS).forEach(function(a){ borda(a[1]-a[0], e, s.x + (a[0]+a[1])/2, s.z + s.d); });
  borda(e, s.d, s.x, cz); borda(e, s.d, s.x + s.w, cz);
  g.userData = { placa:placa, mBorda:mBorda, tv:tv, yPlaca:placa ? placa.position.y : 0, fase: soContorno && grupoSalas[s.liga] && grupoSalas[s.liga].placa ? grupoSalas[s.liga].placa.userData.fase : Math.random()*6 };
  gi.grupo.add(g); return g;
}
function removerDestaque(gi){
  var p = gi.placa; if (!p) return;
  if (p.userData.tv) p.remove(p.userData.tv);   // o CSS3DObject tira o iframe da página quando é removido
  gi.grupo.remove(p); gi.placa = null;
}
function animarNoAr(t){
  Object.keys(grupoSalas).forEach(function(id){
    var p = grupoSalas[id].placa; if (!p) return; var u = p.userData, f = t*3 + u.fase;
    if (u.placa) u.placa.position.y = u.yPlaca + Math.sin(t*1.6 + u.fase)*0.08;
    u.mBorda.opacity = 0.55 + 0.45*Math.sin(f);
    if (u.tv) u.tv.quaternion.copy(camera.quaternion);   // a TV sempre de frente pra quem olha
  });
}
var marcadoresChamado = {};
function sincronizarEstado(){
  var noAr = {};
  DADOS.eventos.forEach(function(e){ if (e.noAr) { if (e.sala) noAr[e.sala] = true; if (e.controle) noAr[e.controle] = true; } });
  (DADOS.salasAoVivo||[]).forEach(function(id){ noAr[id] = true; });
  atualizarMultiviews(noAr);
  var nomeEvAr = {}, videoAr = {};   // sala -> nome do evento no ar (vai na placa) / id do vídeo no YouTube (vai na TV)
  DADOS.eventos.forEach(function(e){ if (e.noAr && e.youtubeId && e.sala && !videoAr[e.sala]) videoAr[e.sala] = e.youtubeId; });
  DADOS.eventos.forEach(function(e){ if (e.noAr) { if (e.sala && !nomeEvAr[e.sala]) nomeEvAr[e.sala] = e.nome; if (e.controle && !nomeEvAr[e.controle]) nomeEvAr[e.controle] = e.nome; } });
  var dest = {};   // sala -> "YouTube · Prime · Disney +3" do evento que está no ar nela
  DADOS.eventos.forEach(function(e){ if (e.noAr && e.sala && e.plataformas && e.plataformas.length && !dest[e.sala]) { dest[e.sala] = e.plataformas.slice(0,3).map(curtoPlat).join(' · ') + (e.plataformas.length>3 ? ' +' + (e.plataformas.length-3) : ''); } });   // salas com evento acontecendo agora (sistema de Operações)
  Object.keys(grupoSalas).forEach(function(id){
    var gi = grupoSalas[id];
    if (gi.aoVivo) { gi.aoVivo.userData.ligado = !!noAr[gi.sala.liga || id]; }
    mudarPlaqueta(id, !!noAr[id]);
    var lig = gi.sala.liga;
    if (lig) {   // ex.: estúdio ampliado da PD6 — contorno junto com a PD6, sem placa nem TV
      var on = !!noAr[lig];
      if (gi.placa && !on) removerDestaque(gi);
      if (on && !gi.placa) { gi.placa = destaqueNoAr(gi, '', '', true); gi.placaNome = 'contorno'; }
      return;
    }
    var nomeAgora = noAr[id] ? (nomeEvAr[id] || '') + '|' + (videoAr[id] || '') : null;
    if (gi.placa && gi.placaNome !== nomeAgora) removerDestaque(gi);   // saiu do ar ou trocou o evento
    if (noAr[id] && !gi.placa) { gi.placa = destaqueNoAr(gi, nomeEvAr[id] || '', videoAr[id] || ''); gi.placaNome = nomeAgora; }
    var tx = noAr[id] ? (dest[id] || '') : '';
    if (gi.destTexto !== tx) {
      if (gi.destSprite) { gi.grupo.remove(gi.destSprite); gi.destSprite = null; }
      gi.destTexto = tx;
      if (tx) { var dsp = etiqueta('→ ' + tx, '#9ad7ff', 0.6); dsp.position.set(gi.sala.x+gi.sala.w/2, ALTURA_PAREDE+1.15, gi.sala.z+gi.sala.d/2); gi.grupo.add(dsp); gi.destSprite = dsp; }
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
var detalhesRacks = null;
function carregarRacks(cb){
  if (detalhesRacks) return cb();
  if (DEMO && DEMO.racksDet) { detalhesRacks = DEMO.racksDet; return cb(); }
  fetch('/api/mapa?racks=1', { credentials:'same-origin' }).then(function(r){ return r.json(); })
    .then(function(d){ detalhesRacks = d; cb(); }).catch(function(){ detalhesRacks = { gestor:false, racks:[] }; cb(); });
}
function painelRack(cod){ editandoAvatar = false; rascunhoAv = null; falando = false;
  var p = document.getElementById('painel'); p.innerHTML = '<div class="vazio">Carregando rack…</div>';
  carregarRacks(function(){
    var r = (detalhesRacks.racks || []).filter(function(x){ return x.codigo === cod; })[0];
    var h = '<button class="btn" id="voltar">← Visão geral</button><h2>Rack ' + esc(cod) + '</h2>';
    if (!r) { h += '<div class="vazio">Sem detalhes deste rack.</div>'; }
    else {
      h += '<div class="vazio">' + esc(r.funcao) + ' · ' + r.itens.length + ' equipamentos nos Us' + (detalhesRacks.gestor ? '' : ' (IPs só para gestores)') + '</div><h2>De cima para baixo</h2>';
      r.itens.forEach(function(i){ h += '<div class="ev"><b>' + esc(i.nome) + '</b><small>U' + i.t + (i.t !== i.b ? '–U' + i.b : '') + (i.modelo ? ' · ' + esc(i.modelo) : '') + (i.ip ? ' · ' + esc(i.ip) : '') + '</small></div>'; });
      if (r.fora.length) { h += '<h2>Fora dos Us</h2>'; r.fora.forEach(function(i){ h += '<div class="ev"><b>' + esc(i.nome) + '</b>' + (i.ip ? '<small>' + esc(i.ip) + '</small>' : '') + '</div>'; }); }
    }
    p.innerHTML = h; var v = document.getElementById('voltar'); if (v) v.onclick = function(){ irPara(null); painelGeral(); };
  });
}
function painelSala(id){ editandoAvatar = false; rascunhoAv = null; falando = false;
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
  if (id === 'cpd') thetaDest = 1.0;   // olha do lado leste, onde fica a frente dos racks
}
function posCamera(){
  if (passeio) { camera.position.set(passeio.x, OLHO, passeio.z); camera.rotation.set(passeio.pitch, passeio.yaw, 0, 'YXZ'); return; }
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
  if (passeio) { passeio.yaw -= dx*0.005; passeio.pitch = Math.max(-1.1, Math.min(1.1, passeio.pitch - dy*0.005)); return; }
  if (arrasto.pan) { var k=dist*0.0016; alvoDest.x -= (dx*Math.cos(theta) + dy*Math.sin(theta))*k; alvoDest.z -= (-dx*Math.sin(theta) + dy*Math.cos(theta))*k; }
  else { thetaDest -= dx*0.006; phiDest = Math.max(0.15, Math.min(1.45, phiDest - dy*0.006)); }
});
renderer.domElement.addEventListener('pointerup', function(e){ arrasto=null; if(!moveu) clicar(e); });
renderer.domElement.addEventListener('wheel', function(e){ e.preventDefault(); if (passeio) return; distDest = Math.max(6, Math.min(600, distDest*(1+e.deltaY*0.001))); }, { passive:false });
var toques = {};
renderer.domElement.addEventListener('touchstart', function(e){ if(e.touches.length===2){ var a=e.touches[0],b=e.touches[1]; toques.d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); } }, { passive:true });
renderer.domElement.addEventListener('touchmove', function(e){ if(e.touches.length===2){ var a=e.touches[0],b=e.touches[1]; var d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); if(toques.d){ distDest=Math.max(6,Math.min(600,distDest*(toques.d/d))); } toques.d=d; } }, { passive:true });

var ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function clicar(e){
  var r = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-r.left)/r.width)*2-1; mouse.y = -((e.clientY-r.top)/r.height)*2+1;
  ray.setFromCamera(mouse, camera);
  if (modoEle) { var hitE = ray.intersectObjects(alvosEle, false)[0]; if (hitE) { painelNo(hitE.object.userData.eletr); } return; }
  var hitR = ray.intersectObjects(alvosRack, false)[0];
  if (hitR && hitR.object.userData.rack) { irPara('cpd'); painelRack(hitR.object.userData.rack); return; }
  var hit = ray.intersectObjects(alvosClique, false)[0];
  if (passeio && (hitR || hit)) document.body.classList.add('com-painel');
  if (hit && hit.object.userData.sala && (porId[hit.object.userData.sala] || {}).tipo !== 'corredor') { irPara(hit.object.userData.sala); painelSala(hit.object.userData.sala); }
}
Array.prototype.forEach.call(document.querySelectorAll('[data-vai]'), function(b){ b.onclick = function(){ if (passeio) sairPasseio(); var v=b.getAttribute('data-vai'); if(v==='eletrica'){ mostrarEletrica(true); return; } mostrarEletrica(false); if(v==='geral'){ irPara(null); painelGeral(); } else { irPara(v); painelSala(v); } }; });

// ── Passear: andar por dentro da central em primeira pessoa ──
// Computador: setas/WASD andam (Shift corre), arrastar olha em volta. Celular: joystick no canto + arrastar olha.
// Não atravessa paredes (só passa pelas portas). Clique em sala, rack ou pessoa abre o painel como sempre.
var OLHO = 0.95, RAIO = 0.22;
var passeio = null, teclas = {}, joy = { x:0, y:0 };
function bate(x, z){ for (var i=0;i<PAREDES.length;i++){ var p = PAREDES[i]; if (Math.abs(x-p.x) < p.hw+RAIO && Math.abs(z-p.z) < p.hd+RAIO) return true; } return false; }
function entrarPasseio(){
  if (modoEle) mostrarEletrica(false);
  passeio = { x:1.1, z:7.25, yaw:-Math.PI/2, pitch:-0.05 };   // no hall, de frente pra porta da Central   // no corredor, na porta da Central, olhando pra dentro
  camera.fov = 70; camera.updateProjectionMatrix(); modoEmpresa(true);
  document.body.classList.add('passeio'); document.body.classList.remove('com-painel');
  document.getElementById('passear-btn').textContent = '⬆ Visão de cima';
  var dc = document.getElementById('dica'); if (dc) dc.textContent = 'Setas/WASD = andar (Shift corre) · arraste = olhar em volta · clique = detalhes';
}
function sairPasseio(){
  if (passeio) enviarPresenca({ sair:true });
  passeio = null; teclas = {}; joy.x = joy.y = 0;
  camera.fov = 45; camera.updateProjectionMatrix(); modoEmpresa(false);
  document.body.classList.remove('passeio'); document.body.classList.remove('com-painel');
  document.getElementById('passear-btn').textContent = '🚶 Passear';
  var dc = document.getElementById('dica'); if (dc) dc.textContent = 'Arraste = girar · Shift/botão direito = mover · roda = zoom · clique numa sala';
}
function andar(dt){
  if (!passeio) return;
  var f = (teclas.KeyW||teclas.ArrowUp?1:0) - (teclas.KeyS||teclas.ArrowDown?1:0) - joy.y;
  var l = (teclas.KeyD||teclas.ArrowRight?1:0) - (teclas.KeyA||teclas.ArrowLeft?1:0) + joy.x;
  if (!f && !l) return;
  var n = Math.min(1, Math.sqrt(f*f + l*l)) / Math.sqrt(f*f + l*l), v = (teclas.ShiftLeft||teclas.ShiftRight ? 4.2 : 2.2) * dt * n;
  var sy = Math.sin(passeio.yaw), cy = Math.cos(passeio.yaw);
  var mx = (-sy*f + cy*l) * v, mz = (-cy*f - sy*l) * v;
  if (!bate(passeio.x + mx, passeio.z)) passeio.x += mx;    // desliza na parede em vez de travar
  if (!bate(passeio.x, passeio.z + mz)) passeio.z += mz;
}
window.addEventListener('keydown', function(e){
  if (!passeio) return; var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
  if (e.code === 'Escape') { sairPasseio(); return; }
  if (/^(Key[WASD]|Arrow|Shift)/.test(e.code)) { teclas[e.code] = true; e.preventDefault(); }
});
window.addEventListener('keyup', function(e){ delete teclas[e.code]; });
window.addEventListener('blur', function(){ teclas = {}; });
(function(){
  var base = document.getElementById('joy'), pino = document.getElementById('joy-pino'); if (!base) return;
  var ativo = null;
  function mover(e){ var r = base.getBoundingClientRect(), cx = r.left + r.width/2, cy = r.top + r.height/2, rr = r.width/2;
    var dx = (e.clientX-cx)/rr, dy = (e.clientY-cy)/rr, d = Math.sqrt(dx*dx+dy*dy); if (d > 1) { dx /= d; dy /= d; }
    joy.x = dx; joy.y = dy; pino.style.transform = 'translate(' + (dx*rr*0.6) + 'px,' + (dy*rr*0.6) + 'px)'; }
  base.addEventListener('pointerdown', function(e){ ativo = e.pointerId; base.setPointerCapture(e.pointerId); mover(e); e.preventDefault(); });
  base.addEventListener('pointermove', function(e){ if (ativo === e.pointerId) mover(e); });
  function soltar(){ ativo = null; joy.x = joy.y = 0; pino.style.transform = ''; }
  base.addEventListener('pointerup', soltar); base.addEventListener('pointercancel', soltar);
})();
var psBtn = document.getElementById('passear-btn'); if (psBtn) psBtn.onclick = function(){ if (passeio) sairPasseio(); else entrarPasseio(); };
var fpBtn = document.getElementById('fechar-painel'); if (fpBtn) fpBtn.onclick = function(){ document.body.classList.remove('com-painel'); };

// ── Presença: quem está passeando aparece no mapa de todo mundo; "olha isso" mostra um ponto pra central ──
// Servidor: /api/presenca (Durable Object, cloudflare/presenca.js). Enquanto passeia, manda a posição a cada 2 s;
// fora do passeio só lê, a cada 4 s (e só com a aba visível).
var visitantes = {};   // nome -> { grupo, x, z, yaw }
function avatarValido(a){ if (!a) return null; for (var k in AVATAR_OPC) { if (AVATAR_OPC[k].indexOf(a[k]) < 0) return null; } return a; }
function meuNome(){ return (DADOS.eu && DADOS.eu.nome) || ''; }
function atualizarVisitantes(lista){
  var vivos = {}, eu = meuNome();
  (lista || []).forEach(function(p){
    if (!p || !p.nome || p.nome === eu) return; vivos[p.nome] = true;
    var v = visitantes[p.nome];
    var chave = JSON.stringify(avatarValido(p.avatar));
    if (v && v.av !== chave) { cena.remove(v.grupo); v = null; }
    if (!v) {
      var g = criarAtor({ nome:p.nome, avatar:avatarValido(p.avatar), funcao:'passeando' });
      g.position.set(p.x, 0, p.z); v = visitantes[p.nome] = { grupo:g, x:p.x, z:p.z, yaw:p.yaw, av:chave };
    }
    v.x = p.x; v.z = p.z; v.yaw = p.yaw;
    if (atores[p.nome]) atores[p.nome].grupo.visible = false;   // não mostra a mesma pessoa sentada e andando
  });
  Object.keys(visitantes).forEach(function(n){ if (!vivos[n]) { cena.remove(visitantes[n].grupo); delete visitantes[n]; if (atores[n]) atores[n].grupo.visible = true; } });
}
function animarVisitantes(dt){
  Object.keys(visitantes).forEach(function(n){ var v = visitantes[n], g = v.grupo, k = Math.min(1, dt*5);
    g.position.x += (v.x - g.position.x)*k; g.position.z += (v.z - g.position.z)*k; g.rotation.y = v.yaw + Math.PI; });
}
var ultimoEnvio = 0, ultimaPos = '';
function enviarPresenca(corpo){
  return fetch('/api/presenca', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(corpo) })
    .then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if (d) receberPresenca(d); return d; }).catch(function(){ return null; });
}
function receberPresenca(d){ atualizarVisitantes(d.pessoas); checarOlha(d.olha); }
function cicloPresenca(){
  if (DEMO || document.hidden) return;
  var agora = Date.now();
  if (passeio) {
    var pos = passeio.x.toFixed(1) + ',' + passeio.z.toFixed(1) + ',' + passeio.yaw.toFixed(1);
    if (pos !== ultimaPos || agora - ultimoEnvio > 8000) { ultimaPos = pos; ultimoEnvio = agora;
      enviarPresenca({ x:passeio.x, z:passeio.z, yaw:passeio.yaw, avatar:(DADOS.eu && DADOS.eu.avatar) || null }); }
  } else if (agora - ultimoEnvio > 4000) {
    ultimoEnvio = agora;
    fetch('/api/presenca', { credentials:'same-origin' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if (d) receberPresenca(d); }).catch(function(){});
  }
}
setInterval(cicloPresenca, 2000);
window.addEventListener('pagehide', function(){ if (passeio && navigator.sendBeacon) navigator.sendBeacon('/api/presenca', new Blob([JSON.stringify({ sair:true })], { type:'application/json' })); });

// onde estou (pro rótulo do "olha isso"): sala + rack mais perto, se estiver no CPD
function ondeEstou(x, z){
  var sala = null;
  SALAS.forEach(function(s){ if (x >= s.x && x <= s.x + s.w && z >= s.z && z <= s.z + s.d && (!sala || s.tipo !== 'corredor')) sala = s; });
  var rot = sala ? sala.nome : 'Corredor';
  if (sala && sala.tipo === 'cpd') {
    var melhor = null, dm = 2.5, v = new THREE.Vector3();
    alvosRack.forEach(function(m){ if (!m.userData.rack) return; m.getWorldPosition(v); var d = Math.hypot(v.x - x, v.z - z); if (d < dm) { dm = d; melhor = m.userData.rack; } });
    if (melhor) rot += ' · rack ' + melhor;
  }
  return rot;
}
function painelMostrar(){
  if (!passeio) return;
  editandoAvatar = false; rascunhoAv = null; falando = true; document.body.classList.add('com-painel');
  var rot = ondeEstou(passeio.x, passeio.z);
  var h = '<h2>Mostrar para a central</h2><div class="vazio">Quem estiver com o Mapa 3D aberto recebe um aviso e, tocando em <b>Ver</b>, fica exatamente onde você está, olhando pro mesmo lado.</div>';
  h += '<div class="ev"><b>' + esc(rot) + '</b><small>seu ponto de vista agora</small></div>';
  h += '<div class="av-acoes"><button class="btn" id="mostrar-fechar">Cancelar</button><button class="btn av-salvar" id="mostrar-ok">Mostrar</button></div>';
  if (FALAR) h += '<div class="av-acoes" style="margin-top:8px"><button class="btn btn-falar" id="mostrar-echo">Mostrar e avisar na Echo</button></div>';
  h += '<div id="mostrar-status" class="vazio"></div>';
  var p = document.getElementById('painel'); p.innerHTML = h; p.scrollTop = 0;
  var pose = { x:passeio.x, z:passeio.z, yaw:passeio.yaw, pitch:passeio.pitch, rotulo:rot };
  function feito(msg){ document.getElementById('mostrar-status').textContent = msg; }
  document.getElementById('mostrar-fechar').onclick = function(){ falando = false; painelGeral(); };
  document.getElementById('mostrar-ok').onclick = function(){ enviarPresenca({ mostrar:pose }).then(function(d){ feito(d ? 'Pronto: quem estiver com o mapa aberto já recebeu.' : 'Não deu pra enviar. Tente de novo.'); }); };
  var be = document.getElementById('mostrar-echo');
  if (be) be.onclick = function(){
    be.disabled = true;
    enviarPresenca({ mostrar:pose }).then(function(){
      return fetch('/api/avisar-central', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ texto: 'Abram o Mapa 3D do Pulse, estou mostrando ' + rot + '.' }) });
    }).then(function(r){ feito(r && r.ok ? 'Pronto: aviso no mapa e na Echo da central.' : 'Aviso no mapa enviado; a Echo não recebeu.'); }).catch(function(){ feito('Não deu pra enviar. Tente de novo.'); }).then(function(){ be.disabled = false; });
  };
}
var olhaVisto = 0;
try { olhaVisto = +(localStorage.getItem('pulse-olha-visto') || 0); } catch(e){}
function checarOlha(o){
  var bx = document.getElementById('olha');
  if (!o || o.de === meuNome() || o.id <= olhaVisto) { return; }
  if (bx.getAttribute('data-id') === String(o.id)) return;
  bx.setAttribute('data-id', String(o.id));
  bx.innerHTML = '&#128205; <b>' + esc(String(o.de).split(' ')[0]) + '</b> está mostrando: ' + esc(o.rotulo || 'um ponto') + ' <button class="btn av-salvar" id="olha-ver">Ver</button><button class="btn" id="olha-fechar" aria-label="Dispensar">&#10005;</button>';
  bx.hidden = false;
  function visto(){ olhaVisto = o.id; try { localStorage.setItem('pulse-olha-visto', String(o.id)); } catch(e){} bx.hidden = true; }
  document.getElementById('olha-fechar').onclick = visto;
  document.getElementById('olha-ver').onclick = function(){ visto(); if (!passeio) entrarPasseio(); passeio.x = o.x; passeio.z = o.z; passeio.yaw = o.yaw; passeio.pitch = o.pitch || 0; };
}
var moBtn = document.getElementById('mostrar-btn'); if (moBtn) moBtn.onclick = painelMostrar;

function redimensionar(){ var w=window.innerWidth,h=window.innerHeight; renderer.setSize(w,h); if (css3) css3.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', redimensionar); redimensionar();

// ── Loop ──
var relogio = new THREE.Clock();
function laco(){
  var dt = Math.min(relogio.getDelta(), 0.1), t = relogio.elapsedTime;
  andar(dt); posCamera(); animarPessoas(dt, t); animarVisitantes(dt); animarRio(dt, t);
  Object.keys(grupoSalas).forEach(function(id){ var gi = grupoSalas[id], m = gi.aoVivo; if(m){ m.material.opacity = m.userData.ligado ? 0.32 + 0.14*Math.sin(t*3) : 0; } if(gi.pgm){ gi.pgm.material.emissiveIntensity = (m && m.userData.ligado) ? 1.5 + 0.4*Math.sin(t*3) : 0.35; } });
  Object.keys(marcadoresChamado).forEach(function(k, i){ var m=marcadoresChamado[k]; m.rotation.y = t*2; m.position.y = ALTURA_PAREDE+1.1+Math.sin(t*3+i)*0.1; });
  if (modoEle) { fluxos.forEach(function(f){ var q = posNoFluxo(f, t*0.08); f.m.position.set(ew(q[0]), 0.18, ez(q[1])); }); }
  racksLeds.forEach(function(l){ var on = Math.sin(t*(1.5+(l.f%5)*0.4)+l.f) > -0.7; l.m.material.color.setHex(on?0x3ddc97:0x16573f); });
  renderer.render(cena, camera);
  if (css3) css3.render(cena, camera);
  girarPrevia(t); animarNoAr(t);
  requestAnimationFrame(laco);
}

// ── Meu avatar: cada pessoa escolhe como aparece (grava em MapaAvatares, só o da própria pessoa) ──
var AVATAR_OPC = __AVATAR_OPC__;
var editandoAvatar = false, rascunhoAv = null;
var ROTULOS_AV = { pele:'Tom de pele', roupa:'Roupa', cabelo:'Cabelo', corCabelo:'Cor do cabelo', acessorio:'Acessório' };
var NOMES_OPC = { careca:'Careca', curto:'Curto', medio:'Médio', longo:'Longo', coque:'Coque', moicano:'Moicano', nenhum:'Nenhum', fone:'Fone', bone:'Boné', oculos:'Óculos' };
var previa = null;   // mini-cena do painel
function desenharPrevia(){
  var box = document.getElementById('av-previa'); if (!box) return;
  if (!previa) {
    var r = new THREE.WebGLRenderer({ antialias:true, alpha:true }); r.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    var c = new THREE.Scene(); c.add(new THREE.HemisphereLight(0xffffff, 0x334466, 1.0)); var dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(1,2,2); c.add(dl);
    var cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20); cam.position.set(0, 0.8, 3.1); cam.lookAt(0, 0.68, 0);
    previa = { r:r, c:c, cam:cam, g:null };
  }
  box.innerHTML = ''; box.appendChild(previa.r.domElement); var lw = box.clientWidth || 280; previa.r.setSize(lw, 170); previa.cam.aspect = lw/170; previa.cam.updateProjectionMatrix();
  if (previa.g) previa.c.remove(previa.g);
  previa.g = new THREE.Group(); montarBoneco(previa.g, '', rascunhoAv); previa.c.add(previa.g);
}
function girarPrevia(t){ if (previa && previa.g && editandoAvatar) { previa.g.rotation.y = Math.sin(t*0.8)*0.9; previa.r.render(previa.c, previa.cam); } }
function painelAvatar(){
  editandoAvatar = true;
  var eu = DADOS.eu || {};
  if (!rascunhoAv) rascunhoAv = eu.avatar ? JSON.parse(JSON.stringify(eu.avatar)) : { pele:AVATAR_OPC.pele[0], roupa:AVATAR_OPC.roupa[3], cabelo:'curto', corCabelo:AVATAR_OPC.corCabelo[0], acessorio:'nenhum' };
  var h = '<h2>Meu avatar</h2><div class="vazio">' + (eu.nome ? 'Assim você (' + esc(eu.nome.split(' ')[0]) + ') aparece no mapa quando estiver de plantão. Quem não escolhe aparece cinza.' : '') + '</div>';
  h += '<div id="av-previa" class="av-previa"></div>';
  Object.keys(AVATAR_OPC).forEach(function(k){
    h += '<h2>' + ROTULOS_AV[k] + '</h2><div class="av-opc">';
    AVATAR_OPC[k].forEach(function(v){
      var sel = rascunhoAv[k] === v ? ' sel' : '';
      if (v.charAt(0) === '#') h += '<button class="av-cor' + sel + '" data-k="' + k + '" data-v="' + v + '" style="background:' + v + '" aria-label="' + ROTULOS_AV[k] + ' ' + v + '"></button>';
      else h += '<button class="av-txt' + sel + '" data-k="' + k + '" data-v="' + v + '">' + (NOMES_OPC[v] || v) + '</button>';
    });
    h += '</div>';
  });
  h += '<div class="av-acoes"><button class="btn" id="av-cancelar">Cancelar</button><button class="btn av-salvar" id="av-salvar">Salvar</button></div><div id="av-status" class="vazio"></div>';
  var p = document.getElementById('painel'); var rolagem = editandoAvatar && p.querySelector('#av-previa') ? p.scrollTop : 0; p.innerHTML = h; p.scrollTop = rolagem;
  Array.prototype.forEach.call(p.querySelectorAll('[data-k]'), function(b){ b.onclick = function(){ rascunhoAv[b.getAttribute('data-k')] = b.getAttribute('data-v'); painelAvatar(); }; });
  document.getElementById('av-cancelar').onclick = fecharAvatar;
  document.getElementById('av-salvar').onclick = salvarAvatar;
  desenharPrevia();
}
function fecharAvatar(){ editandoAvatar = false; rascunhoAv = null; falando = false; painelGeral(); }
function salvarAvatar(){
  var st = document.getElementById('av-status'), bt = document.getElementById('av-salvar');
  bt.disabled = true; st.textContent = 'Salvando...';
  fetch('/api/mapa?avatar=1', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ avatar: rascunhoAv }) })
    .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(x){
      if (!x.ok) { st.textContent = x.j.error || 'Não deu para salvar.'; bt.disabled = false; return; }
      if (DADOS.eu) DADOS.eu.avatar = x.j.avatar;
      editandoAvatar = false; rascunhoAv = null; falando = false; buscar();
    })
    .catch(function(){ st.textContent = 'Sem conexão com o Pulse.'; bt.disabled = false; });
}
// ── Falar com a central (só gestor): recado falado em voz alta pela Echo da central, via /api/avisar-central ──
// Regras no servidor (avisar-central.js): só gestor ativo, até MAX_RECADO caracteres, sem emoji/símbolos, falado como
// "Recado do Pulse, de <primeiro nome>. <recado>".
var FALAR = __FALAR__;
var falando = false;
function painelFalar(){
  if (!FALAR) return;
  editandoAvatar = false; rascunhoAv = null; falando = true;
  var h = '<h2>Falar com a central</h2><div class="vazio">O recado é falado em voz alta pela Echo da central, começando com "Recado do Pulse, de" e o seu primeiro nome.</div>';
  h += '<textarea id="falar-texto" class="falar-texto" maxlength="' + FALAR.max + '" placeholder="Ex.: Rafael, me liga quando puder."></textarea>';
  h += '<div class="av-opc">' + FALAR.prontos.map(function(t){ return '<button class="av-txt falar-pronto">' + esc(t) + '</button>'; }).join('') + '</div>';
  h += '<div class="av-acoes"><span class="vazio" id="falar-conta" style="flex:1">0/' + FALAR.max + '</span><button class="btn" id="falar-fechar">Fechar</button><button class="btn av-salvar" id="falar-enviar">Falar na central</button></div><div id="falar-status" class="vazio"></div>';
  var p = document.getElementById('painel'); p.innerHTML = h; p.scrollTop = 0;
  var tx = document.getElementById('falar-texto'), conta = document.getElementById('falar-conta'), st = document.getElementById('falar-status'), bt = document.getElementById('falar-enviar');
  function atualiza(){ conta.textContent = tx.value.length + '/' + FALAR.max; }
  tx.oninput = atualiza;
  Array.prototype.forEach.call(p.querySelectorAll('.falar-pronto'), function(b){ b.onclick = function(){ tx.value = b.textContent; atualiza(); tx.focus(); }; });
  document.getElementById('falar-fechar').onclick = function(){ falando = false; painelGeral(); };
  bt.onclick = function(){
    var t = tx.value.trim(); if (!t) { st.style.color = 'var(--red)'; st.textContent = 'Escreva o recado.'; return; }
    bt.disabled = true; st.style.color = ''; st.textContent = 'Enviando...';
    fetch('/api/avisar-central', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ texto: t }) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(x){ if (x.ok) { st.style.color = 'var(--grn)'; st.textContent = 'Enviado. A Echo vai falar: "' + x.j.falado + '"'; tx.value = ''; atualiza(); } else { st.style.color = 'var(--red)'; st.textContent = x.j.error || 'Falhou.'; } })
      .catch(function(){ st.style.color = 'var(--red)'; st.textContent = 'Sem conexão com o Pulse.'; })
      .then(function(){ bt.disabled = false; });
  };
  tx.focus();
}
var flBtn = document.getElementById('falar-btn'); if (flBtn) flBtn.onclick = function(){ if (modoEle) mostrarEletrica(false); painelFalar(); };
if (FALAR && location.search.indexOf('falar=1') >= 0) setTimeout(painelFalar, 300);   // veio do link antigo /api/avisar-central
var avBtn = document.getElementById('avatar-btn'); if (avBtn) avBtn.onclick = function(){ if (modoEle) mostrarEletrica(false); painelAvatar(); };

function aplicar(d){ DADOS = d; document.getElementById('relogio').textContent = d.agora; sincronizarPessoas(); sincronizarEstado(); if (!modoEle && !editandoAvatar && !falando) painelGeral(); }
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

export function paginaMapa({ isGestor = false, demo = null, racks = null } = {}) {
  const script = CLIENTE.replace('__SALAS__', JSON.stringify(SALAS)).replace('__DEMO__', demo ? JSON.stringify(demo) : 'null').replace('__RACKS__', racks && racks.length ? JSON.stringify(racks) : 'null').replace('__AVATAR_OPC__', JSON.stringify(AVATAR_OPC)).replace('__FALAR__', JSON.stringify(isGestor ? { prontos: RECADOS_PRONTOS, max: MAX_RECADO } : null));
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mapa 3D — Pulse</title><meta name="theme-color" content="#0b1020">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.json">
<style>${CSS}</style></head><body>
<div id="topo"><h1>Mapa 3D</h1><span class="sub">central ao vivo</span><span class="sp"></span>${isGestor && !demo ? '<button class="btn btn-falar" id="falar-btn" title="Recado falado em voz alta pela Echo da central">&#128227; <span class="rot">Falar com a central</span></button>' : ''}${demo ? '' : '<button class="btn" id="avatar-btn" title="Escolher como você aparece no mapa">&#129485; Meu avatar</button>'}<span class="clima" id="clima"></span><span class="relogio" id="relogio">--:--</span>
  <div class="menu"><button class="btn" id="menu-btn" aria-label="Menu">&#9776;</button><div class="lista">${menuItens(isGestor, { classe: '' })}</div></div></div>
<div id="cena"></div><div id="painel"></div><div id="olha" hidden></div><div id="joy" aria-label="Andar"><div id="joy-pino"></div></div><button class="btn" id="fechar-painel" aria-label="Fechar painel">&#10005;</button><div id="dica">Arraste = girar · Shift/botão direito = mover · roda = zoom · clique numa sala</div>
<div id="atalhos"><button class="btn btn-passear" id="passear-btn">&#128694; Passear</button><button class="btn btn-mostrar" id="mostrar-btn">&#128205; Mostrar para a central</button><button class="btn" data-vai="geral">Visão geral</button><button class="btn" data-vai="central">Central</button><button class="btn" data-vai="playout">Playout</button><button class="btn" data-vai="estudio1">Estúdio 1</button><button class="btn" data-vai="estudio2">Estúdio 2</button><button class="btn" data-vai="cpd">CPD</button><button class="btn" data-vai="eletrica">&#9889; Elétrica</button></div>
<div id="erro"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/renderers/CSS3DRenderer.js"></script>
<script>${script}</script></body></html>`;
}

// pro worker.js (rota /api/presenca, fora do adaptador): mesma checagem de sessão, a partir do cabeçalho Cookie
export function sessaoDoCookie(cookie) { return getSession({ headers: { cookie } }); }

// ── Handler ─────────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.query.dados) return res.status(401).json({ error: 'Não autenticado' });
    return res.redirect(302, '/api/app');
  }
  // POST ?avatar=1 → grava o avatar de QUEM ESTÁ LOGADO (nunca o de outra pessoa)
  if (req.method === 'POST') {
    if (!req.query.avatar) return res.status(400).json({ error: 'Pedido inválido' });
    const av = validarAvatar(req.body && req.body.avatar);
    if (!av) return res.status(400).json({ error: 'Avatar inválido' });
    try { await salvarAvatar(session.nome, av); return res.status(200).json({ ok: true, avatar: av }); }
    catch (e) { console.error('mapa: falha ao salvar avatar', e && e.message); return res.status(503).json({ error: 'Não consegui salvar agora. Tente de novo.' }); }
  }
  if (req.query.dados) {
    try {
      const [d, avatares] = await Promise.all([montarDados(), getAvatares()]);
      d.pessoas.forEach(p => { const a = avatares.get(norm(p.nome)) || (p.completo && avatares.get(norm(p.completo))); if (a) p.avatar = a; });
      const meu = avatares.get(norm(session.nome));
      return res.status(200).json({ ...d, eu: { nome: session.nome, avatar: meu || null } });
    }
    catch (e) { return res.status(500).json({ error: 'Falha ao montar o mapa' }); }
  }
  const equipe = await getSheet('Equipe!A2:L200');
  const isGestor = equipe.find(r => r[0] === session.nome)?.[8] === 'gestor';
  const racks = await getRacks();
  if (req.query.racks) return res.status(200).json({ gestor: isGestor, racks: racksDetalhes(racks, isGestor) });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(paginaMapa({ isGestor, racks: racksLayout(racks) }));
}
