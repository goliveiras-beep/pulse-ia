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
  { id: 'ext',      nome: 'EXT (externas)', tipo: 'ext', x: 22,   z: 24,   w: 14,   d: 10 },
  { id: 'nuvem',    nome: 'Nuvem · sem narração', tipo: 'nuvem', x: 9, z: 35, w: 13, d: 8, elev: 12 },   // lives "[SEM NARRAÇÃO]" produzidas na nuvem
];

// Texto do Airtable ("Padrão de Produção") / alocação do equipamento → id da sala (ou null)
export function salaDoTexto(t) {
  const s = String(t || '');
  if (/sem\s*narra|nuvem|cloud/i.test(s)) return 'nuvem';
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

// Toda a equipe escalada nos eventos de hoje, já com a sala onde fica. NINGUÉM some do mapa por o evento não estar no ar:
// quem está parado (evento ainda não começou, ou já terminou) continua à vista, pra dar pra ver buraco de equipe e pedir
// substituição. Cada pessoa fica na sala do evento mais relevante dela: no ar > o próximo > o último que fez.
export function pessoasDasOperacoes(ops, brt, agoraMin) {
  const dia = brt.getDate() + '/' + (brt.getMonth() + 1) + '/' + brt.getFullYear();
  const aoVivo = new Set(), eventosAr = new Set(), melhor = new Map();
  for (const e of (ops && ops.events) || []) {
    if (!String(e.data || '').startsWith(dia + ' ')) continue;
    if (/cancel/i.test(e.nome || '') || /cancel/i.test(e.status || '')) continue;
    const ini = toMin(e.horario); let fim = toMin(e.fimPrevisto);
    if (ini == null) continue;
    if (fim == null) fim = ini + 60; else if (fim <= ini) fim += 1440;
    const noAr = /acontecendo/i.test(e.status || '') || (agoraMin >= ini && agoraMin < fim);
    const antes = !noAr && agoraMin < ini;
    // Compacto roda só do Playout: mesmo com o estúdio em branco no sistema de Operações, a sala é o Playout
    const sala = salaDoTexto(e.studio) || (/sem\s*narra/i.test(e.nome || '') ? 'nuvem' : null) || (/^\s*compacto/i.test(e.nome || '') ? 'playout' : null), ctrl = controleDoTexto(e.studio);
    if (noAr) { if (sala) aoVivo.add(sala); if (ctrl) aoVivo.add(ctrl); eventosAr.add(norm(e.nome)); }
    const eq = e.equipe || {};
    const salaSW = ctrl || sala, salaEst = sala || ctrl;
    // quanto menor o rank, mais relevante: no ar (0) < próximo (1000 + minutos até começar) < já terminou (5000 + minutos desde o fim)
    const rank = noAr ? 0 : antes ? 1000 + (ini - agoraMin) : 5000 + Math.max(0, agoraMin - fim);
    const estado = noAr ? 'no ar' : antes ? 'começa ' + e.horario : 'livre desde ' + (e.fimPrevisto || '');
    const add = (nome, funcao, salaId, posto) => {
      if (!nome || !salaId) return;
      const chave = norm(nome), atual = melhor.get(chave);
      if (atual && atual.rank <= rank) return;
      melhor.set(chave, { rank, p: { nome: nomeCurto(nome), completo: nome, sala: salaId, funcao, sub: funcao === 'Áudio' ? 'audio' : '', posto: posto || '', evento: e.nome, origem: 'operacoes', estado, turno: (e.horario || '') + '–' + (e.fimPrevisto || '') } });
    };
    for (const [k, v] of Object.entries(eq.sw || {})) add(v, FUNCOES[k] || k, SALA_FIXA[k] || salaSW, k);
    for (const [k, v] of Object.entries(eq.estudio || {})) add(v, FUNCOES[k] || k, SALA_FIXA[k] || salaEst, k);
    if (eq.playout) add(eq.playout, 'Playout/MCR', 'playout', 'playout');
  }
  const pessoas = [...melhor.values()].map(x => x.p);
  return { pessoas, aoVivo: [...aoVivo], eventosAr };
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

  const ops = pessoasDasOperacoes(opsRaw, brt, agoraMin);
  // link da live: o do Airtable; se faltar, o que o sistema de Operações tiver pro mesmo evento
  const ytOps = new Map(((opsRaw && opsRaw.events) || []).filter(x => x.urlYoutube).map(x => [norm(x.nome), x.urlYoutube]));
  const eventos = eventosRaw.map(e => ({
    nome: e.nome, sala: salaDoTexto(e.local) || (/sem\s*narra/i.test(e.nome || '') ? 'nuvem' : null) || (/playout/i.test(e.tipo || '') || /^\s*compacto/i.test(e.nome || '') ? 'playout' : null), controle: controleDoTexto(e.local), local: e.local, tipo: e.tipo,
    plataformas: e.plataformas || [], youtube: e.youtube || linkYoutube(ytOps.get(norm(e.nome))),
    inicio: hhmm(e.ini), fim: e.fim != null ? hhmm(e.fim) : '',
    // no ar pelo horário do Airtable OU porque o sistema de Operações já marcou o evento como no ar (os horários podem diferir uns minutos)
    noAr: (e.fim != null ? (agoraMin >= e.ini && agoraMin < e.fim) : false) || ops.eventosAr.has(norm(e.nome)),
    // mesma regra da página inicial do Pulse: encerrado 30 min depois do fim (sem fim: 30 min depois do início)
    encerrado: !ops.eventosAr.has(norm(e.nome)) && (e.fim != null ? agoraMin > e.fim + 30 : e.ini < agoraMin - 30),
  })).sort((a, b) => a.inicio.localeCompare(b.inicio));
  eventos.forEach(e => { e.youtubeId = idYoutube(e.youtube); });

  const locEquip = new Map(equipRaw.filter(r => r[0]).map(r => [r[0], { nome: r[2] || '', alocacao: r[6] || '' }]));
  const chamados = chamadosRaw.filter(r => r[0] && !/conclu|resolv|fecha|cancel/i.test(r[6] || 'Aberto')).map(r => {
    const eq = locEquip.get(r[1]) || { nome: r[2] || '', alocacao: '' };
    return { id: r[0], equipamento: r[2] || eq.nome, problema: r[3] || '', prioridade: r[4] || 'Baixa', status: r[6] || 'Aberto',
      sala: salaDoTexto(eq.alocacao) || salaDoTexto(r[5]) || null };
  });

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
.sp{flex:1}.alerta-temp{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:30;background:#ffb020;color:#1a1204;font:800 14px system-ui,sans-serif;padding:8px 16px;border-radius:12px;box-shadow:0 6px 24px #0008;max-width:92vw;text-align:center;animation:pisca 1.6s ease-in-out infinite}.alerta-temp.crit{background:#ff4d5e;color:#fff}.alerta-temp.zbx{top:112px;background:#e97659;color:#fff}.alerta-temp.zbx.crit{background:#e45959}@keyframes pisca{0%,100%{opacity:1}50%{opacity:.72}}.btn-leve{background:#0b1020e6;color:#e8edf8;border:1px solid #2b3556;border-radius:10px;padding:5px 9px;font:700 13px system-ui,sans-serif;cursor:pointer}.btn-leve.on{background:#e5a30a;color:#111;border-color:#e5a30a}.clima{color:var(--mut);font-size:12px;white-space:nowrap}@media (max-width:700px){.clima{display:none}}.relogio{font:600 15px ui-monospace,Consolas,monospace;color:var(--acc)}
.btn{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.btn:hover{border-color:var(--acc)}
.menu{position:relative}.menu .lista{display:none;position:absolute;right:0;top:38px;min-width:230px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 10px 30px #0008}
.menu.aberto .lista{display:block}.menu a,.menu button.menu-item{display:block;color:var(--text);text-decoration:none;padding:8px 10px;border-radius:6px;font-size:13px}.menu a:hover{background:var(--panel2)}
#cena{position:fixed;inset:0}#cena canvas{display:block;width:100%;height:100%;touch-action:none;-webkit-user-select:none;user-select:none}
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
.tv3d-cartela{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:36px 40px 0;text-align:center;background:linear-gradient(135deg,#1a0b14,#4a0f1f 55%,#1a0b14);color:#fff}.tv3d-cartela small{font:700 24px system-ui,sans-serif;letter-spacing:5px;color:#ff8a98}.tv3d-cartela b{font:800 38px/1.15 system-ui,sans-serif}
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
  else if (e.noAr && e.plataformas && e.plataformas.some(function(p){ return /youtube/i.test(p); })) { h += '<small style="color:#ffb020">Sem link do YouTube no Airtable (campo URL YouTube) — por isso a TV não aparece</small>'; }
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
// Modo leve (TVs, computadores fracos): sem sombras, sem suavização de borda, resolução limitada, sem vídeo embutido, 30 quadros/s
// e cidade menor. Liga sozinho em navegador de TV; ?leve=1 liga, ?leve=0 desliga (fica lembrado) e o botão ⚡ do topo alterna.
var MANUAL = false;
var NIVEL = (function(){
  var q = (location.search.match(/[?&]leve=([0-2])/) || [])[1];
  if (q != null) { try { localStorage.setItem('mapa-leve', q); localStorage.setItem('mapa-leve-manual', '1'); } catch(e){} MANUAL = true; return +q; }
  try { MANUAL = localStorage.getItem('mapa-leve-manual') === '1'; var s = localStorage.getItem('mapa-leve'); if (s === '0' || s === '1' || s === '2') return +s; } catch(e){}
  if (/SMART-TV|SmartTV|Tizen|Web0S|WebOS|NetCast|HbbTV|BRAVIA|AFT[A-Z]|CrKey|Roku|VIDAA|Hisense|Android TV|GoogleTV|AppleTV|Chromecast|Philips|TCL|Xbox|PlayStation|Silk/i.test(navigator.userAgent)) return 2;
  var semMouse = window.matchMedia && matchMedia('(hover: none)').matches && !('ontouchstart' in window) && !(navigator.maxTouchPoints > 0);
  if (semMouse) return 2;
  return ((navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2) ? 1 : 0;
})();
var LEVE = NIVEL > 0;
// Nível 2: material Lambert no lugar do PBR (Standard), que pesa bem menos em GPU de TV. Troca na fábrica, antes de qualquer material nascer.
if (NIVEL >= 2) {
  THREE.MeshStandardMaterial = function(p){ var q = {}; for (var k in (p || {})) { if (k !== 'roughness' && k !== 'metalness' && k !== 'envMapIntensity' && k !== 'normalMap' && k !== 'normalScale') q[k] = p[k]; } return new THREE.MeshLambertMaterial(q); };
}
var renderer = new THREE.WebGLRenderer({ antialias:!LEVE, powerPreference:'high-performance' });
renderer.setPixelRatio(LEVE ? 1 : Math.min(window.devicePixelRatio||1, 2));
renderer.shadowMap.enabled = !LEVE; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
el.appendChild(renderer.domElement);
var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
var css3 = (THREE.CSS3DRenderer && !LEVE) ? new THREE.CSS3DRenderer() : null;   // TVs com vídeo (se o script não carregar, o mapa segue sem TV)
if (css3) { css3.domElement.id = 'cena-tv'; document.body.appendChild(css3.domElement); }

var hemi = new THREE.HemisphereLight(0xcfe3ff, 0x202840, 0.85); cena.add(hemi);
var sol = new THREE.DirectionalLight(0xffffff, 0.75);
sol.position.set(-20, 40, 10); sol.castShadow = !LEVE;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.left=-40; sol.shadow.camera.right=40; sol.shadow.camera.top=50; sol.shadow.camera.bottom=-20; sol.shadow.camera.far=120;
cena.add(sol);
var luaLuz = new THREE.DirectionalLight(0xa9c2ff, 0); luaLuz.position.set(-60, 300, -120); cena.add(luaLuz);

var chao = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({ color:0x0f162b, roughness:1 }));
chao.rotation.x = -Math.PI/2; chao.position.set(10,-0.06,20); chao.receiveShadow = true; cena.add(chao);

// ── Entorno: Botafogo (Rio) — a Livemode · CazéTV fica num prédio de 5 andares em Botafogo ──
// A planta da central é o 5º andar (teto aberto, como casa de bonecas). Embaixo: térreo com portaria e 3 andares de
// escritório. Em volta: quarteirões de Botafogo (prédios com varanda, empena cega, comércio no térreo), ruas com faixa,
// carros, árvores; ao fundo a enseada, Pão de Açúcar e Urca (leste), Corcovado com o Cristo (oeste), Aterro e Santos Dumont (norte).
// Céu pela HORA de Brasília e TEMPO real de Botafogo (open-meteo). Pra simular: ?hora=18.5&tempo=sol|nublado|chuva|tempestade|neblina&temp=31
var ANDAR = 3.4, TERREO = -4*ANDAR;
var RIO = new THREE.Group(); RIO.position.y = TERREO; cena.add(RIO);
var PARAM = {}; location.search.replace('?', '').split('&').forEach(function(p){ var kv = p.split('='); if (kv[0]) PARAM[kv[0]] = decodeURIComponent(kv[1] || ''); });
var SEMENTE = 17; function sorte(){ SEMENTE = (SEMENTE*9301 + 49297) % 233280; return SEMENTE/233280; }
var MATS_NOITE = [], MATS_FACH = [];
var CELULAR = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
var ANISO = LEVE ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy());
function tela(S, S2){ var c = document.createElement('canvas'); c.width = S; c.height = S2 || S; return c; }
function texDe(c){ var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; return t; }
function ruido(k, S, n, a){ for (var i = 0; i < n; i++) { k.fillStyle = 'rgba(' + (sorte() < 0.5 ? '0,0,0,' : '255,255,255,') + (sorte()*a).toFixed(3) + ')'; k.fillRect(sorte()*S, sorte()*S, 1 + sorte()*2, 1 + sorte()*2); } }

// ── Fachadas: textura de 4 vãos x 4 andares (vão 3,6 m; andar 3,1 m), com mapa de janelas acesas pra noite ──
var VAO = 3.6, PE = 3.1;
function texFachada3(est, P){
  var S = 512, C = S/4, c = tela(S), k = c.getContext('2d'), e = tela(256), q = e.getContext('2d');
  q.fillStyle = '#000'; q.fillRect(0, 0, 256, 256);
  k.fillStyle = P.parede; k.fillRect(0, 0, S, S);
  for (var m = 0; m < 46; m++) { k.fillStyle = 'rgba(40,30,20,' + (0.02 + sorte()*0.05).toFixed(3) + ')'; k.fillRect(sorte()*S, 0, 2 + sorte()*12, S); }
  function vidro(x, y, w, h, chance){
    var g = k.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, P.vidro1 || '#a9c9de'); g.addColorStop(1, P.vidro2 || '#2f4558');
    k.fillStyle = g; k.fillRect(x, y, w, h);
    k.fillStyle = 'rgba(0,0,0,' + (sorte()*0.38).toFixed(3) + ')'; k.fillRect(x, y, w, h);
    if (sorte() < 0.4) { k.fillStyle = 'rgba(235,228,210,' + (0.35 + sorte()*0.4).toFixed(2) + ')'; k.fillRect(x + (sorte() < 0.5 ? 0 : w*0.55), y, w*0.45, h); }
    if (sorte() < chance) { q.fillStyle = sorte() < 0.8 ? '#ffd9a0' : '#cfe4ff'; q.fillRect(x/2, y/2, w/2, h/2); }
  }
  for (var f = 0; f < 4; f++) for (var b = 0; b < 4; b++) {
    var x = b*C, y = f*C;
    if (est === 'varanda') {
      k.fillStyle = '#15191e'; k.fillRect(x + 6, y + 12, C - 12, C - 16);
      vidro(x + 14, y + 20, C - 28, C - 30, 0.42);
      k.fillStyle = '#e9e6de'; k.fillRect(x + 62, y + 20, 3, C - 30);
      if (sorte() < 0.3) { k.fillStyle = '#d8dadc'; k.fillRect(x + 12, y + 16, 26, 14); k.fillStyle = '#9a9d9f'; k.fillRect(x + 15, y + 19, 20, 8); }
      if (sorte() < 0.35) { k.fillStyle = '#3c7a3e'; k.beginPath(); k.arc(x + 20 + sorte()*80, y + C - 44, 9 + sorte()*5, 0, 7); k.fill(); }
      if (P.guardaVidro) { k.fillStyle = 'rgba(150,200,215,0.62)'; k.fillRect(x + 4, y + C - 44, C - 8, 38); k.fillStyle = '#dfe3e6'; k.fillRect(x + 4, y + C - 46, C - 8, 3); }
      else { k.fillStyle = P.guarda; k.fillRect(x + 4, y + C - 42, C - 8, 36); k.fillStyle = 'rgba(0,0,0,0.18)'; k.fillRect(x + 4, y + C - 10, C - 8, 4); }
      k.fillStyle = P.det; k.fillRect(x, y + C - 6, C, 6); k.fillStyle = 'rgba(0,0,0,0.35)'; k.fillRect(x + 6, y + 12, C - 12, 5);
    } else if (est === 'janela') {
      k.fillStyle = P.det; k.fillRect(x + 20, y + 26, C - 40, 62);
      vidro(x + 24, y + 30, C - 48, 54, 0.4);
      k.fillStyle = P.det; k.fillRect(x + 62, y + 30, 4, 54); k.fillRect(x + 16, y + 88, C - 32, 5);
      k.fillStyle = 'rgba(0,0,0,0.22)'; k.fillRect(x + 20, y + 93, C - 40, 3);
      if (sorte() < 0.45) { k.fillStyle = '#cfd2d4'; k.fillRect(x + 46, y + 98, 34, 20); k.fillStyle = '#8f9396'; k.fillRect(x + 50, y + 102, 26, 12); }
      if (b === 0) { k.fillStyle = 'rgba(0,0,0,0.10)'; k.fillRect(x, y, 2, C); }
    } else if (est === 'fita') {
      k.fillStyle = P.det; k.fillRect(x, y + C - 50, C, 50);
      k.fillStyle = 'rgba(0,0,0,0.25)'; k.fillRect(x, y + C - 50, C, 3);
      vidro(x + 2, y + 6, C/2 - 4, C - 58, 0.5); vidro(x + C/2 + 2, y + 6, C/2 - 4, C - 58, 0.5);
      k.fillStyle = '#2a2e33'; k.fillRect(x, y, C, 6);
    } else if (est === 'cortina') {
      vidro(x + 2, y + 2, C/2 - 3, C - 30, 0.55); vidro(x + C/2 + 1, y + 2, C/2 - 3, C - 30, 0.55);
      k.fillStyle = P.det; k.fillRect(x, y + C - 28, C, 28);
      k.fillStyle = 'rgba(255,255,255,0.10)'; k.fillRect(x, y + C - 28, C, 2);
      k.fillStyle = P.perfil || '#c9ced4'; k.fillRect(x, y, 3, C); k.fillRect(x + C/2 - 1, y, 2, C - 28);
    } else {
      if (b === 1) { k.fillStyle = P.det; k.fillRect(x + 40, y + 34, 48, 48); vidro(x + 44, y + 38, 40, 40, 0.3); }
      k.fillStyle = 'rgba(0,0,0,0.10)'; k.fillRect(x, y + C - 2, C, 2);
    }
  }
  if (est === 'empena') for (var j = 0; j < 14; j++) { var gx = sorte()*S, gg = k.createLinearGradient(0, 0, 0, S*0.7); gg.addColorStop(0, 'rgba(30,25,20,0.20)'); gg.addColorStop(1, 'rgba(30,25,20,0)'); k.fillStyle = gg; k.fillRect(gx, 0, 6 + sorte()*26, S*0.7); }
  ruido(k, S, 5000, 0.07);
  if (LEVE) { var c2 = tela(256), e2 = tela(128); c2.getContext('2d').drawImage(c, 0, 0, 256, 256); e2.getContext('2d').drawImage(e, 0, 0, 128, 128); return [texDe(c2), texDe(e2)]; }
  return [texDe(c), texDe(e)];
}
function matFachada3(tx, maxNoite, extra){
  var o = { map:tx[0], emissive:0xffd28a, emissiveMap:tx[1], emissiveIntensity:0, roughness:0.82, metalness:0.04 };
  if (extra) for (var kx in extra) o[kx] = extra[kx];
  var m = new THREE.MeshStandardMaterial(o); MATS_NOITE.push([m, maxNoite || 0.8]); MATS_FACH.push(m); return m;
}
// caixa com a base no chão e UV em "vãos x andares" (a textura repete a cada 4 vãos e 4 andares)
function caixaUV(w, h, d, nw, nd, na){
  var g = new THREE.BoxGeometry(w, h, d); g.translate(0, h/2, 0);
  var uv = g.attributes.uv;
  for (var i = 0; i < uv.count; i++) { var face = Math.floor(i/4);
    if (face < 2) uv.setXY(i, uv.getX(i)*nd/4, uv.getY(i)*na/4);
    else if (face > 3) uv.setXY(i, uv.getX(i)*nw/4, uv.getY(i)*na/4);
    else uv.setXY(i, uv.getX(i)*w/8, uv.getY(i)*d/8); }
  return g;
}
// lote de caixas simples (um único desenho pra milhares): L.add(w,h,d,cor,x,yBase,z,giro)
function lote(){ var L = []; L.add = function(w, h, d, cor, x, y, z, ry){ L.push([w, h, d, cor, x, y, z, ry || 0]); }; return L; }
function montarLote(L, material, sombra){
  if (!L.length) return null;
  var g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
  var im = new THREE.InstancedMesh(g, material, L.length), o = new THREE.Object3D(), cor = new THREE.Color();
  L.forEach(function(b, i){ o.position.set(b[4], b[5], b[6]); o.rotation.set(0, b[7], 0); o.scale.set(b[0], b[1], b[2]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, cor.setHex(b[3])); });
  im.frustumCulled = false; im.castShadow = sombra !== false; im.receiveShadow = true; RIO.add(im); return im;
}
var BX = lote(), LUZ = lote();
function juntar(lista){
  var pos = [], nor = [];
  lista.forEach(function(g){ var n = g.index ? g.toNonIndexed() : g; Array.prototype.push.apply(pos, n.attributes.position.array); Array.prototype.push.apply(nor, n.attributes.normal.array); });
  var r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return r;
}
function poligono(pts, material, y){
  var s = new THREE.Shape(); pts.forEach(function(p, i){ if (i) s.lineTo(p[0], -p[1]); else s.moveTo(p[0], -p[1]); });
  var m = new THREE.Mesh(new THREE.ShapeGeometry(s), material); m.rotation.x = -Math.PI/2; m.position.y = y; m.receiveShadow = true; RIO.add(m); return m;
}

// ── O prédio da Livemode · CazéTV ──
var PF = { x0:-1.5, x1:38.5, z0:-1.5, z1:54 };
var PW = PF.x1 - PF.x0, PD = PF.z1 - PF.z0, PCX = (PF.x0 + PF.x1)/2, PCZ = (PF.z0 + PF.z1)/2;
chao.geometry = new THREE.PlaneGeometry(PW, PD); chao.position.set(PCX, -0.06, PCZ);
chao.material.color.setHex(0x3b4150);
var ALT_LM = -TERREO - 0.3;
(function(){
  var tx = texFachada3('cortina', { parede:'#22303f', vidro1:'#9cc4e0', vidro2:'#1d3a55', det:'#1a2430', perfil:'#d4d9df' });
  var fach = matFachada3(tx, 0.9, { roughness:0.25, metalness:0.35 }), laje = mat(0xd9dde3);
  var corpo = new THREE.Mesh(caixaUV(PW, ALT_LM, PD, Math.round(PW/VAO), Math.round(PD/VAO), 4), [fach, fach, laje, laje, fach, fach]);
  corpo.position.set(PCX, 0, PCZ); corpo.castShadow = true; corpo.receiveShadow = true; RIO.add(corpo);
  // faixas de laje em cada andar e pilares de granito no térreo: dão relevo e sombra de verdade na fachada
  var pe = ALT_LM/4;
  for (var a = 1; a <= 3; a++) {
    BX.add(PW + 0.6, 0.4, 0.3, 0xe4e7ea, PCX, a*pe - 0.2, PF.z0 - 0.15); BX.add(PW + 0.6, 0.4, 0.3, 0xe4e7ea, PCX, a*pe - 0.2, PF.z1 + 0.15);
    BX.add(0.3, 0.4, PD + 0.6, 0xe4e7ea, PF.x0 - 0.15, a*pe - 0.2, PCZ); BX.add(0.3, 0.4, PD + 0.6, 0xe4e7ea, PF.x1 + 0.15, a*pe - 0.2, PCZ);
  }
  for (var px = PF.x0; px <= PF.x1 + 0.1; px += PW/6) { BX.add(1.0, pe, 0.5, 0x3a3d42, px, 0, PF.z0 - 0.2); BX.add(1.0, pe, 0.5, 0x3a3d42, px, 0, PF.z1 + 0.2); }
  for (var pz = PF.z0; pz <= PF.z1 + 0.1; pz += PD/8) { BX.add(0.5, pe, 1.0, 0x3a3d42, PF.x0 - 0.2, 0, pz); BX.add(0.5, pe, 1.0, 0x3a3d42, PF.x1 + 0.2, 0, pz); }
  [[PF.x0, PF.z0], [PF.x1, PF.z0], [PF.x0, PF.z1], [PF.x1, PF.z1]].forEach(function(q){ BX.add(1.1, ALT_LM, 1.1, 0xe4e7ea, q[0], 0, q[1]); });
  // borda da laje do 5º andar + guarda-corpo de vidro (deixa ver a planta de qualquer ângulo)
  [[PW+0.6, 0.6, PCX, PF.z0], [PW+0.6, 0.6, PCX, PF.z1]].forEach(function(b){ caixa(b[0], 0.45, b[1], 0xe9ecf0, b[2], -0.4, b[3]); });
  [[0.6, PD, PF.x0, PCZ], [0.6, PD, PF.x1, PCZ]].forEach(function(b){ caixa(b[0], 0.45, b[1], 0xe9ecf0, b[2], -0.4, b[3]); });
  var vidro = new THREE.MeshStandardMaterial({ color:0x9fd3ff, transparent:true, opacity:0.18, roughness:0.05, metalness:0.2, depthWrite:false });
  [[PW, 0.04, PCX, PF.z0-0.25], [PW, 0.04, PCX, PF.z1+0.25], [0.04, PD, PF.x0-0.25, PCZ], [0.04, PD, PF.x1+0.25, PCZ]].forEach(function(b){
    var v = new THREE.Mesh(new THREE.BoxGeometry(b[0], 1.1, b[1]), vidro); v.position.set(b[2], 0.55, b[3]); cena.add(v); });
  // portaria (norte): saguão envidraçado iluminado, marquise com forro escuro, pilares, degrau e vasos
  caixa(13, 3.0, 0.3, 0x1b2433, PCX, TERREO, PF.z0 - 0.5, cena, { emissive:0xffe2a8, emissiveIntensity:0.3, roughness:0.1, metalness:0.4 });
  BX.add(17, 0.45, 4.2, 0xf2f4f7, PCX, pe - 0.05, PF.z0 - 2.3); BX.add(16.6, 0.1, 3.9, 0x23272d, PCX, pe - 0.15, PF.z0 - 2.3);
  for (var c2 = 0; c2 < 4; c2++) BX.add(0.35, pe, 0.35, 0xc5cad1, PCX - 7.5 + c2*5, 0, PF.z0 - 4.0);
  BX.add(15, 0.18, 4.6, 0x8d9096, PCX, 0, PF.z0 - 2.5);
  [-8.6, 8.6].forEach(function(dx){ BX.add(1.3, 0.8, 1.3, 0x5b5f66, PCX + dx, 0, PF.z0 - 3.6); BX.add(1.0, 0.9, 1.0, 0x2f7d3f, PCX + dx, 0.8, PF.z0 - 3.6); });
  // placas escuras atrás dos letreiros (leitura boa de dia)
  BX.add(32, 2.7, 0.2, 0x10151c, PCX, ALT_LM - 3.3, PF.z0 - 0.3); BX.add(0.2, 2.7, 36, 0x10151c, PF.x1 + 0.3, ALT_LM - 3.3, PCZ);
  BX.add(32, 2.7, 0.2, 0x10151c, PCX, ALT_LM - 3.3, PF.z1 + 0.3); BX.add(0.2, 2.7, 36, 0x10151c, PF.x0 - 0.3, ALT_LM - 3.3, PCZ);
})();
// Marca da Livemode (arte oficial baixada de livemode.com/livemode-logo.png) e paleta do site: verde #12d112, fundo #0E0E0C, texto #F0EDE8.
var LM = { verde:'#12d112', verdeHex:0x12d112, fundo:'#0E0E0C', texto:'#F0EDE8' };
var LOGO_LM64 = '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';
function letreiro(texto, larg){
  var c = tela(1024, 160), k = c.getContext('2d');
  k.font = '900 92px system-ui,Segoe UI,sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle';
  k.fillStyle = LM.texto; k.fillText('LIVEMODE', 512, 86);
  var t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  var im = new Image(); im.onload = function(){ var w = 900, h = w*66/454; k.clearRect(0, 0, 1024, 160); k.drawImage(im, (1024 - w)/2, (160 - h)/2, w, h); t.needsUpdate = true; };
  im.src = 'data:image/png;base64,' + LOGO_LM64;
  return new THREE.Mesh(new THREE.PlaneGeometry(larg, larg*160/1024), new THREE.MeshBasicMaterial({ map:t, transparent:true, color:0xffffff, depthWrite:false }));
}
var LETREIROS = [];
(function(){
  var l1 = letreiro('LIVEMODE · CAZÉTV', 30); l1.position.set(PCX, -2.25, PF.z0 - 0.45); l1.rotation.y = Math.PI; cena.add(l1); LETREIROS.push(l1);
  var l2 = letreiro('LIVEMODE · CAZÉTV', 34); l2.position.set(PF.x1 + 0.45, -2.25, PCZ); l2.rotation.y = Math.PI/2; cena.add(l2); LETREIROS.push(l2);
  var l3 = letreiro('LIVEMODE · CAZÉTV', 12); l3.position.set(PCX, TERREO + 4.2, PF.z0 - 4.45); l3.rotation.y = Math.PI; cena.add(l3); LETREIROS.push(l3);
  // letreiro nos quatro lados do prédio (Guilherme, 2026-11-10): sul e oeste completam norte e leste
  var l4 = letreiro('LIVEMODE · CAZÉTV', 30); l4.position.set(PCX, -2.25, PF.z1 + 0.45); cena.add(l4); LETREIROS.push(l4);
  var l5 = letreiro('LIVEMODE · CAZÉTV', 34); l5.position.set(PF.x0 - 0.45, -2.25, PCZ); l5.rotation.y = -Math.PI/2; cena.add(l5); LETREIROS.push(l5);
})();

// ── Chão do bairro: uma textura de quarteirão (78 x 92 m) com asfalto, faixas, vagas, faixa de pedestre, meio-fio e calçada ──
var QX = 78, QZ = 92, MEIA = 6, CALC = 4;
var texQuadra = (function(){
  var S = LEVE ? 512 : 1024, c = tela(S), k = c.getContext('2d'), mx = S/QX, mz = S/QZ;
  function r(cor, x0, z0, x1, z1){ k.fillStyle = cor; k.fillRect(x0*mx, z0*mz, (x1-x0)*mx, (z1-z0)*mz); }
  r('#3d3f42', 0, 0, QX, QZ);
  for (var i = 0; i < 260; i++) { k.fillStyle = 'rgba(' + (sorte() < 0.6 ? '20,20,22,' : '120,120,120,') + (0.04 + sorte()*0.08).toFixed(3) + ')'; k.beginPath(); k.ellipse(sorte()*S, sorte()*S, 6 + sorte()*40, 3 + sorte()*10, sorte()*3, 0, 7); k.fill(); }
  ruido(k, S, 9000, 0.10);
  // marcas: tracejado no eixo das ruas (na emenda da textura), linha das vagas e faixas de pedestre nas esquinas
  for (var x = MEIA + 6; x < QX - MEIA - 6; x += 5) { r('#e9e9e4', x, 0, x + 2.2, 0.09); r('#e9e9e4', x, QZ - 0.09, x + 2.2, QZ); }
  for (var z = MEIA + 6; z < QZ - MEIA - 6; z += 5) { r('#e9e9e4', 0, z, 0.09, z + 2.2); r('#e9e9e4', QX - 0.09, z, QX, z + 2.2); }
  r('rgba(233,233,228,0.55)', MEIA + 6, MEIA - 2.3, QX - MEIA - 6, MEIA - 2.2); r('rgba(233,233,228,0.55)', MEIA + 6, QZ - MEIA + 2.2, QX - MEIA - 6, QZ - MEIA + 2.3);
  r('rgba(233,233,228,0.55)', MEIA - 2.3, MEIA + 6, MEIA - 2.2, QZ - MEIA - 6); r('rgba(233,233,228,0.55)', QX - MEIA + 2.2, MEIA + 6, QX - MEIA + 2.3, QZ - MEIA - 6);
  for (var s = 0.3; s < MEIA - 0.2; s += 0.9) {
    [MEIA + 1, QX - MEIA - 4].forEach(function(fx){ r('#ecece6', fx, s, fx + 3, s + 0.45); r('#ecece6', fx, QZ - s - 0.45, fx + 3, QZ - s); });
    [MEIA + 1, QZ - MEIA - 4].forEach(function(fz){ r('#ecece6', s, fz, s + 0.45, fz + 3); r('#ecece6', QX - s - 0.45, fz, QX - s, fz + 3); });
  }
  // meio-fio, calçada de pedra portuguesa e miolo do quarteirão
  r('#8f8d88', MEIA, MEIA, QX - MEIA, QZ - MEIA); r('#bdb9ae', MEIA + 0.25, MEIA + 0.25, QX - MEIA - 0.25, QZ - MEIA - 0.25);
  k.strokeStyle = 'rgba(60,55,45,0.16)'; k.lineWidth = 1;
  for (var gx = MEIA; gx < QX - MEIA; gx += 1.2) { k.beginPath(); k.moveTo(gx*mx, MEIA*mz); k.lineTo(gx*mx, (QZ - MEIA)*mz); k.stroke(); }
  for (var gz = MEIA; gz < QZ - MEIA; gz += 1.2) { k.beginPath(); k.moveTo(MEIA*mx, gz*mz); k.lineTo((QX - MEIA)*mx, gz*mz); k.stroke(); }
  r('#a8a59c', MEIA + CALC, MEIA + CALC, QX - MEIA - CALC, QZ - MEIA - CALC);
  for (var m = 0; m < 500; m++) { k.fillStyle = 'rgba(40,36,30,' + (0.03 + sorte()*0.06).toFixed(3) + ')'; k.beginPath(); k.arc(MEIA*mx + sorte()*(QX - 2*MEIA)*mx, MEIA*mz + sorte()*(QZ - 2*MEIA)*mz, 2 + sorte()*14, 0, 7); k.fill(); }
  return texDe(c);
})();
// terra firme: tudo a oeste da enseada (o arco da praia fica em volta de BAIA) + a península da Urca
var BAIA = { x:640, z:-40, r:418 }, COSTA_X = 300;
var TERRA_PTS = (function(){
  var p = [[-2600,-2600], [COSTA_X,-2600]], a0 = Math.acos((COSTA_X - BAIA.x)/BAIA.r);
  for (var i = 0; i <= 40; i++) { var a = a0 + (2*Math.PI - 2*a0)*i/40; p.push([BAIA.x + Math.cos(a)*BAIA.r, BAIA.z - Math.sin(a)*BAIA.r]); }
  return p.concat([[700,230], [1200,150], [1300,330], [1100,560], [950,800], [950,2600], [-2600,2600]]);
})();
var terra = poligono(TERRA_PTS, new THREE.MeshStandardMaterial({ map:texQuadra, color:0xb4b4b4, roughness:0.96, metalness:0 }), -0.1);
(function(){ var uv = terra.geometry.attributes.uv, ps = terra.geometry.attributes.position, gx0 = PCX - QX/2, gz0 = PCZ - QZ/2;
  for (var i = 0; i < uv.count; i++) uv.setXY(i, (ps.getX(i) - gx0)/QX, (-ps.getY(i) - gz0)/QZ); uv.needsUpdate = true; })();
// morros (posição e raio no chão) — os quarteirões não entram embaixo deles
var PAO = { x:1050, z:260, alt:200 }, URCA = { x:860, z:330, alt:110 }, CORC = { x:-1150, z:-180, alt:290 };
var MORROS_EXCL = [[-520,260,215], [-380,760,165], [CORC.x,CORC.z,380], [-900,-420,290], [-860,60,270], [-1380,-520,400], [-1400,180,370], [-1080,330,290], [-1600,-700,370], [-1750,200,420], [-1550,700,340], [-1900,-200,460], [-1300,-1300,330], [-1250,1350,330]];

// ── Bairro: quarteirões com prédios colados na calçada (fachada de varanda/janela/vidro, empena cega nas laterais) ──
var PROTOS = [], ARV = [], PALM = [], ESTAC = [], MOVEIS = [], POCAS = [], RECT_RUA = [];
(function(){
  var E = [
    ['varanda', { parede:'#d9d2c2', det:'#efeadf', guarda:'#cfc7b5' }], ['varanda', { parede:'#e8e4da', det:'#f4f1ea', guardaVidro:true }],
    ['varanda', { parede:'#d8b8a2', det:'#eee0d2', guarda:'#c9a58e' }], ['varanda', { parede:'#b9c2c9', det:'#e3e8ec', guardaVidro:true }],
    ['varanda', { parede:'#c9b98f', det:'#e8dfc4', guarda:'#8a6f4f' }], ['janela', { parede:'#d5cdbb', det:'#f1ece0' }],
    ['janela', { parede:'#c4a48c', det:'#ead9c8' }], ['janela', { parede:'#aeb4b6', det:'#dfe2e2' }],
    ['fita', { parede:'#cfcabd', det:'#b8b2a2' }], ['fita', { parede:'#8e979c', det:'#6f8f8c' }],
    ['cortina', { parede:'#4b6072', det:'#3d5263', vidro1:'#c4dcea', vidro2:'#5f89a6' }], ['cortina', { parede:'#55695f', det:'#44584f', vidro1:'#c6ddd2', vidro2:'#6b9488' }]];
  var mats = E.map(function(e){
    var vid = e[0] === 'cortina', mF = matFachada3(texFachada3(e[0], e[1]), 0.75, vid ? { roughness:0.3, metalness:0.3 } : null);
    return [mF, vid ? mF : matFachada3(texFachada3('empena', e[1]), 0.5), e[0]]; });
  var teto = mat(0x8f918f, { roughness:1 }), LW = [4,5,5,6,6,7,8];
  for (var i = 0; i < (LEVE ? 14 : 32); i++) { var m = mats[i % mats.length], bw = LW[Math.floor(sorte()*LW.length)], bd = 4 + (sorte() < 0.45 ? 1 : 0);
    var fl = m[2] === 'janela' ? 3 + Math.floor(sorte()*5) : m[2] === 'cortina' ? 9 + Math.floor(sorte()*10) : 6 + Math.floor(sorte()*11);
    PROTOS.push({ w:bw*VAO, d:bd*VAO, h:fl*PE, geo:caixaUV(bw*VAO, fl*PE, bd*VAO, bw, bd, fl), mats:[m[1], m[1], teto, teto, m[0], m[0]], inst:[] }); }
  var LOJA = [0x2b2f35, 0x3a342e, 0x40454b, 0x5a5148, 0x23272c], TOLDO = [0xb23a2e, 0x2f6b4a, 0x26507a, 0xd9c9a3, 0x444444, 0xc27a2a];
  var CORES = [0xf2f2f0, 0xf2f2f0, 0xc9ccd0, 0xc9ccd0, 0x1b1c1f, 0x1b1c1f, 0x6e7378, 0xa3231f, 0x1f3f7a, 0x8a8f96, 0xd8d2c0];
  function escolhe(maxW){ for (var t = 0; t < 14; t++) { var p = PROTOS[Math.floor(sorte()*PROTOS.length)]; if (p.w <= maxW) return p; } return null; }
  function fora(x, z){ return x < 190 && Math.hypot(x - BAIA.x, z - BAIA.z) > 548; }
  function poe(p, x, z, ry, nx, nz, perto){
    if (!fora(x, z)) return;
    p.inst.push([x, z, ry]);
    if (!perto) return;
    BX.add(p.w + 0.16, 3.3, p.d + 0.16, LOJA[Math.floor(sorte()*LOJA.length)], x, 0, z, ry);
    LUZ.add(p.w*0.78, 2.1, 0.06, 0x2a2d33, x + nx*(p.d/2 + 0.1), 0.45, z + nz*(p.d/2 + 0.1), ry);
    if (sorte() < 0.75) BX.add(p.w*0.86, 0.22, 1.5, TOLDO[Math.floor(sorte()*TOLDO.length)], x + nx*(p.d/2 + 0.75), 2.95, z + nz*(p.d/2 + 0.75), ry);
    BX.add(p.w + 0.4, 0.35, p.d + 0.4, 0xd8d5cc, x, p.h, z, ry);
    BX.add(p.w*0.45, 2.4, p.d*0.4, 0xb9b6ad, x, p.h + 0.35, z, ry);
    BX.add(3.2, 2.2, 3.2, 0x9da0a1, x + (ry ? 0 : p.w*0.3), p.h + 0.35, z + (ry ? p.w*0.3 : 0), ry);
  }
  function poste(x, z, dx, dz){
    if (!fora(x, z)) return;
    BX.add(0.16, 7.5, 0.16, 0x3a3f45, x, 0, z); BX.add(Math.abs(dx)*2.2 + 0.12, 0.12, Math.abs(dz)*2.2 + 0.12, 0x3a3f45, x + dx*1.1, 7.4, z + dz*1.1);
    LUZ.add(dx ? 0.7 : 0.32, 0.12, dx ? 0.32 : 0.7, 0xfff2c8, x + dx*2.1, 7.28, z + dz*2.1);
    POCAS.push([x + dx*2.1, z + dz*2.1]);
  }
  function livre(cx, cz){
    if (cx > 200) return false;
    if (Math.hypot(cx - BAIA.x, cz - BAIA.z) < 500) return false;
    for (var m = 0; m < MORROS_EXCL.length; m++) if (Math.hypot(cx - MORROS_EXCL[m][0], cz - MORROS_EXCL[m][1]) < MORROS_EXCL[m][2] + 20) return false;
    return true;
  }
  for (var i2 = (NIVEL >= 2 ? -3 : LEVE ? -7 : -26); i2 <= 1; i2++) for (var j = (NIVEL >= 2 ? -3 : LEVE ? -6 : -24); j <= (NIVEL >= 2 ? 3 : LEVE ? 6 : 24); j++) {
    var cx = PCX + i2*QX, cz = PCZ + j*QZ, dist = Math.hypot(cx - PCX, cz - PCZ), nosso = i2 === 0 && j === 0;
    if (!livre(cx, cz)) continue;
    var ox = cx - QX/2, oz = cz - QZ/2, perto = dist < (NIVEL >= 2 ? 170 : LEVE ? 300 : 760), p, x;
    if (!nosso) {
      [-1, 1].forEach(function(lado){
        x = cx - 29;
        for (;;) { p = escolhe(cx + 29 - x); if (!p) break; poe(p, x + p.w/2, cz + lado*(36 - p.d/2), 0, 0, lado, perto); x += p.w + (sorte() < 0.3 ? 2.5 + sorte()*4 : 0.25); }
      });
      if (dist < 1500) [-1, 1].forEach(function(lado){ p = escolhe(27); if (p && sorte() < 0.85) poe(p, cx + lado*(29 - p.d/2), cz + (sorte() - 0.5)*(27 - p.w), Math.PI/2, lado, 0, perto); });
    }
    if (dist < (NIVEL >= 2 ? 130 : LEVE ? 220 : 520)) {
      for (x = ox + 12; x < ox + QX - 10; x += 8.5) { if (sorte() < 0.72) ARV.push([x, oz + 7.1, 0.85 + sorte()*0.55]); if (sorte() < 0.72) ARV.push([x, oz + QZ - 7.1, 0.85 + sorte()*0.55]); }
      for (x = oz + 12; x < oz + QZ - 10; x += 8.5) { if (sorte() < 0.72) ARV.push([ox + 7.1, x, 0.85 + sorte()*0.55]); if (sorte() < 0.72) ARV.push([ox + QX - 7.1, x, 0.85 + sorte()*0.55]); }
    }
    if (dist < (NIVEL >= 2 ? 100 : LEVE ? 150 : 430)) {
      for (x = ox + 13; x < ox + QX - 13; x += 5.6) { if (sorte() < 0.55) ESTAC.push([x, oz + 4.85, Math.PI/2, CORES[Math.floor(sorte()*CORES.length)]]); if (sorte() < 0.55) ESTAC.push([x, oz + QZ - 4.85, -Math.PI/2, CORES[Math.floor(sorte()*CORES.length)]]); }
      for (x = oz + 13; x < oz + QZ - 13; x += 5.6) { if (sorte() < 0.55) ESTAC.push([ox + 4.85, x, Math.PI, CORES[Math.floor(sorte()*CORES.length)]]); if (sorte() < 0.55) ESTAC.push([ox + QX - 4.85, x, 0, CORES[Math.floor(sorte()*CORES.length)]]); }
    }
    if (dist < (NIVEL >= 2 ? 90 : LEVE ? 130 : 300)) {
      for (x = ox + 16; x < ox + QX - 10; x += 24) { poste(x, oz + 6.5, 0, -1); poste(x + 12, oz + QZ - 6.5, 0, 1); }
      for (x = oz + 16; x < oz + QZ - 10; x += 24) { poste(ox + 6.5, x, -1, 0); poste(ox + QX - 6.5, x + 12, 1, 0); }
      [[ox + 6.5, oz + 6.5], [ox + QX - 6.5, oz + QZ - 6.5]].forEach(function(s){ BX.add(0.14, 4.4, 0.14, 0x2c3035, s[0], 0, s[1]); BX.add(0.34, 1.0, 0.34, 0x15171a, s[0], 4.4, s[1]); LUZ.add(0.2, 0.2, 0.36, sorte() < 0.5 ? 0x33dd55 : 0xff3b30, s[0], 4.9, s[1]); });
    }
  }
  ARV = ARV.filter(function(a){ return fora(a[0], a[1]); }); ESTAC = ESTAC.filter(function(a){ return fora(a[0], a[1]); });
  // na calçada da Livemode: ponto de ônibus e banca de jornal
  var zc = PCZ - QZ/2 + 8.4;
  BX.add(4.6, 0.12, 1.7, 0x2c3035, PCX + 20, 2.5, zc); BX.add(4.6, 2.3, 0.08, 0x4a6272, PCX + 20, 0.2, zc + 0.8); BX.add(0.1, 2.5, 0.1, 0x2c3035, PCX + 17.8, 0, zc - 0.7); BX.add(0.1, 2.5, 0.1, 0x2c3035, PCX + 22.2, 0, zc - 0.7); BX.add(3.4, 0.45, 0.4, 0x8a8f96, PCX + 20, 0, zc + 0.4);
  BX.add(3.2, 2.5, 2.4, 0x2f6b4a, PCX - 21, 0, zc); BX.add(3.8, 0.15, 3.2, 0x24523a, PCX - 21, 2.5, zc - 0.3);
  PROTOS.forEach(function(p){ p.inst.forEach(function(q){ var gi = q[2] ? 1 : 0; RECT_RUA.push({ x:q[0], z:q[1], hw:(gi ? p.d : p.w)/2, hd:(gi ? p.w : p.d)/2 }); }); });
  PROTOS.forEach(function(p){
    if (!p.inst.length) return;
    var im = new THREE.InstancedMesh(p.geo, p.mats, p.inst.length), o = new THREE.Object3D(), cor = new THREE.Color();
    p.inst.forEach(function(q, n){ o.position.set(q[0], 0, q[1]); o.rotation.y = q[2]; o.updateMatrix(); im.setMatrixAt(n, o.matrix); var v = 0.62 + sorte()*0.16; im.setColorAt(n, cor.setRGB(v, v*0.99, v*0.965)); });
    im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; RIO.add(im);
  });
  // trânsito: mão dupla em todas as ruas perto da Livemode
  function vai(tipo, linha, dir, a0, a1){ MOVEIS.push({ tipo:tipo, linha:linha, dir:dir, a0:a0, a1:a1, p:a0 + sorte()*(a1 - a0), v:(8 + sorte()*5), cor:CORES[Math.floor(sorte()*CORES.length)] }); }
  for (var s = (LEVE ? -1 : -3); s <= (LEVE ? 0 : 2); s++) { var lz = PCZ + (s + 0.5)*QZ, dz = Math.abs(lz - BAIA.z), fim = dz < 480 ? BAIA.x - Math.sqrt(480*480 - dz*dz) - 4 : 150;
    var ext = LEVE ? (NIVEL >= 2 ? 3 : 5) : 6.5;
    for (var n = 0; n < (LEVE ? 3 : 5); n++) { vai(0, lz + 1.6, 1, PCX - ext*QX, fim); vai(0, lz - 1.6, -1, PCX - ext*QX, fim); } }
  for (var s2 = (LEVE ? -1 : -4); s2 <= 0; s2++) { var lx = PCX + (s2 + 0.5)*QX, ext2 = LEVE ? (NIVEL >= 2 ? 2.8 : 4.5) : 6.5;
    for (var n2 = 0; n2 < (LEVE ? 3 : 5); n2++) { vai(1, lx - 1.6, 1, PCZ - ext2*QZ, PCZ + ext2*QZ); vai(1, lx + 1.6, -1, PCZ - ext2*QZ, PCZ + ext2*QZ); } }
  for (var n3 = 0; n3 < (LEVE ? 8 : 26); n3++) vai(2, n3 % 2 ? 458 : 470, n3 % 2 ? 1 : -1, 2.56, 3.72);
})();
// carros: carroceria com perfil de sedã (cor por carro) + vidros e rodas escuros; estacionados e rodando no mesmo desenho
var carrosCor, carrosEsc;
(function(){
  function perfil(pts, larg){ var s = new THREE.Shape(); pts.forEach(function(p, i){ if (i) s.lineTo(p[0], p[1]); else s.moveTo(p[0], p[1]); });
    var g = new THREE.ExtrudeGeometry(s, { depth:larg, bevelEnabled:false }); g.translate(0, 0, -larg/2); g.rotateY(-Math.PI/2); return g; }
  var tetoG = new THREE.BoxGeometry(1.42, 0.07, 1.35); tetoG.translate(0, 1.45, -0.35);
  var corpo = juntar([perfil([[-2.1,0.28],[2.1,0.28],[2.13,0.62],[1.95,0.8],[1.1,0.9],[-1.9,0.93],[-2.13,0.7]], 1.74), tetoG]);
  var partes = [perfil([[-1.55,0.9],[0.95,0.9],[0.35,1.43],[-1.05,1.43]], 1.52)];
  [[-0.8,1.3],[0.8,1.3],[-0.8,-1.3],[0.8,-1.3]].forEach(function(r){ var w = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10); w.rotateZ(Math.PI/2); w.translate(r[0], 0.34, r[1]); partes.push(w); });
  var n = ESTAC.length + MOVEIS.length, o = new THREE.Object3D(), cor = new THREE.Color();
  carrosCor = new THREE.InstancedMesh(corpo, new THREE.MeshStandardMaterial({ color:0xc8c8c8, roughness:0.35, metalness:0.12 }), n);
  carrosEsc = new THREE.InstancedMesh(juntar(partes), new THREE.MeshStandardMaterial({ color:0x181b20, roughness:0.3, metalness:0.2 }), n);
  ESTAC.forEach(function(c, i){ o.position.set(c[0], 0, c[1]); o.rotation.y = c[2]; o.updateMatrix(); carrosCor.setMatrixAt(i, o.matrix); carrosEsc.setMatrixAt(i, o.matrix); carrosCor.setColorAt(i, cor.setHex(c[3])); });
  MOVEIS.forEach(function(c, i){ carrosCor.setColorAt(ESTAC.length + i, cor.setHex(c.cor)); });
  [carrosCor, carrosEsc].forEach(function(m){ m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; RIO.add(m); });
})();
var carroAux = new THREE.Object3D();
function moverCarros(dt){
  var base = ESTAC.length;
  MOVEIS.forEach(function(c, i){
    if (c.tipo === 2) { c.p += c.dir*c.v*dt/c.linha; if (c.p > c.a1) c.p = c.a0; if (c.p < c.a0) c.p = c.a1;
      carroAux.position.set(BAIA.x + Math.cos(c.p)*c.linha, 0, BAIA.z - Math.sin(c.p)*c.linha); carroAux.rotation.y = c.p + (c.dir > 0 ? Math.PI : 0); }
    else { c.p += c.dir*c.v*dt; if (c.p > c.a1) c.p = c.a0; if (c.p < c.a0) c.p = c.a1;
      if (c.tipo === 0) { carroAux.position.set(c.p, 0, c.linha); carroAux.rotation.y = c.dir > 0 ? Math.PI/2 : -Math.PI/2; }
      else { carroAux.position.set(c.linha, 0, c.p); carroAux.rotation.y = c.dir > 0 ? 0 : Math.PI; } }
    carroAux.updateMatrix(); carrosCor.setMatrixAt(base + i, carroAux.matrix); carrosEsc.setMatrixAt(base + i, carroAux.matrix);
  });
  carrosCor.instanceMatrix.needsUpdate = true; carrosEsc.instanceMatrix.needsUpdate = true;
}

// ── Orla: areia, calçadão, Av. Praia de Botafogo, jardim; Aterro ao norte; Urca ao sul da enseada ──
(function(){
  var a0 = Math.acos((COSTA_X - BAIA.x)/BAIA.r), len = 2*Math.PI - 2*a0;
  function arco(r1, r2, cor, y, extra){ var m = new THREE.Mesh(new THREE.RingGeometry(r1, r2, 96, 1, a0 - 0.02, len + 0.04), mat(cor, extra || { roughness:1 })); m.rotation.x = -Math.PI/2; m.position.set(BAIA.x, y, BAIA.z); m.receiveShadow = true; RIO.add(m); }
  arco(404, 424, 0x8f8062, -0.05); arco(424, 446, 0xb5a67f, -0.04); arco(446, 451, 0x9a978e, -0.02);
  arco(451, 477, 0x2d2f32, -0.03); arco(463.6, 464.4, 0xa8963f, -0.015); arco(457.3, 457.5, 0xb0b0ac, -0.015); arco(470.5, 470.7, 0xb0b0ac, -0.015);
  arco(477, 480, 0x9a978e, -0.02); arco(480, 540, 0x3f5c2e, -0.04);
  for (var i = 0; i < 70; i++) { if (LEVE && i % 2) continue; var a = a0 + len*(i + 0.5)/70; PALM.push([BAIA.x + Math.cos(a)*448.5, BAIA.z - Math.sin(a)*448.5, 0.9 + sorte()*0.3]); }
  for (var j = 0; j < 150; j++) { if (LEVE && j % 2) continue; var b = a0 + len*sorte(), r = 484 + sorte()*42; ARV.push([BAIA.x + Math.cos(b)*r, BAIA.z - Math.sin(b)*r, 1.1 + sorte()*0.9]); }
  // Aterro do Flamengo: parque comprido na beira da baía, com pista expressa
  var gram = mat(0x3f5c2e, { roughness:1 });
  poligono([[212,-2600],[COSTA_X,-2600],[COSTA_X,-300],[212,-330]], gram, -0.06);
  poligono([[196,-2600],[212,-2600],[212,-330],[196,-340]], mat(0x3b3d40, { roughness:1 }), -0.05);
  for (var k = 0; k < 190; k++) if (!LEVE || k % 2 === 0) ARV.push([218 + sorte()*74, -350 - sorte()*2100, 1.2 + sorte()*1.1]);
  for (var k2 = 0; k2 < 40; k2++) PALM.push([296, -350 - k2*52, 1.1]);
  // sul da enseada: Urca e o pé dos morros (verde, com um casario baixo)
  poligono([[199,222],[300,205],[700,232],[1200,152],[1300,330],[1100,560],[950,800],[950,2600],[199,2600]], mat(0x3c5a2f, { roughness:1 }), -0.06);
  for (var u = 0; u < 60; u++) { var ux = 330 + sorte()*380, uz = 262 + sorte()*90, uw = 9 + sorte()*10; BX.add(uw, 6 + sorte()*14, 9 + sorte()*6, [0xe8e0cf, 0xd9c3ab, 0xcfd3d6, 0xe6d9b8][u % 4], ux, 0, uz, sorte()*0.3); BX.add(uw + 0.6, 0.5, 10, 0xa5553a, ux, 0, uz); }
  for (var v = 0; v < 120; v++) ARV.push([320 + sorte()*520, 245 + sorte()*40, 1.2 + sorte()*0.8]);
  // Santos Dumont: aterro com pista
  poligono([[COSTA_X,-2150],[470,-2150],[470,-1480],[COSTA_X,-1440]], mat(0x8b9097, { roughness:1 }), -0.05);
  BX.add(34, 0.1, 560, 0x2b2e33, 400, 0, -1800); BX.add(1.2, 0.12, 520, 0xe9e9e4, 400, 0, -1800); BX.add(60, 9, 150, 0xd9dde0, 335, 0, -1700);
})();
var etSdu = etiqueta('Aeroporto Santos Dumont', '#e8edf8', 5); etSdu.position.set(400, 60, -1780); RIO.add(etSdu);
var aviao = new THREE.Group(); RIO.add(aviao);
(function(){ var f = new THREE.Mesh(new THREE.CylinderGeometry(2,2,34,12), mat(0xf4f6f8, { metalness:0.3 })); f.rotation.x = Math.PI/2; aviao.add(f);
  var nariz = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 12), mat(0xf4f6f8)); nariz.rotation.x = -Math.PI/2; nariz.position.z = -19.5; aviao.add(nariz);
  aviao.add(new THREE.Mesh(new THREE.BoxGeometry(36, 0.6, 6), mat(0xdfe4ea)));
  var cd = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 5), mat(0xe5233a)); cd.position.set(0, 3.8, 14); aviao.add(cd);
  var est = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 3.5), mat(0xdfe4ea)); est.position.set(0, 0.6, 14); aviao.add(est); })();

// ── Água da baía: reflexo do sol em ondinhas (mapa de normais gerado, rolando devagar) ──
var texOnda = (function(){
  var S = 256, c = tela(S), k = c.getContext('2d'), img = k.createImageData(S, S), F = [[1,2,0.0],[3,1,1.3],[2,5,2.1],[6,3,0.7],[5,8,4.0],[11,7,5.2]];
  function alt(x, y){ var h = 0; for (var i = 0; i < F.length; i++) h += Math.sin((x*F[i][0] + y*F[i][1])*2*Math.PI/S + F[i][2]) / (1 + i*0.7); return h; }
  for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
    var dx = (alt(x + 1, y) - alt(x - 1, y))*1.6, dy = (alt(x, y + 1) - alt(x, y - 1))*1.6, l = Math.sqrt(dx*dx + dy*dy + 1), p = (y*S + x)*4;
    img.data[p] = (-dx/l*0.5 + 0.5)*255; img.data[p+1] = (-dy/l*0.5 + 0.5)*255; img.data[p+2] = (1/l*0.5 + 0.5)*255; img.data[p+3] = 255; }
  k.putImageData(img, 0, 0); var t = texDe(c); t.repeat.set(150, 150); return t;
})();
var agua = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshPhongMaterial({ color:0x1f6a9a, specular:0xfff3d6, shininess:70, normalMap:texOnda, normalScale:new THREE.Vector2(0.35, 0.35) }));
agua.rotation.x = -Math.PI/2; agua.position.set(1500, -1.8, 0); RIO.add(agua);
var barcos = [];
(function(){ var casco = mat(0xf4f6f8, { roughness:0.4 }), cab = mat(0xdfe4ea), mastro = mat(0x6b7077);
  for (var i = 0; i < (LEVE ? 12 : 26); i++) { var g = new THREE.Group(), s = 0.8 + sorte()*0.9, a = 2.2 + sorte()*1.9, r = 150 + sorte()*230;
    var h = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 8), casco); h.position.y = 0.35; g.add(h);
    var pr = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.6, 4), casco); pr.rotation.x = Math.PI/2; pr.rotation.y = Math.PI/4; pr.scale.y = 1; pr.position.set(0, 0.35, 5.2); g.add(pr);
    var cb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 3), cab); cb.position.set(0, 1.3, -0.8); g.add(cb);
    if (i % 2) { var ms = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 9, 5), mastro); ms.position.set(0, 5, 1); g.add(ms); }
    g.scale.setScalar(s); g.position.set(BAIA.x + Math.cos(a)*r, -1.7, BAIA.z - Math.sin(a)*r); g.rotation.y = sorte()*6.3; RIO.add(g); barcos.push(g); }
})();

// ── Árvores e palmeiras (um desenho só pra todas) ──
(function(){
  var o = new THREE.Object3D(), cor = new THREE.Color();
  function monta(geo, material, lista, fn, sombra){ if (!lista.length) return; var im = new THREE.InstancedMesh(geo, material, lista.length);
    lista.forEach(function(a, i){ fn(a, i); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, cor); }); im.frustumCulled = false; im.castShadow = !!sombra; im.receiveShadow = true; RIO.add(im); }
  var tronco = new THREE.CylinderGeometry(0.14, 0.24, 3.2, 6); tronco.translate(0, 1.6, 0);
  var copas = [[0, 4.3, 0, 1.9, 1.45], [1.1, 3.7, 0.5, 1.35, 1.1], [-0.9, 3.8, -0.7, 1.45, 1.1], [0.2, 3.5, -1.1, 1.15, 0.95]].map(function(b){ var g = new THREE.IcosahedronGeometry(1, LEVE ? 0 : 1); g.scale(b[3], b[4], b[3]); g.translate(b[0], b[1], b[2]); return g; });
  var copa = juntar(copas);
  monta(tronco, mat(0x5a4636, { roughness:1 }), ARV, function(a){ o.position.set(a[0], 0, a[1]); o.rotation.set(0, a[0]*7.1, 0); o.scale.setScalar(a[2]); cor.setHex(0xffffff); }, false);
  monta(copa, mat(0xffffff, { roughness:0.95 }), ARV, function(a, i){ o.position.set(a[0], 0, a[1]); o.rotation.set(0, a[0]*7.1, 0); o.scale.set(a[2], a[2]*(0.85 + (i % 5)*0.07), a[2]); cor.setHSL(0.26 + (i % 7)*0.012, 0.45 + (i % 3)*0.06, 0.12 + (i % 4)*0.022); }, true);
  var est = new THREE.CylinderGeometry(0.16, 0.26, 9, 6); est.translate(0, 4.5, 0);
  var folhas = []; for (var f = 0; f < 9; f++) { var g = new THREE.BoxGeometry(0.75, 0.05, 3.6); g.translate(0, 0, 1.8); g.rotateX(0.35 + (f % 3)*0.22); g.rotateY(f*Math.PI*2/9); g.translate(0, 9, 0); folhas.push(g); }
  monta(est, mat(0x8a7a62, { roughness:1 }), PALM, function(a){ o.position.set(a[0], 0, a[1]); o.rotation.set(0, 0, 0); o.scale.setScalar(a[2]); cor.setHex(0xffffff); }, false);
  monta(juntar(folhas), mat(0x2c5a2a, { roughness:0.9, side:THREE.DoubleSide }), PALM, function(a){ o.position.set(a[0], 0, a[1]); o.rotation.set(0, a[1], 0); o.scale.setScalar(a[2]); cor.setHex(0xffffff); }, true);
})();

// ── Morros: silhueta de verdade, relevo irregular, mata embaixo e granito onde é íngreme ──
var texMata = (function(){ var S = 256, c = tela(S), k = c.getContext('2d'); k.fillStyle = '#b9b9b9'; k.fillRect(0, 0, S, S);
  for (var i = 0; i < 2600; i++) { var v = Math.floor(90 + sorte()*165); k.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.55)'; k.beginPath(); k.arc(sorte()*S, sorte()*S, 2 + sorte()*7, 0, 7); k.fill(); }
  return texDe(c); })();
var matMorro = new THREE.MeshStandardMaterial({ vertexColors:true, map:texMata, roughness:1, metalness:0 });
function morro(x, z, alt, perfil, achata, rocha, face){
  var pts = new THREE.SplineCurve(perfil.map(function(p){ return new THREE.Vector2(p[0]*alt, p[1]*alt); })).getPoints(LEVE ? 18 : 40);
  pts.forEach(function(p){ if (p.x < 0) p.x = 0; });
  var g = new THREE.LatheGeometry(pts, LEVE ? 44 : 96), ps = g.attributes.position, uv = g.attributes.uv, cores = [], f1 = sorte()*6, f2 = sorte()*6, f3 = sorte()*6, c = new THREE.Color(), pedraCor = new THREE.Color();
  for (var i = 0; i < ps.count; i++) {
    var px = ps.getX(i), py = ps.getY(i), pz = ps.getZ(i), a = Math.atan2(pz, px), t = py/alt;
    var k = 1 + (0.17*Math.sin(2*a + f1) + 0.11*Math.sin(3*a + f2 + t*3) + 0.07*Math.sin(5*a + f3 + t*5) + 0.045*Math.sin(9*a + f1 + t*11) + 0.03*Math.sin(17*a + f2 + t*17)) * (1 - t*0.62);
    ps.setXYZ(i, px*k, py * (1 + (0.07*Math.sin(3*a + f2) + 0.04*Math.sin(7*a + f3))*(1 - t)*t*3), pz*k);
    uv.setXY(i, uv.getX(i)*Math.max(6, Math.round(alt/14)), uv.getY(i)*Math.max(3, Math.round(alt/45)));
  }
  g.computeVertexNormals();
  var nr = g.attributes.normal;
  for (var j = 0; j < ps.count; j++) {
    var tt = ps.getY(j)/alt, ang = Math.atan2(ps.getZ(j), ps.getX(j)), ingreme = 1 - Math.abs(nr.getY(j));
    var v = 0.5 + 0.25*Math.sin(ang*13 + tt*21 + f1) + 0.25*Math.sin(ang*5 - tt*9 + f3);
    var pedra = rocha ? Math.max(0, Math.min(1, (ingreme - 0.5)*5 + (tt - rocha)*2.2)) : 0;
    if (face != null) pedra = Math.max(pedra, Math.max(0, Math.min(1, (Math.cos(ang - face) - 0.3)*2.6)) * Math.max(0, Math.min(1, tt*3.2 - 0.5)) * (0.75 + 0.25*Math.sin(ang*23 + tt*30)));
    c.setHSL(0.29 + v*0.05, 0.45, 0.13 + v*0.09 + tt*0.03); c.lerp(pedraCor.setRGB(0.47 + v*0.1, 0.44 + v*0.09, 0.39 + v*0.08), pedra);
    cores.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cores, 3));
  var m = new THREE.Mesh(g, matMorro); m.position.set(x, -0.3, z); m.scale.z = achata || 1; m.receiveShadow = true; RIO.add(m); return m;
}
morro(PAO.x, PAO.z, PAO.alt, [[0.62,0],[0.5,0.1],[0.43,0.25],[0.4,0.45],[0.37,0.62],[0.33,0.76],[0.26,0.88],[0.16,0.96],[0.06,0.995],[0,1]], 0.7, 0.22);
morro(URCA.x, URCA.z, URCA.alt, [[1.3,0],[1.08,0.35],[0.9,0.7],[0.7,0.9],[0.4,0.98],[0,1]], 0.8, 0.5);
morro(820, 720, 120, [[1.2,0],[0.9,0.4],[0.6,0.78],[0.3,0.96],[0,1]], 0.8, 0.8);
morro(CORC.x, CORC.z, CORC.alt, [[1.25,0],[0.95,0.16],[0.66,0.38],[0.42,0.6],[0.25,0.78],[0.13,0.9],[0.06,0.97],[0.035,1],[0,1.001]], 0.9, 0.78, 0.5);
[[-900,-420,170,1.4],[-860,60,190,1.2],[-1380,-520,230,1.5],[-1400,180,240,1.3],[-1080,330,150,1.6]].forEach(function(s){ morro(s[0], s[1], s[2], [[1.25,0],[0.95,0.3],[0.62,0.66],[0.34,0.9],[0.12,0.99],[0,1]], s[3], 0.95); });
morro(-520, 260, 150, [[1.15,0],[0.92,0.3],[0.66,0.62],[0.4,0.86],[0.16,0.98],[0,1]], 1.25, 0.8, 0.2);
morro(-380, 760, 130, [[1.2,0],[0.95,0.3],[0.7,0.6],[0.42,0.85],[0.16,0.98],[0,1]], 0.8, 0.85, 5.6);
[[-1600,-700,260],[-1750,200,300],[-1550,700,240],[-1900,-200,330],[-1300,-1300,240],[-1250,1350,240]].forEach(function(s){ morro(s[0], s[1], s[2], [[1.35,0],[1.0,0.3],[0.66,0.62],[0.36,0.86],[0.14,0.98],[0,1]], 1.25, 0.9, sorte()*6); });
[[2600,-1500,170],[2900,-600,210],[2700,500,180],[3000,1400,200]].forEach(function(s){ morro(s[0], s[1], s[2], [[2.2,0],[1.5,0.4],[0.8,0.8],[0.3,0.97],[0,1]], 1.6, 0); });
var caboB = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 4), new THREE.MeshBasicMaterial({ color:0x222222 }));
var PA = new THREE.Vector3(URCA.x, URCA.alt - 1, URCA.z), PB = new THREE.Vector3(PAO.x, PAO.alt - 2, PAO.z);
(function(){ caboB.scale.y = PA.distanceTo(PB); caboB.position.copy(PA.clone().add(PB).multiplyScalar(0.5)); caboB.lookAt(PB); caboB.rotateX(Math.PI/2); RIO.add(caboB); })();
var bondinho = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), mat(0xe5233a, { emissive:0x400000, emissiveIntensity:0.3 })); RIO.add(bondinho);
var cristo = new THREE.Group(); cristo.position.set(CORC.x, CORC.alt - 1.5, CORC.z); cristo.scale.setScalar(5.2); RIO.add(cristo);
var matCristo = mat(0xe6e8e4, { emissive:0xfff2d0, emissiveIntensity:0, roughness:0.7 });
(function(){
  function p(g, x, y, z, rz){ var m = new THREE.Mesh(g, matCristo); m.position.set(x, y, z); if (rz) m.rotation.z = rz; m.castShadow = true; cristo.add(m); return m; }
  var ped = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 2.6, 8), mat(0x8f9093)); ped.position.y = 1.3; cristo.add(ped);
  var mir = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.7, 12), mat(0x9a9b9c)); mir.position.y = -0.2; cristo.add(mir);
  var tun = new THREE.LatheGeometry([[0.01,0],[1.45,0],[1.35,1.2],[1.05,3.6],[0.9,5.6],[1.0,6.6],[1.05,7.3],[0.7,7.9],[0.36,8.2],[0.01,8.25]].map(function(q){ return new THREE.Vector2(q[0], q[1]); }), 14);
  p(tun, 0, 2.6, 0).scale.z = 0.72;
  [-1, 1].forEach(function(l){
    p(new THREE.CylinderGeometry(0.34, 0.6, 3.9, 8), l*2.75, 9.55, 0, l*(Math.PI/2 + 0.04)).scale.z = 0.8;
    p(new THREE.BoxGeometry(2.6, 0.8, 0.5), l*2.6, 9.15, 0, l*0.16);
    p(new THREE.BoxGeometry(0.75, 0.24, 0.5), l*5.0, 9.5, 0, 0); });
  p(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 8), 0, 11.0, 0);
  var cab = p(new THREE.SphereGeometry(0.56, 12, 10), 0, 11.6, 0.08); cab.scale.set(0.9, 1.15, 1);
})();
cristo.rotation.y = Math.PI/2 - 0.3;
var etiquetasRio = [['Pão de Açúcar', PAO.x, PAO.alt + 40, PAO.z], ['Cristo Redentor', CORC.x, CORC.alt + 70, CORC.z], ['Enseada de Botafogo', 420, 30, -60], ['Aterro do Flamengo', 255, 30, -800]];
etiquetasRio.forEach(function(e){ var s = etiqueta(e[0], '#e8edf8', 5); s.position.set(e[1], e[2], e[3]); RIO.add(s); });
montarLote(BX, mat(0xb8b8b8, { roughness:0.85 }), true);
var matLuz = new THREE.MeshStandardMaterial({ color:0xffffff, emissive:0xfff0c0, emissiveIntensity:0, roughness:0.4 });
montarLote(LUZ, matLuz, false); MATS_NOITE.push([matLuz, 2.2]);
// poças de luz amarelada no chão debaixo dos postes (só à noite)
var matPoca = (function(){ var c = tela(128), k = c.getContext('2d'), g = k.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,214,150,0.9)'); g.addColorStop(0.45, 'rgba(255,190,110,0.35)'); g.addColorStop(1, 'rgba(255,180,100,0)'); k.fillStyle = g; k.fillRect(0, 0, 128, 128);
  return new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(c), transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, fog:false }); })();
(function(){ if (LEVE || !POCAS.length) return; var g = new THREE.PlaneGeometry(15, 15); g.rotateX(-Math.PI/2); var im = new THREE.InstancedMesh(g, matPoca, POCAS.length), o = new THREE.Object3D();
  POCAS.forEach(function(p, i){ o.position.set(p[0], 0.05, p[1]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.frustumCulled = false; RIO.add(im); })();

// ── Céu ──
var ceuCanvas = tela(4, 256);
var ceuTex = new THREE.CanvasTexture(ceuCanvas);
var ceu = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), new THREE.MeshBasicMaterial({ map:ceuTex, side:THREE.BackSide, fog:false, depthWrite:false }));
cena.add(ceu); camera.far = 9000; camera.updateProjectionMatrix();
var estrelas = (function(){ var g = new THREE.BufferGeometry(), p = [];
  for (var i=0;i<900;i++){ var th = Math.random()*Math.PI*2, ph = Math.random()*Math.PI*0.42, R = 4000; p.push(R*Math.sin(ph)*Math.cos(th), R*Math.cos(ph), R*Math.sin(ph)*Math.sin(th)); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  var m = new THREE.Points(g, new THREE.PointsMaterial({ color:0xffffff, size:2.5, sizeAttenuation:false, transparent:true, opacity:0, fog:false })); cena.add(m); return m; })();
var lua = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 12), new THREE.MeshBasicMaterial({ color:0xf3f1e6, fog:false })); cena.add(lua);
var discoSol = new THREE.Mesh(new THREE.SphereGeometry(90, 16, 12), new THREE.MeshBasicMaterial({ color:0xfff1c1, fog:false })); cena.add(discoSol);
var brilhoSol = (function(){ var c = tela(128), k = c.getContext('2d'), g = k.createRadialGradient(64,64,4,64,64,64);
  g.addColorStop(0, 'rgba(255,250,225,0.95)'); g.addColorStop(0.25, 'rgba(255,240,190,0.35)'); g.addColorStop(1, 'rgba(255,240,190,0)'); k.fillStyle = g; k.fillRect(0,0,128,128);
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false, fog:false })); s.scale.set(1500, 1500, 1); cena.add(s); return s; })();
// sombra do sol cobrindo o quarteirão inteiro e os vizinhos
var ALVO_SOL = new THREE.Vector3(18, TERREO, 25);
sol.target.position.copy(ALVO_SOL); cena.add(sol.target);
sol.shadow.mapSize.set(CELULAR || LEVE ? 2048 : 4096, CELULAR || LEVE ? 2048 : 4096); if (sol.shadow.map) { sol.shadow.map.dispose(); sol.shadow.map = null; }
sol.shadow.camera.left = -120; sol.shadow.camera.right = 120; sol.shadow.camera.top = 120; sol.shadow.camera.bottom = -120; sol.shadow.camera.near = 1; sol.shadow.camera.far = 800;
sol.shadow.bias = -0.0006; sol.shadow.normalBias = 0.06; sol.shadow.camera.updateProjectionMatrix();
var nuvens = (function(){ var c = tela(256, 128), k = c.getContext('2d');
  for (var n = 0; n < 16; n++) { var x = 40 + Math.random()*176, y = 50 + Math.random()*36, r = 18 + Math.random()*26, g = k.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); k.fillStyle = g; k.fillRect(0, 0, 256, 128); }
  var t = new THREE.CanvasTexture(c), lista = [];
  for (var i=0;i<(LEVE ? 20 : 60);i++){ var s = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, opacity:0, depthWrite:false, fog:false }));
    s.position.set(-3000 + Math.random()*6000, 380 + Math.random()*520, -3000 + Math.random()*6000); var k2 = 380 + Math.random()*460; s.scale.set(k2*2, k2*0.75, 1); cena.add(s); lista.push(s); }
  return lista; })();
var CHUVA_N = LEVE ? 1100 : 3200, CHUVA_ALT = 180;
var chuva = (function(){ var g = new THREE.BufferGeometry(), p = [];
  for (var i = 0; i < CHUVA_N; i++) { var x = -150 + Math.random()*360, y = Math.random()*CHUVA_ALT, z = -150 + Math.random()*360; p.push(x, y, z, x - 0.1, y + 1.7, z); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  var m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color:0xd6e2f2, transparent:true, opacity:0.5, depthWrite:false })); m.frustumCulled = false; m.visible = false; cena.add(m); return m; })();

var CEU = [[0,'#060d22','#1d2b55',0,0.56],[4.8,'#081029','#243462',0,0.56],[5.6,'#2a2f5e','#ff8f6b',0.25,0.55],[6.6,'#4c79c7','#ffd2a1',0.6,0.7],
  [8,'#2f7fe0','#bfe0fb',0.9,0.85],[15.5,'#3383e0','#c6e4fb',0.9,0.85],[16.8,'#3f78c8','#ffe0a8',0.82,0.85],[17.5,'#5a70b8','#ffb877',0.62,0.86],[18.1,'#4b4a8e','#ff8456',0.4,0.82],
  [18.6,'#2b2b68','#d9566e',0.2,0.7],[19.2,'#12183a','#4a3a6e',0.03,0.58],[19.8,'#081029','#223260',0,0.56],[24,'#060d22','#1d2b55',0,0.56]];
function hex(c){ return new THREE.Color(c); }
function mistura(a, b, t){ return a.clone().lerp(b, t); }
var TEMPO = { codigo:0, temp:null };
function horaBRT(){
  if (PARAM.hora) return +PARAM.hora;
  var p = new Date().toLocaleString('en-GB', { timeZone:'America/Sao_Paulo', hour12:false }).split(' ')[1].split(':');
  return (+p[0]) + (+p[1])/60;
}
function tipoTempo(){
  if (PARAM.tempo) return PARAM.tempo;
  var c = TEMPO.codigo;
  if (c >= 95) return 'tempestade'; if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'chuva';
  if (c === 45 || c === 48) return 'neblina'; if (c >= 2) return 'nublado'; return 'sol';
}
var NOMES_TEMPO = { sol:'Céu limpo', nublado:'Nublado', chuva:'Chuva', tempestade:'Tempestade', neblina:'Neblina' };
var CHUVA_FORTE = false, relampago = 0;
function atualizarCeu(){
  var h = horaBRT(), i = 0; while (i < CEU.length - 2 && CEU[i+1][0] <= h) i++;
  var a = CEU[i], b = CEU[i+1], t = (h - a[0]) / Math.max(0.001, b[0] - a[0]);
  var topo = mistura(hex(a[1]), hex(b[1]), t), hor = mistura(hex(a[2]), hex(b[2]), t), forcaSol = a[3] + (b[3]-a[3])*t, amb = a[4] + (b[4]-a[4])*t;
  var tp = tipoTempo(), cinza = { sol:0, nublado:0.62, chuva:0.74, tempestade:0.88, neblina:0.6 }[tp] || 0;
  var lum = 0.25 + forcaSol*0.75, cinzaCor = new THREE.Color(0.66*lum, 0.70*lum, 0.75*lum);
  topo.lerp(cinzaCor, cinza); hor.lerp(cinzaCor, cinza*0.85);
  var temp = PARAM.temp ? +PARAM.temp : TEMPO.temp;
  if (temp != null) { if (temp >= 28) hor.lerp(hex('#ffb36b'), Math.min(0.3, (temp-28)/25)); else if (temp <= 20) hor.lerp(hex('#9cc8ff'), Math.min(0.3, (20-temp)/25)); }
  var k = ceuCanvas.getContext('2d'), g = k.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + topo.getHexString()); g.addColorStop(0.55, '#' + mistura(topo, hor, 0.6).getHexString()); g.addColorStop(1, '#' + hor.getHexString());
  k.fillStyle = g; k.fillRect(0, 0, 4, 256); ceuTex.needsUpdate = true;
  cena.background = hor.clone();
  var neb = tp === 'neblina'; cena.fog.color.copy(hor); cena.fog.near = neb ? 60 : tp === 'tempestade' ? 220 : tp === 'chuva' ? 320 : tp === 'nublado' ? 380 : 500; cena.fog.far = neb ? 600 : tp === 'tempestade' ? 2000 : tp === 'chuva' ? 2800 : tp === 'nublado' ? 4200 : 5600;
  var ang = Math.max(-0.3, Math.min(Math.PI + 0.3, (h - 6) / 12.5 * Math.PI));
  var dir = new THREE.Vector3(Math.cos(ang)*3200, Math.sin(ang)*2400, -1500);
  discoSol.position.copy(dir).add(ALVO_SOL); discoSol.visible = dir.y > -150 && cinza < 0.7;
  brilhoSol.position.copy(discoSol.position); brilhoSol.visible = discoSol.visible; brilhoSol.material.opacity = 1 - cinza;
  dir.y = Math.max(500, dir.y); sol.position.copy(dir.normalize().multiplyScalar(380)).add(ALVO_SOL);
  var altSol = Math.min(1, Math.max(0, Math.sin(ang)));
  var quenteSol = Math.max(0, 1 - Math.abs(forcaSol - 0.5) / 0.4) * (1 - cinza);
  discoSol.material.color.copy(mistura(hex('#ff9a4a'), hex('#fff6d6'), altSol));
  sol.intensity = forcaSol * 1.0 * (1 - cinza*0.85) * (1 + quenteSol*0.7); sol.color.copy(mistura(hex('#ffb37a'), hex('#fff4e2'), altSol));
  hemi.intensity = amb * (0.82 - forcaSol*0.1) * (1 + cinza*0.34) / 0.82 * 0.9; hemi.color.copy(mistura(hex('#8fa6d6'), hex('#d6e6ff'), forcaSol));
  hemi.groundColor.copy(mistura(hex('#3a4876'), hex('#9a8f7c'), forcaSol));
  var quente = Math.max(0, 1 - Math.abs(forcaSol - 0.38) / 0.38) * (1 - cinza*0.8);
  hemi.color.lerp(hex('#ffb392'), quente*0.55); hemi.groundColor.lerp(hex('#b07a62'), quente*0.5); hemi.intensity *= 1 + quente*0.25;
  var noite = 1 - Math.min(1, forcaSol / 0.35);
  luaLuz.intensity = noite * 0.34 * (1 - cinza*0.5); hemi.intensity *= 1 + noite*0.12;
  var luzes = Math.max(noite, Math.min(1, Math.max(0, 1 - (forcaSol - 0.1) / 0.5)) * 0.85);
  estrelas.material.opacity = noite * (1 - cinza); lua.visible = noite > 0.3; lua.position.set(18 - Math.cos(ang)*2600, Math.max(900, -Math.sin(ang)*2400), -1500);
  MATS_NOITE.forEach(function(p){ p[0].emissiveIntensity = luzes * p[1] * 0.6; });
  matCristo.emissiveIntensity = 0.12 + noite * 0.8;
  LETREIROS.forEach(function(l){ l.material.color.copy(mistura(hex('#f4f6f8'), hex('#ffffff'), noite)); });
  agua.material.color.copy(mistura(hex('#0b1a33'), hex('#1b5a78'), forcaSol)).lerp(hor, quente*0.3).lerp(hex("#59646e"), Math.min(1, cinza*1.1));
  agua.material.emissive.copy(hor).multiplyScalar(0.03 + quente*0.13);
  agua.material.specular.copy(mistura(hex('#223044'), hex('#fff0cf'), forcaSol)).multiplyScalar(1 - cinza*0.7);
  nuvens.forEach(function(s, n){ s.material.opacity = cinza > 0 ? Math.min(0.95, 0.5 + cinza*0.6) : (n % 3 === 0 ? 0.85 : 0); s.material.color.copy(mistura(hex('#2a2f3a'), hex('#ffffff'), lum)).lerp(hex('#8a9099'), cinza*0.6); });
  chuva.visible = tp === 'chuva' || tp === 'tempestade'; CHUVA_FORTE = tp === 'tempestade';
  var molhado = chuva.visible;
  terra.material.color.setHex(molhado ? 0x6d7178 : 0xb4b4b4); terra.material.color.multiplyScalar(1 + noite*0.15); terra.material.roughness = molhado ? 0.45 : 0.96; terra.material.metalness = molhado ? 0.12 : 0;
  MATS_FACH.forEach(function(m){ m.color.setScalar(molhado ? 0.74 : 1); });
  matPoca.opacity = luzes * 0.8 * (1 - cinza*0.25);
  chuva.material.opacity = tp === 'tempestade' ? 0.62 : 0.5;
  var cl = document.getElementById('clima');
  if (cl) cl.textContent = 'Botafogo · ' + (temp != null ? Math.round(temp) + '°C · ' : '') + (NOMES_TEMPO[tp] || '');
}
function animarRio(dt, t){
  var c = (t % 80) / 80;
  aviao.position.set(400 + c*420, c < 0.15 ? 3 : 3 + Math.pow((c-0.15)*6, 2)*40, -1560 - c*400 + Math.max(0, c - 0.15)*3000); aviao.rotation.y = Math.PI - 0.16; aviao.rotation.x = c < 0.15 ? 0 : 0.15; aviao.visible = c < 0.95;
  var cb = (Math.sin(t*0.1) + 1) / 2; bondinho.position.copy(PA.clone().lerp(PB, cb)); bondinho.position.y -= 4;
  moverCarros(dt);
  var perto = Math.max(0.1, dist/220); if (Math.abs(camera.near - perto) > perto*0.2) { camera.near = perto; camera.updateProjectionMatrix(); }
  barcos.forEach(function(b, i){ b.position.y = -1.7 + Math.sin(t*1.3 + i)*0.15; b.rotation.z = Math.sin(t*0.9 + i)*0.03; });
  texOnda.offset.x = t*0.006; texOnda.offset.y = t*0.004;
  nuvens.forEach(function(s, i){ s.position.x += dt*(4 + i%3); if (s.position.x > 3100) s.position.x = -3100; });
  if (chuva.visible) { var p = chuva.geometry.attributes.position, v = CHUVA_FORTE ? 110 : 70;
    var ex = Math.max(1, dist/90); chuva.scale.setScalar(ex); chuva.position.set(alvo.x - 30*ex, TERREO, alvo.z - 30*ex);
    for (var i = 0; i < CHUVA_N; i++) { var q = i*6, y = p.array[q+1] - v*dt; if (y < 0) y += CHUVA_ALT; p.array[q+1] = y; p.array[q+4] = y + 1.7; } p.needsUpdate = true;
    if (CHUVA_FORTE && Math.random() < dt*0.25) relampago = 0.18; }
  if (relampago > 0) { relampago -= dt; hemi.intensity = 2.6; if (relampago <= 0) atualizarCeu(); }
}
function buscarTempo(){
  fetch('https://api.open-meteo.com/v1/forecast?latitude=-22.951&longitude=-43.183&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')
    .then(function(r){ return r.json(); }).then(function(d){ if (d && d.current) { TEMPO.codigo = d.current.weathercode; TEMPO.temp = d.current.temperature_2m; atualizarCeu(); } }).catch(function(){});
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

var CORES_CHAO = { pdext:0x24324f, corredor:0x2a3350, central:0x1d3557, apoio:0x2b3a55, playout:0x23405c, pd:0x24324f, off:0x3a3350, cpd:0x15242f, estudio:0x1f3a34, controle:0x2a2f4a, ext:0x2d2f36, audio:0x2f2a4a, nuvem:0x1f3b5c };
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
  var piso = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.1, s.d), s.tipo === 'corredor' ? matPorcelanato(s.w, s.d) : s.tipo === 'ext' ? texAsfaltoExt(s.w, s.d) : mat(CORES_CHAO[s.tipo]||0x24324f, { roughness:0.95 }));
  piso.position.set(cx, -0.05, cz); piso.receiveShadow = true; piso.userData.sala = s.liga || s.id; g.add(piso); alvosClique.push(piso);
  if (s.elev) g.position.y = s.elev;
  if (s.tipo === 'nuvem') { piso.material = new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false }); }
  var info = { piso:piso, centro:{x:cx,z:cz}, grupo:g, aoVivo:null, alerta:null, sala:s };
  if (s.tipo !== 'corredor' && s.tipo !== 'ext' && s.tipo !== 'nuvem') {
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
  } else if (s.tipo === 'ext' || s.tipo === 'nuvem') {
    if (s.tipo === 'ext') { var rotE = etiqueta(s.nome, '#e8edf8', 0.9); rotE.position.set(cx, 1.2, s.z+0.6); g.add(rotE); }
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
    externaUM(s, g);
  } else if (s.tipo==='nuvem') {
    nuvemSemNarracao(s, g);
  } else if (s.tipo==='cpd') { racks(s, g, info); }
  if (COM_LUZ_AO_VIVO[s.tipo] && !info.aoVivo) {
    var luz2 = new THREE.Mesh(new THREE.BoxGeometry(s.w-0.3,0.02,s.d-0.3), new THREE.MeshBasicMaterial({ color:0xff3b4d, transparent:true, opacity:0 }));
    luz2.position.set(s.x+s.w/2,0.02,s.z+s.d/2); g.add(luz2); info.aoVivo = luz2;
  }
}

// ── PIN da Livemode (Guilherme, 2026-11-11): na abertura do mapa a câmera começa lá no alto, olhando Botafogo — o pin mostra ONDE fica a
// Livemode · CazéTV nesse ambiente. Dentro do pin vai o mascote da CazéTV (o mesmo logo que a tela de antenas já usa) e, em cima, a marca
// "LIVE MODE" (versão provisória desenhada aqui — trocar pelo arquivo oficial do logo quando tiver). O tamanho aparente de longe é fixo
// (cresce com a distância) e o pin some quando a câmera chega perto.
var LOGO_CAZE64 = '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';
var pinLivemode = (function(){
  var c = document.createElement('canvas'); c.width = 512; c.height = 640; var k = c.getContext('2d');
  var t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  var imC = null, imL = null;
  function desenhar(){
    k.clearRect(0, 0, 512, 640);
    k.fillStyle = 'rgba(14,14,12,0.96)'; k.beginPath(); if (k.roundRect) k.roundRect(14, 10, 484, 150, 40); else k.rect(14, 10, 484, 150); k.fill();
    k.lineWidth = 6; k.strokeStyle = LM.verde; k.stroke();
    if (imL) k.drawImage(imL, 56, 34, 400, 400*66/454); else { k.font = '900 60px system-ui,Segoe UI,sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillStyle = LM.texto; k.fillText('LIVEMODE', 256, 66); }
    k.textAlign = 'center'; k.textBaseline = 'alphabetic'; k.font = '800 34px system-ui,Segoe UI,sans-serif'; k.fillStyle = LM.texto; k.fillText('CAZÉTV', 256, 138);
    k.fillStyle = LM.verde; k.beginPath(); k.moveTo(256, 628); k.bezierCurveTo(104, 470, 92, 400, 92, 366); k.arc(256, 366, 164, Math.PI, 0, false); k.bezierCurveTo(420, 400, 408, 470, 256, 628); k.closePath(); k.fill();
    k.lineWidth = 12; k.strokeStyle = LM.texto; k.stroke();
    k.fillStyle = LM.texto; k.beginPath(); k.arc(256, 366, 118, 0, Math.PI * 2); k.fill();
    if (imC) { k.save(); k.beginPath(); k.arc(256, 366, 112, 0, Math.PI * 2); k.clip(); k.drawImage(imC, 0, 0, 100, 96, 144, 254, 224, 215); k.restore(); }
    else { k.fillStyle = LM.verde; k.beginPath(); k.arc(256, 366, 46, 0, Math.PI * 2); k.fill(); }
    t.needsUpdate = true;
  }
  desenhar();
  var im1 = new Image(); im1.onload = function(){ imC = im1; desenhar(); }; im1.src = 'data:image/png;base64,' + LOGO_CAZE64;
  var im2 = new Image(); im2.onload = function(){ imL = im2; desenhar(); }; im2.src = 'data:image/png;base64,' + LOGO_LM64;
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, depthTest:false, depthWrite:false, fog:false }));
  sp.center.set(0.5, 0); sp.position.set(PCX, 7, PCZ); sp.renderOrder = 999; cena.add(sp);
  var anel = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 56), new THREE.MeshBasicMaterial({ color:LM.verdeHex, transparent:true, opacity:0, side:THREE.DoubleSide, depthTest:false, depthWrite:false, fog:false }));
  anel.rotation.x = -Math.PI / 2; anel.position.set(PCX, 0.4, PCZ); anel.renderOrder = 998; cena.add(anel);
  return { sp:sp, anel:anel };
})();
function animarPin(t){
  var fade = passeio ? 0 : Math.max(0, Math.min(1, (dist - 90) / 160));
  pinLivemode.sp.visible = pinLivemode.anel.visible = fade > 0.01; if (fade <= 0.01) return;
  var k = Math.max(1, dist / 22), u = (t * 0.5) % 1, b = 0.97 + 0.03 * Math.sin(t * 3);
  pinLivemode.sp.scale.set(5 * k * b, 6.25 * k * b, 1); pinLivemode.sp.material.opacity = fade;
  pinLivemode.anel.scale.setScalar(k * (1.2 + u * 5)); pinLivemode.anel.material.opacity = (1 - u) * 0.7 * fade;
}

// ── Nuvem: lives "[SEM NARRAÇÃO]" — som ambiente, produzidas na nuvem e que NÃO passam pela estrutura da central técnica ──
// Por isso não é uma sala dentro do prédio: é uma nuvem flutuando no céu, acima da planta, com a live pendurada nela e um feixe de luz
// que sai direto pra internet por cima do prédio, sem encostar nele. Ondas de som saem de um microfone de ambiente.
var corpoNuvem = null, brilhoNuvem = null, matNuvem = null, ondasNuvem = [], dashesNuvem = [], nuvemNoAr = false, PONTOS_FEIXE = null;
function nuvemSemNarracao(s, g){
  var cx = s.x + s.w/2, cz = s.z + s.d/2;
  // nuvem classica (silhueta de icone): base chata e arredondada + 5 bolhas no topo, com contorno neon azul e o mascote da CazeTV na frente
  matNuvem = mat(0xffffff, { roughness:0.9, emissive:0xdff0ff, emissiveIntensity:0.12 });
  var matNeon = new THREE.MeshBasicMaterial({ color:LM.verdeHex, transparent:true, opacity:0.6, side:THREE.BackSide, depthWrite:false });
  corpoNuvem = new THREE.Group(); corpoNuvem.position.set(cx, 0.2, cz); corpoNuvem.userData.x0 = cx; corpoNuvem.scale.setScalar(0.9); g.add(corpoNuvem);
  function bolha(geo, px, py, pz, sx, sy, sz){
    var m = new THREE.Mesh(geo, matNuvem); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.castShadow = true; corpoNuvem.add(m);
    var o = new THREE.Mesh(geo, matNeon); o.position.copy(m.position); o.scale.set(sx * 1.07, sy * 1.07, sz * 1.07); corpoNuvem.add(o);
  }
  bolha(new THREE.CylinderGeometry(1, 1, 1.6, 40), 0, 0.8, 0, 8.8, 1, 4.1);
  [[-6.3, 1.7, 1.9], [-3.3, 2.3, 2.6], [0.3, 3.1, 3.3], [3.9, 2.4, 2.6], [6.5, 1.7, 1.9]].forEach(function(p){ bolha(new THREE.SphereGeometry(p[2], 24, 16), p[0], p[1], 0, 1, 0.92, 0.9); });
  var cg = document.createElement('canvas'); cg.width = cg.height = 128; var kg = cg.getContext('2d'), gr = kg.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(18,209,18,0.9)'); gr.addColorStop(1, 'rgba(18,209,18,0)'); kg.fillStyle = gr; kg.fillRect(0, 0, 128, 128);
  brilhoNuvem = new THREE.Sprite(new THREE.SpriteMaterial({ map:new THREE.CanvasTexture(cg), transparent:true, opacity:0.2, depthWrite:false, fog:false }));
  brilhoNuvem.scale.set(34, 15, 1); brilhoNuvem.position.set(0, 1.8, 0); corpoNuvem.add(brilhoNuvem);
  // selo no centro da nuvem: mascote da CazeTV num circulo branco com aro azul
  var sc = document.createElement('canvas'); sc.width = sc.height = 256; var sk = sc.getContext('2d'), st = new THREE.CanvasTexture(sc);
  function selo(img){
    sk.clearRect(0, 0, 256, 256); sk.fillStyle = LM.verde; sk.beginPath(); sk.arc(128, 128, 124, 0, Math.PI * 2); sk.fill();
    sk.fillStyle = '#ffffff'; sk.beginPath(); sk.arc(128, 128, 108, 0, Math.PI * 2); sk.fill();
    if (img) { sk.save(); sk.beginPath(); sk.arc(128, 128, 104, 0, Math.PI * 2); sk.clip(); sk.drawImage(img, 0, 0, 100, 96, 26, 28, 204, 196); sk.restore(); }
    st.needsUpdate = true;
  }
  selo(null); var sim = new Image(); sim.onload = function(){ selo(sim); }; sim.src = 'data:image/png;base64,' + LOGO_CAZE64;
  var seloSp = new THREE.Sprite(new THREE.SpriteMaterial({ map:st, transparent:true, fog:false }));
  seloSp.scale.set(4.6, 4.6, 1); seloSp.position.set(-4.6, 2.6, 0); seloSp.material.depthTest = false; seloSp.renderOrder = 5; corpoNuvem.add(seloSp);
  // microfone de ambiente (com protetor de vento) e as ondas de som que saem dele
  var mx = cx - 9.4;
  var haste = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8), mat(0x59627a)); haste.position.set(mx, 0.9, cz); g.add(haste);
  var pelo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), mat(0x3a3f48, { roughness:1 })); pelo.scale.set(1.5, 1, 1); pelo.position.set(mx, 1.95, cz); g.add(pelo);
  ondasNuvem = [];
  for (var i = 0; i < 3; i++) {
    var anel = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 6, 40), new THREE.MeshBasicMaterial({ color:LM.verdeHex, transparent:true, opacity:0.5, depthWrite:false }));
    anel.rotation.y = Math.PI / 2; anel.position.set(mx + 0.9, 1.95, cz); anel.userData.onda = i; g.add(anel); ondasNuvem.push(anel);
  }
  var tm = etiqueta('SOM AMBIENTE', '#6df06d', 0.6); tm.position.set(mx, 3.5, cz); g.add(tm);
  // feixe que sai direto pra internet, por cima do prédio (curva suave até o céu, no rumo da baía)
  var P0 = new THREE.Vector3(cx + 7.6, 0.8, cz), P1 = new THREE.Vector3(cx + 42, 13, cz - 8), P2 = new THREE.Vector3(cx + 190, 34, cz - 40);
  PONTOS_FEIXE = function(u, o){ var a = 1 - u; o.set(a*a*P0.x + 2*a*u*P1.x + u*u*P2.x, a*a*P0.y + 2*a*u*P1.y + u*u*P2.y, a*a*P0.z + 2*a*u*P1.z + u*u*P2.z); return o; };
  dashesNuvem = [];
  for (var k = 0; k < 34; k++) {
    var d = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.28), new THREE.MeshBasicMaterial({ color:LM.verdeHex, transparent:true, opacity:0.35, fog:false }));
    d.userData.dash = k / 34; g.add(d); dashesNuvem.push(d);
  }
  var tf = etiqueta('direto pra internet · NÃO passa pela central técnica', '#6df06d', 0.75); PONTOS_FEIXE(0.1, tf.position); tf.position.y += 2.4; g.add(tf);
  var tt = etiqueta('SEM NARRAÇÃO · som ambiente', '#ffffff', 0.8); tt.position.set(cx, 5.9, cz); g.add(tt);
}
// só mexe quando há live no ar: ondas saindo do microfone, nuvem acesa e o feixe correndo
function animarNuvem(t){
  if (!matNuvem) return;
  matNuvem.emissiveIntensity = nuvemNoAr ? 0.5 + 0.12 * Math.sin(t * 2) : 0.12;
  corpoNuvem.position.y = 0.2 + 0.18 * Math.sin(t * 0.6); corpoNuvem.position.x = corpoNuvem.userData.x0 + 0.35 * Math.sin(t * 0.25); corpoNuvem.rotation.y = 0.04 * Math.sin(t * 0.3);
  brilhoNuvem.material.opacity = nuvemNoAr ? 0.5 + 0.12 * Math.sin(t * 2) : 0.2;
  ondasNuvem.forEach(function(a){ var u = ((t * 0.7) + a.userData.onda / 3) % 1; if (nuvemNoAr) { a.scale.setScalar(0.35 + u * 1.9); a.material.opacity = (1 - u) * 0.8; } else { a.scale.setScalar(0.35 + a.userData.onda * 0.5); a.material.opacity = 0.18; } });
  var p = new THREE.Vector3(), q = new THREE.Vector3(), dir = new THREE.Vector3(), xx = new THREE.Vector3(1, 0, 0);
  dashesNuvem.forEach(function(d){
    var u = (d.userData.dash + (nuvemNoAr ? t * 0.05 : 0)) % 1; PONTOS_FEIXE(u, p); PONTOS_FEIXE(Math.min(1, u + 0.01), q);
    dir.subVectors(q, p).normalize(); d.position.copy(p); d.quaternion.setFromUnitVectors(xx, dir);
    d.material.opacity = nuvemNoAr ? 0.95 - u * 0.5 : 0.22;
  });
}

// ── Externas: pátio com UMs (unidades móveis), equipe ENG e tenda, na escala da planta (os avatares têm ~1,2 m; a UM ~5 m) ──
var UMS = [];
function texAsfaltoExt(w, d){
  var P = 36, c = document.createElement('canvas'); c.width = Math.round(w * P); c.height = Math.round(d * P); var k = c.getContext('2d');
  k.fillStyle = '#3b3e45'; k.fillRect(0, 0, c.width, c.height);
  for (var i = 0; i < 2600; i++) { var v = 40 + Math.floor(Math.random() * 40); k.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',0.5)'; k.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  for (var m = 0; m < 14; m++) { k.fillStyle = 'rgba(20,20,24,0.12)'; k.beginPath(); k.ellipse(Math.random() * c.width, Math.random() * c.height, 12 + Math.random() * 40, 5 + Math.random() * 14, Math.random() * 3, 0, 7); k.fill(); }
  k.fillStyle = '#e9e9e4';
  [0.2, 3.55, 6.85, 9.8].forEach(function(z){ k.fillRect(0.4 * P, z * P - 2, 6.5 * P, 4); });
  k.fillRect(0.4 * P, 0.2 * P, 4, 9.6 * P);
  k.fillStyle = 'rgba(233,233,228,0.35)'; k.font = '900 ' + Math.round(0.8 * P) + 'px system-ui,Segoe UI,sans-serif'; k.textBaseline = 'middle'; k.fillText('EXTERNA', 8.2 * P, 8.9 * P);
  k.fillStyle = '#e5c33d'; k.fillRect(0, 0, c.width, 5); k.fillRect(0, c.height - 5, c.width, 5); k.fillRect(0, 0, 5, c.height); k.fillRect(c.width - 5, 0, 5, c.height);
  var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return new THREE.MeshStandardMaterial({ map:t, roughness:0.95 });
}
function texUM(numero, cor){
  var hex = '#' + ('000000' + cor.toString(16)).slice(-6);
  var c = document.createElement('canvas'); c.width = 640; c.height = 144; var k = c.getContext('2d');
  k.fillStyle = '#f2f4f7'; k.fillRect(0, 0, 640, 144);
  k.fillStyle = hex; k.beginPath(); k.moveTo(0, 104); k.lineTo(640, 62); k.lineTo(640, 144); k.lineTo(0, 144); k.closePath(); k.fill();
  k.fillStyle = '#0b1020'; k.font = '900 58px system-ui,Segoe UI,sans-serif'; k.textBaseline = 'middle'; k.textAlign = 'left'; k.fillText('CAZÉTV', 26, 48);
  k.fillStyle = hex; k.font = '900 56px system-ui,Segoe UI,sans-serif'; k.textAlign = 'right'; k.fillText('UM ' + numero, 616, 40);
  var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function rodaExt(gr, x, z, r){
  var w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.32, 16), mat(0x15171c, { roughness:0.9 })); w.rotation.x = Math.PI/2; w.position.set(x, r, z); w.castShadow = true; gr.add(w);
  var h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.34, 10), mat(0x9aa3b2, { metalness:0.5, roughness:0.4 })); h.rotation.x = Math.PI/2; h.position.set(x, r, z); gr.add(h);
}
function pratoExt(gr, x, y, z, r){
  var cap = new THREE.SphereGeometry(r * 1.7, 14, 6, 0, Math.PI * 2, 0, 0.62); cap.rotateX(Math.PI); cap.translate(0, r * 1.7 * Math.cos(0.62), 0);
  var p = new THREE.Group(); p.position.set(x, y, z); p.rotation.x = -(Math.PI/2 - 0.7); gr.add(p);
  p.add(new THREE.Mesh(cap, mat(0xe9edf2, { side:THREE.DoubleSide, roughness:0.6 })));
  var h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, r * 1.3, 5), mat(0x6d7686)); h.position.y = r * 0.65; p.add(h);
  var base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6), mat(0x6d7686)); base.position.set(x, y - 0.15, z); gr.add(base);
}
// perfil lateral extrudado na largura: pontos [x, y] com a frente em +x
function perfilExt(pts, larg, cor){
  var sh = new THREE.Shape(); pts.forEach(function(p, i){ if (i) sh.lineTo(p[0], p[1]); else sh.moveTo(p[0], p[1]); });
  var g = new THREE.ExtrudeGeometry(sh, { depth:larg, bevelEnabled:false }); g.translate(0, 0, -larg / 2);
  var m = new THREE.Mesh(g, mat(cor, { roughness:0.45 })); m.castShadow = true; return m;
}
function adesivoUM(gr, numero, cor, cx, y, larg, z){
  var tex = texUM(numero, cor);
  var a = new THREE.Mesh(new THREE.PlaneGeometry(larg, larg * 144 / 640), new THREE.MeshStandardMaterial({ map:tex, roughness:0.6 })); a.position.set(cx, y, z); gr.add(a);
  var b = new THREE.Mesh(new THREE.PlaneGeometry(larg, larg * 144 / 640), new THREE.MeshStandardMaterial({ map:tex, roughness:0.6 })); b.position.set(cx, y, -z); b.rotation.y = Math.PI; gr.add(b);
}
function caminhaoUM(g, x, z, rotY, nome, cor, escala, numero){
  var gr = new THREE.Group(); gr.position.set(x, 0, z); gr.rotation.y = rotY; if (escala) gr.scale.setScalar(escala); g.add(gr);
  var branco = 0xf2f4f7, vidro = { roughness:0.12, metalness:0.5 };
  caixa(7.6, 0.28, 1.9, 0x23262d, -1.6, 0.52, 0, gr);                                   // chassi
  caixa(5.6, 2.5, 2.45, branco, -2.7, 0.8, 0, gr);                                      // baú: a sala de controle da UM
  caixa(5.72, 0.1, 2.58, 0xdfe4ea, -2.7, 3.3, 0, gr);                                   // beiral do teto
  gr.add(perfilExt([[0.2, 0.75], [2.5, 0.75], [2.5, 1.4], [2.2, 1.55], [1.5, 2.65], [0.2, 2.65]], 2.3, branco));   // cabine
  var para = caixa(1.34, 0.04, 2.0, 0x16253b, 1.875, 2.096, 0, gr, vidro); para.rotation.z = Math.atan2(1.1, -0.7);     // para-brisa inclinado
  caixa(0.9, 0.7, 0.04, 0x16253b, 1.15, 1.7, 1.17, gr, vidro); caixa(0.9, 0.7, 0.04, 0x16253b, 1.15, 1.7, -1.17, gr, vidro);   // vidros das portas
  caixa(0.04, 0.5, 1.5, 0x15171c, 2.52, 0.85, 0, gr);                                   // grade
  caixa(0.06, 0.18, 0.4, 0xfff4cc, 2.52, 1.18, 0.75, gr, { emissive:0xfff4cc, emissiveIntensity:0.5 }); caixa(0.06, 0.18, 0.4, 0xfff4cc, 2.52, 1.18, -0.75, gr, { emissive:0xfff4cc, emissiveIntensity:0.5 });
  caixa(0.22, 0.25, 2.4, 0x2a2f3a, 2.58, 0.55, 0, gr);                                  // para-choque
  caixa(0.18, 0.4, 0.08, 0x15171c, 1.7, 1.95, 1.3, gr); caixa(0.18, 0.4, 0.08, 0x15171c, 1.7, 1.95, -1.3, gr);   // retrovisores
  caixa(0.06, 0.5, 2.0, 0xdfe4ea, -5.52, 1.0, 0, gr);                                   // porta traseira
  caixa(0.08, 0.2, 0.3, 0xe5233a, -5.56, 1.0, 1.05, gr, { emissive:0xe5233a, emissiveIntensity:0.6 }); caixa(0.08, 0.2, 0.3, 0xe5233a, -5.56, 1.0, -1.05, gr, { emissive:0xe5233a, emissiveIntensity:0.6 });   // lanternas
  caixa(0.5, 0.1, 2.2, 0x23262d, -5.75, 0.62, 0, gr);                                   // degrau traseiro
  caixa(0.06, 1.4, 0.06, 0x8a93a3, -5.6, 1.0, 1.15, gr); caixa(0.06, 1.4, 0.06, 0x8a93a3, -5.6, 1.0, 0.85, gr);   // escada
  for (var r = 0; r < 5; r++) caixa(0.05, 0.04, 0.34, 0x8a93a3, -5.6, 1.15 + r * 0.28, 1.0, gr);
  adesivoUM(gr, numero, cor, -2.7, 1.9, 4.9, 1.235);
  caixa(1.5, 0.42, 1.1, 0xc9ced6, -4.3, 3.35, 0, gr); caixa(1.1, 0.34, 1.0, 0xc9ced6, -1.9, 3.35, -0.3, gr);   // ar-condicionado
  caixa(0.5, 0.18, 0.5, 0xffb020, 1.0, 2.65, 0, gr, { emissive:0xffb020, emissiveIntensity:0.8 });                  // giroflex da cabine
  var mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 8), mat(0x8a93a3, { metalness:0.5 })); mastro.position.set(-3.2, 4.6, -0.8); gr.add(mastro);
  var mastro2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.8, 8), mat(0xb6bdca, { metalness:0.5 })); mastro2.position.set(-3.2, 6.8, -0.8); gr.add(mastro2);
  caixa(0.9, 0.05, 0.05, cor, -3.2, 7.65, -0.8, gr); caixa(0.05, 0.05, 0.9, cor, -3.2, 7.7, -0.8, gr);
  pratoExt(gr, -0.9, 3.7, 0.55, 0.5);
  caixa(1.2, 0.5, 0.7, 0x2f343d, -1.4, 0.2, 1.0, gr);                                   // tanque/gerador sob o baú
  [-3.9, -2.6, 1.5].forEach(function(ax){ rodaExt(gr, ax, 1.2, 0.52); rodaExt(gr, ax, -1.2, 0.52); caixa(1.2, 0.08, 0.4, 0x15171c, ax, 1.1, 1.17, gr); caixa(1.2, 0.08, 0.4, 0x15171c, ax, 1.1, -1.17, gr); });
  var t = etiqueta(nome, '#ffffff', 0.55); t.position.set(-1.2, 8.6, 0); gr.add(t);
  UMS.push({ gr:gr, rot:t, numero:UMS.length + 1, texto:nome, cor:'#ffffff' });
  return gr;
}
// UM compacta: van de teto alto com mastro e parabólica
function vanUM(g, x, z, rotY, nome, cor, escala, numero){
  var gr = new THREE.Group(); gr.position.set(x, 0, z); gr.rotation.y = rotY; if (escala) gr.scale.setScalar(escala); g.add(gr);
  var branco = 0xf2f4f7, vidro = { roughness:0.12, metalness:0.5 };
  caixa(3.4, 2.2, 1.95, branco, -0.9, 0.55, 0, gr);                                    // carroceria de teto alto
  gr.add(perfilExt([[0.8, 0.6], [2.0, 0.6], [2.0, 1.15], [1.75, 1.3], [1.15, 2.1], [0.8, 2.1]], 1.95, branco));
  var para = caixa(1.0, 0.04, 1.7, 0x16253b, 1.47, 1.695, 0, gr, vidro); para.rotation.z = Math.atan2(0.8, -0.6);
  caixa(0.7, 0.6, 0.04, 0x16253b, 1.2, 1.4, 0.99, gr, vidro); caixa(0.7, 0.6, 0.04, 0x16253b, 1.2, 1.4, -0.99, gr, vidro);
  caixa(0.06, 0.16, 0.34, 0xfff4cc, 2.02, 0.95, 0.6, gr, { emissive:0xfff4cc, emissiveIntensity:0.5 }); caixa(0.06, 0.16, 0.34, 0xfff4cc, 2.02, 0.95, -0.6, gr, { emissive:0xfff4cc, emissiveIntensity:0.5 });
  caixa(0.2, 0.2, 1.9, 0x2a2f3a, 2.08, 0.5, 0, gr);
  caixa(0.06, 0.18, 0.26, 0xe5233a, -2.62, 0.95, 0.8, gr, { emissive:0xe5233a, emissiveIntensity:0.6 }); caixa(0.06, 0.18, 0.26, 0xe5233a, -2.62, 0.95, -0.8, gr, { emissive:0xe5233a, emissiveIntensity:0.6 });
  adesivoUM(gr, numero, cor, -1.0, 1.55, 3.0, 0.985);
  caixa(0.9, 0.3, 0.8, 0xc9ced6, -1.6, 2.75, 0, gr);
  var mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.2, 8), mat(0x8a93a3, { metalness:0.5 })); mastro.position.set(-2.0, 3.85, 0.5); gr.add(mastro);
  caixa(0.7, 0.05, 0.05, cor, -2.0, 4.95, 0.5, gr);
  pratoExt(gr, -0.2, 2.85, -0.4, 0.38);
  caixa(0.4, 0.14, 0.4, 0xffb020, 0.9, 2.1, 0, gr, { emissive:0xffb020, emissiveIntensity:0.8 });
  [-1.7, 1.3].forEach(function(ax){ rodaExt(gr, ax, 0.9, 0.4); rodaExt(gr, ax, -0.9, 0.4); });
  var t = etiqueta(nome, '#ffffff', 0.55); t.position.set(-0.6, 6.3, 0); gr.add(t);
  UMS.push({ gr:gr, rot:t, numero:UMS.length + 1, texto:nome, cor:'#ffffff' });
  return gr;
}
// Pessoa da equipe ENG: o MESMO boneco dos avatares de dentro da central (~1,2 m), com o equipamento no tamanho dele
function pessoaExt(g, x, z, rotY, av, tipo){
  var gr = new THREE.Group(); gr.position.set(x, 0, z); gr.rotation.y = rotY; g.add(gr);
  montarBoneco(gr, 'ENG', av);
  var preto = 0x15171c;
  if (tipo === 'ombro') {
    caixa(0.2, 0.2, 0.46, preto, 0.2, 0.88, 0.12, gr);
    var lente = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.2, 10), mat(0x0b0d12)); lente.rotation.x = Math.PI/2; lente.position.set(0.2, 0.9, 0.46); gr.add(lente);
    caixa(0.07, 0.1, 0.16, 0x2a2f3a, 0.2, 1.08, -0.02, gr); caixa(0.04, 0.05, 0.05, 0xff3b4d, 0.2, 1.0, 0.36, gr, { emissive:0xff3b4d, emissiveIntensity:0.9 });
    caixa(0.04, 0.04, 0.22, 0x2a2f3a, 0.2, 1.1, 0.2, gr);
  } else if (tipo === 'tripe') {
    var topo = new THREE.Vector3(0.55, 0.82, 0.2);
    [[0.84, 0, 0.2], [0.41, 0, 0.44], [0.41, 0, -0.04]].forEach(function(p){ pernaExt(gr, topo, new THREE.Vector3(p[0], p[1], p[2]), preto); });
    caixa(0.24, 0.2, 0.46, preto, 0.55, 0.84, 0.2, gr);
    var lente2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 10), mat(0x0b0d12)); lente2.rotation.x = Math.PI/2; lente2.position.set(0.55, 0.94, 0.5); gr.add(lente2);
    caixa(0.05, 0.05, 0.05, 0xff3b4d, 0.55, 1.0, -0.02, gr, { emissive:0xff3b4d, emissiveIntensity:0.9 });
  } else if (tipo === 'rep') {
    var mic = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), mat(0x2a2f3a)); mic.position.set(0.22, 0.72, 0.18); mic.rotation.x = 0.5; gr.add(mic);
    caixa(0.1, 0.1, 0.1, 0xe5233a, 0.22, 0.8, 0.26, gr);
  }
  return gr;
}
function pernaExt(gr, a, b, cor){
  var d = new THREE.Vector3().subVectors(b, a), len = d.length();
  var m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5), mat(cor)); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); gr.add(m);
}
function tendaExt(g, x, z){
  [[-1.0, -1.0], [1.0, -1.0], [-1.0, 1.0], [1.0, 1.0]].forEach(function(p){ caixa(0.06, 1.9, 0.06, 0x8a93a3, x + p[0], 0, z + p[1], g); });
  caixa(2.4, 0.1, 2.4, 0xf2f4f7, x, 1.9, z, g); caixa(2.44, 0.06, 0.3, 0xe5233a, x, 1.88, z - 1.1, g);
  caixa(1.5, 0.05, 0.7, 0x59627a, x, 0.7, z + 0.2, g); caixa(0.05, 0.7, 0.05, 0x59627a, x - 0.7, 0, z + 0.2, g); caixa(0.05, 0.7, 0.05, 0x59627a, x + 0.7, 0, z + 0.2, g);
  caixa(0.5, 0.32, 0.04, 0x0b0d12, x - 0.3, 0.9, z + 0.1, g, { emissive:0x2a6fdb, emissiveIntensity:0.5 }); caixa(0.5, 0.32, 0.04, 0x0b0d12, x + 0.3, 0.9, z + 0.1, g, { emissive:0x7ed957, emissiveIntensity:0.4 });
}
function bloqueioExt(g, x, z, comp, rotY){
  var b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rotY || 0; g.add(b);
  caixa(comp, 0.5, 0.38, 0xf2f4f7, 0, 0, 0, b); caixa(comp * 0.9, 0.12, 0.4, 0xe5233a, 0, 0.18, 0, b);
}
function posteExt(g, x, z){
  caixa(0.1, 4.2, 0.1, 0x59627a, x, 0, z, g); caixa(0.7, 0.1, 0.3, 0xfff4cc, x, 4.15, z, g, { emissive:0xfff4cc, emissiveIntensity:0.7 });
}

// Nome da externa do dia em cima de cada UM: as externas de hoje que ainda não terminaram, por horário (a 1ª na UM 1, a 2ª na UM 2...).
// Sobrando externa além das 3 UMs, a última mostra "+N". UM sem externa fica como "livre". Vermelho = no ar agora.
function nomeExterna(n){ var t = String(n || '').replace(/^( *externa *[-–:] *)+/i, '').trim(); return t.length > 30 ? t.slice(0, 29) + '…' : t; }
function atualizarUMs(){
  if (!UMS.length) return;
  var vistos = {}, lista = [];
  DADOS.eventos.filter(function(e){ return e.sala === 'ext' && !e.encerrado; }).sort(function(a, b){ return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0; }).forEach(function(e){
    var chave = nomeExterna(e.nome).toLowerCase(); if (!chave || vistos[chave]) return; vistos[chave] = true; lista.push(e); });
  UMS.forEach(function(u, i){
    var e = lista[i], extra = (i === UMS.length - 1 && lista.length > UMS.length) ? ' +' + (lista.length - UMS.length) : '';
    var texto = 'UM ' + u.numero + (e ? ' · ' + nomeExterna(e.nome) + ' · ' + e.inicio + extra : ' · livre');
    var cor = e && e.noAr ? '#ff8a98' : e ? '#ffffff' : '#8d9bbd';
    if (u.texto === texto && u.cor === cor) return;
    var pos = u.rot.position.clone(); u.gr.remove(u.rot); if (u.rot.material.map) u.rot.material.map.dispose(); u.rot.material.dispose();
    u.rot = etiqueta(texto, cor, 0.55 / u.gr.scale.x); u.rot.position.copy(pos); u.gr.add(u.rot); u.texto = texto; u.cor = cor;
  });
}
function externaUM(s, g){
  var x0 = s.x, z0 = s.z, E = 0.62;
  caminhaoUM(g, x0 + 3.2, z0 + 1.9, 0, 'UM 1', 0xe5233a, E, 1);
  caminhaoUM(g, x0 + 3.2, z0 + 5.2, 0, 'UM 2', 0x2f6fed, E, 2);
  vanUM(g, x0 + 2.8, z0 + 8.3, 0, 'UM 3 (compacta)', 0xffb020, E, 3);
  // equipe ENG (mesmos avatares da central): câmera solo no ombro, câmera no tripé com repórter, auxiliar com o cabo
  pessoaExt(g, x0 + 8.6, z0 + 1.8, 0.9, { pele:'#c68a5e', roupa:'#ffb020', cabelo:'curto', corCabelo:'#1a1410', acessorio:'bone' }, 'ombro');
  pessoaExt(g, x0 + 7.0, z0 + 4.4, 1.4, { pele:'#e0b192', roupa:'#3ddc97', cabelo:'medio', corCabelo:'#3b2a1a', acessorio:'fone' }, 'ombro');
  pessoaExt(g, x0 + 8.4, z0 + 6.6, 1.5708, { pele:'#8d5a3b', roupa:'#2f6fed', cabelo:'curto', corCabelo:'#0e0b09', acessorio:'nenhum' }, 'tripe');
  pessoaExt(g, x0 + 11.4, z0 + 6.8, -1.5708, { pele:'#e0b192', roupa:'#f2f4f7', cabelo:'longo', corCabelo:'#6b3f1d', acessorio:'nenhum' }, 'rep');
  pessoaExt(g, x0 + 7.4, z0 + 7.6, 0.6, { pele:'#a8744f', roupa:'#e5233a', cabelo:'careca', corCabelo:'#000000', acessorio:'oculos' }, 'aux');
  caixa(1.9, 0.03, 0.05, 0x15171c, x0 + 5.6, 0, z0 + 6.3, g); caixa(1.6, 0.03, 0.05, 0x15171c, x0 + 6.0, 0, z0 + 4.6, g); caixa(2.4, 0.03, 0.05, 0x15171c, x0 + 7.4, 0, z0 + 2.2, g);
  tendaExt(g, x0 + 11.6, z0 + 2.4);
  var eq = etiqueta('ENG · câmera solo e no ombro', '#ffffff', 0.55); eq.position.set(x0 + 9.6, 2.2, z0 + 4.4); g.add(eq);
  caixa(0.04, 0.9, 0.04, 0x59627a, x0 + 10.0, 0, z0 + 5.2, g); caixa(0.34, 0.22, 0.06, 0xffffff, x0 + 10.0, 0.9, z0 + 5.2, g, { emissive:0xffffff, emissiveIntensity:0.9 });
  [[6.4, 0.7], [6.4, 3.5], [6.4, 6.9], [13.2, 9.2]].forEach(function(c){
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 8), mat(0xff7a1a, { roughness:0.7 })); cone.position.set(x0 + c[0], 0.21, z0 + c[1]); g.add(cone); });
  bloqueioExt(g, x0 + 7.4, z0 + 9.55, 2.0, 0); bloqueioExt(g, x0 + 9.6, z0 + 9.55, 2.0, 0); bloqueioExt(g, x0 + 11.8, z0 + 9.55, 2.0, 0);
  bloqueioExt(g, x0 + 13.65, z0 + 8.0, 2.0, Math.PI / 2); bloqueioExt(g, x0 + 13.65, z0 + 6.0, 2.0, Math.PI / 2);
  posteExt(g, x0 + 13.4, z0 + 0.6); posteExt(g, x0 + 0.5, z0 + 9.4);
  caixa(0.9, 0.9, 0.6, 0x39435e, x0 + 12.6, 0, z0 + 8.9, g);
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
}

SALAS.forEach(construirSala);

// ── Antenas de recepção (RX01–RX06, as mesmas da tela /api/antenas) ao lado do gerador, com os cabos até o rack dos decoders ──
// Pedido do Guilherme (2026-11-10): "rack de decoders, salvo engano rack 13". Pelos dados da planilha o R13 é a "Rede core"; a recepção
// de satélite (demoduladores, IRDs, MediaKind RX) está no R02 "Sync e recepção", que também fica no fundo do CPD, do lado do gerador.
// Pra mudar o rack de destino, é só trocar o código abaixo.
var RACK_DECODERS = 'R02';
var ANTENAS_MAPA = [
  { id:'RX01', sat:'IS35e', pols:['L','R'], cor:0xe5233a }, { id:'RX02', sat:'SES14', pols:['L','R'], cor:0x2f6fed },
  { id:'RX03', sat:'SES14', pols:['L','R'], cor:0xffb020 }, { id:'RX04', sat:'IS34', pols:['V','H'], cor:0x2fb67c },
  { id:'RX05', sat:'D2', pols:['V','H'], cor:0x7a5af8 }, { id:'RX06', sat:'AMZ3', pols:['V','H'], cor:0xe0b030 }
];
var alvosAntena = [];
function funcaoDoRack(cod){ var d = (RACKS_LAYOUT || []).filter(function(x){ return x.c === cod; })[0]; return d && d.f ? d.f : ''; }
(function construirAntenas(){
  var cpd = porId.cpd, xAnt = 12.2, xRiser = 11.4, zRack = cpd.z + 2.6 + (13 - (parseInt(String(RACK_DECODERS).replace(/[^0-9]/g, ''), 10) || 0)) * 1.1;
  var xRack = cpd.x + cpd.w/2, gesso = mat(0xe9edf2, { side:THREE.DoubleSide, roughness:0.6 }), ferro = mat(0x6d7686);
  // eletrocalha (bandeja dos cabos) do gerador até o rack
  caixa(8.8, 0.06, 0.5, 0x8a93a3, (xRack + 0.4 + xRiser)/2, 2.44, zRack, cena);
  function tubo(a, b, cor){
    var d = new THREE.Vector3().subVectors(b, a), len = d.length(); if (len < 0.001) return;
    var m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), mat(cor, { roughness:0.5 }));
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); cena.add(m);
  }
  ANTENAS_MAPA.forEach(function(a, i){
    var zi = 44.2 + i * 1.7, yi = 2.55 + i * 0.06, xr = xRack + (i - 2.5) * 0.12;
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.0, 8), ferro); base.position.set(xAnt, 0.5, zi); base.userData.antena = a.id; cena.add(base); alvosAntena.push(base);
    var g = new THREE.Group(); g.position.set(xAnt, 1.05, zi); g.rotation.x = -(Math.PI/2 - 0.75); cena.add(g);
    var cap = new THREE.SphereGeometry(1.15, 20, 8, 0, Math.PI * 2, 0, 0.68); cap.rotateX(Math.PI); cap.translate(0, 1.15 * Math.cos(0.68), 0);
    var prato = new THREE.Mesh(cap, gesso); prato.castShadow = true; prato.userData.antena = a.id; g.add(prato); alvosAntena.push(prato);
    var haste = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), ferro); haste.position.y = 0.35; g.add(haste);
    var lnb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), mat(a.cor, { roughness:0.4 })); lnb.position.y = 0.74; g.add(lnb);
    var rot = etiqueta(a.id + ' · ' + a.sat, '#d9e6ff', 0.4); rot.position.set(xAnt + 1.25, 1.7, zi); cena.add(rot); ROTULOS_SALA.push(rot);
    var P = [new THREE.Vector3(xAnt, 0.9, zi), new THREE.Vector3(xRiser, 0.9, zi), new THREE.Vector3(xRiser, yi, zi), new THREE.Vector3(xRiser, yi, zRack), new THREE.Vector3(xr, yi, zRack), new THREE.Vector3(xr, 2.14, zRack)];
    for (var k = 0; k < P.length - 1; k++) tubo(P[k], P[k + 1], a.cor);
  });
  var tit = etiqueta('Antenas → rack ' + RACK_DECODERS + (funcaoDoRack(RACK_DECODERS) ? ' · ' + funcaoDoRack(RACK_DECODERS) : ''), '#9ad7ff', 0.62); tit.position.set(8.2, 3.4, zRack); cena.add(tit); ROTULOS_SALA.push(tit);
})();

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
  SALAS.forEach(function(s){ if (s.tipo === 'ext' || s.tipo === 'nuvem') return; minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x + s.w); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z + s.d); });
  var teto = new THREE.Mesh(new THREE.PlaneGeometry(maxX-minX, maxZ-minZ), new THREE.MeshStandardMaterial({ color:0x15171c, roughness:1, side:THREE.DoubleSide }));
  teto.rotation.x = Math.PI/2; teto.position.set((minX+maxX)/2, PE_DIREITO, (minZ+maxZ)/2); grupoPasseio.add(teto);
  var mSpot = new THREE.MeshBasicMaterial({ color:0xfff4e0 }), gSpot = new THREE.CircleGeometry(0.09, 16);
  function spot(x, z){ var m = new THREE.Mesh(gSpot, mSpot); m.rotation.x = Math.PI/2; m.position.set(x, PE_DIREITO-0.01, z); grupoPasseio.add(m); }
  SALAS.forEach(function(s){
    if (s.tipo === 'ext' || s.tipo === 'nuvem') return;
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
// Maquete do esquema elétrico montado pelo Alex (AutoPrev, "Estrutura elétrica 3D") no telhado, ao lado das antenas, no lugar do gerador
// provisório (Guilherme, 2026-11-10). É uma cópia reduzida da camada "Elétrica" (mesmos quadros e cabos, sem rótulos pequenos e sem os
// pontinhos); clicar nela abre a camada Elétrica completa, com os rótulos e o painel de cada quadro.
(function maqueteEletrica(){
  var k = 0.22, cx = 27.6, cz = 47.8, mini = grupoEle.clone(true);
  mini.visible = true; mini.scale.set(k, k, k);
  mini.position.set(cx - k*ew(37), 0.42, cz - k*ez(20));
  mini.traverse(function(o){ if (o.isSprite || (o.geometry && o.geometry.type === 'SphereGeometry')) o.visible = false; });
  cena.add(mini);
  var mesa = new THREE.Mesh(new THREE.BoxGeometry(84*k + 0.8, 0.4, 50*k + 0.8), mat(0x1d2740, { roughness:0.7 }));
  mesa.position.set(cx, 0.2, cz); mesa.castShadow = true; mesa.userData.eleMini = true; cena.add(mesa); alvosAntena.push(mesa);
  var rot = etiqueta('Estrutura elétrica 3D · esquema do Alex (clique pra abrir)', '#4cc9f0', 0.7); rot.position.set(cx, 3.0, cz - 5.8); cena.add(rot); ROTULOS_SALA.push(rot);
})();
var modoEle = false;
function mostrarEletrica(on){ if (on) camTravada = false; modoEle = on; grupoEle.visible = on; if (on) { alvoDest.set(ew(37), 0, ez(20)); distDest = 92; phiDest = 0.5; thetaDest = 0; painelEletrica(); } }
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
  atualizarContagemSalas();
}
// Quantas pessoas estão trabalhando em cada sala, num selo verde visível de longe (os bonecos sozinhos somem na visão geral)
var selosPessoas = {};
function atualizarContagemSalas(){
  var cont = {};
  DADOS.pessoas.forEach(function(p){ cont[p.sala] = (cont[p.sala] || 0) + 1; });
  Object.keys(selosPessoas).forEach(function(id){ if (cont[id] !== selosPessoas[id].n) { cena.remove(selosPessoas[id].s); delete selosPessoas[id]; } });
  Object.keys(cont).forEach(function(id){
    var sala = porId[id]; if (!sala || selosPessoas[id]) return;
    var s = etiqueta(cont[id] + (cont[id] === 1 ? ' pessoa' : ' pessoas'), '#9df3c4', 1.4);
    s.position.set(sala.x + sala.w/2, 2.3, sala.z + sala.d/2 + (sala.d > 6 ? 2.2 : 0));
    cena.add(s); selosPessoas[id] = { s:s, n:cont[id] };
  });
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
  // O YouTube responde 404 com uma imagem cinza de 120 px quando a live não tem miniatura pública: o navegador mostra essa
  // imagem sem dar erro. Então confere o tamanho; se for a cinza, tenta a próxima e, no fim, desenha uma cartela própria.
  var img = document.createElement('img'); img.alt = '';
  var tentativas = ['hqdefault_live.jpg', 'maxresdefault_live.jpg', 'sddefault_live.jpg', 'hqdefault.jpg'], quala = 0;
  function cartela(){
    img.style.display = 'none';
    if (a.querySelector('.tv3d-cartela')) return;
    var c = document.createElement('div'); c.className = 'tv3d-cartela';
    var t1 = document.createElement('small'); t1.textContent = 'LIVEMODE · CAZÉTV';
    var t2 = document.createElement('b'); t2.textContent = box.nomeEv || 'Ao vivo';
    c.appendChild(t1); c.appendChild(t2); a.insertBefore(c, a.firstChild);
  }
  function proxima(){ if (quala < tentativas.length) { img.src = 'https://i.ytimg.com/vi/' + id + '/' + tentativas[quala++]; } else { cartela(); } }
  img.onload = function(){ if (img.naturalWidth > 0 && img.naturalWidth <= 120) proxima(); else { img.style.display = ''; var c0 = a.querySelector('.tv3d-cartela'); if (c0) c0.remove(); } };
  img.onerror = proxima;
  proxima();
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
  box.idVideo = id; box.nomeEv = nomeEv || '';
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
  function borda(w, d, x, z){ if (s.tipo === 'nuvem') return; var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mBorda); m.position.set(x, y, z); g.add(m); }
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
  nuvemNoAr = !!noAr.nuvem;
  atualizarUMs();
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
  h += '<div id="bloco-sensores">' + blocoSensores() + '</div>';
  h += '<div id="bloco-zabbix">' + blocoZabbix() + '</div>';
  h += '<h2>Eventos de hoje</h2>';
  var aVir = DADOS.eventos.filter(function(e){ return !e.encerrado; });
  if (!aVir.length) h += '<div class="vazio">' + (DADOS.eventos.length ? 'Todos os eventos de hoje já terminaram.' : 'Sem eventos hoje.') + '</div>';
  aVir.forEach(function(e){
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
function painelAntenas(){ editandoAvatar = false; rascunhoAv = null; falando = false;
  var p = document.getElementById('painel');
  var h = '<button class="btn" id="voltar">← Visão geral</button><h2>Antenas de recepção</h2>';
  h += '<div class="vazio">6 antenas no telhado, ao lado do gerador. Os cabos seguem pela eletrocalha e entram no rack <b>' + esc(RACK_DECODERS) + '</b>' + (funcaoDoRack(RACK_DECODERS) ? ' (' + esc(funcaoDoRack(RACK_DECODERS)) + ')' : '') + ', onde ficam os demoduladores, IRDs e receptores.</div>';
  ANTENAS_MAPA.forEach(function(a){ h += '<div class="ev" style="border-left:4px solid #' + ('000000' + a.cor.toString(16)).slice(-6) + '"><b>' + esc(a.id) + ' · ' + esc(a.sat) + '</b><small>Polarização ' + esc(a.pols.join(' / ')) + ' · cabo da mesma cor até o rack ' + esc(RACK_DECODERS) + '</small></div>'; });
  h += '<a class="yt" href="/api/antenas" target="_blank" rel="noopener">Abrir checklists e manutenção das antenas</a>';
  p.innerHTML = h; var v = document.getElementById('voltar'); if (v) v.onclick = function(){ irPara(null); painelGeral(); };
}
function painelRack(cod){ editandoAvatar = false; rascunhoAv = null; falando = false;
  var p = document.getElementById('painel'); p.innerHTML = '<div class="vazio">Carregando rack…</div>';
  carregarRacks(function(){
    var r = (detalhesRacks.racks || []).filter(function(x){ return x.codigo === cod; })[0];
    var h = '<button class="btn" id="voltar">← Visão geral</button><h2>Rack ' + esc(cod) + '</h2>' + alertasDoRack(cod);
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
  var evs = DADOS.eventos.filter(function(e){ return (e.sala===id || e.controle===id) && !e.encerrado; });
  var pes = DADOS.pessoas.filter(function(p){ return p.sala===id; });
  var chs = DADOS.chamados.filter(function(c){ return c.sala===id; });
  var h = '<button class="btn" id="voltar">← Visão geral</button><h2>' + esc(s.nome) + '</h2>';
  h += '<h2>Eventos</h2>'; if(!evs.length) h += '<div class="vazio">Nenhum evento nesta sala agora ou mais tarde hoje.</div>';
  evs.forEach(function(e){ h += '<div class="ev' + (e.noAr?' ar':'') + '"><b>' + esc(e.nome) + '</b>' + (e.noAr?'<span class="tag">NO AR</span>':'') + '<small>' + esc(e.inicio) + (e.fim?'–'+esc(e.fim):'') + '</small>' + extraEvento(e) + '</div>'; });
  h += '<h2>Pessoas aqui</h2>'; if(!pes.length) h += '<div class="vazio">Ninguém.</div>';
  pes.forEach(function(p){ h += '<span class="pes" title="' + esc(p.evento||'') + '">' + esc(p.nome) + ' · ' + esc(p.funcao || p.turno) + (p.estado ? ' · ' + esc(p.estado) : '') + '</span>'; });
  h += '<h2>Chamados</h2>'; if(!chs.length) h += '<div class="vazio">Nenhum chamado aberto.</div>';
  chs.forEach(function(c){ h += '<div class="cha ' + (c.prioridade==='Alta'?'':c.prioridade==='Média'?'m':'b') + '"><b>' + esc(c.id) + '</b> · ' + esc(c.equipamento) + '<br><small>' + esc(c.problema) + '</small></div>'; });
  document.getElementById('painel').innerHTML = h;
  document.getElementById('voltar').onclick = function(){ irPara(null); painelGeral(); };
}

// ── Câmera (orbit simples: arrastar = girar, Shift/botão direito = mover, roda/pinça = zoom) ──
var alvo = new THREE.Vector3(17, 0, 19), alvoDest = alvo.clone();
var theta = -0.45, phi = 0.72, dist = 58, distDest = dist, thetaDest = theta, phiDest = phi;
// Visão geral TRAVADA (Guilherme, 2026-11-10): ao apertar "Visão geral" a câmera vai pra lá e fica parada (sem girar, mover nem dar zoom).
// Destrava ao ir pra uma sala/botão, clicar numa sala, abrir a Elétrica ou entrar no Passear.
var TOQUE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
var camTravada = false, DICA_PADRAO = TOQUE ? '1 dedo = girar · 2 dedos = mover e dar zoom (pinça) · toque numa sala' : ((document.getElementById('dica') || {}).textContent || '');
{ var dicaIni = document.getElementById('dica'); if (dicaIni && TOQUE) dicaIni.textContent = DICA_PADRAO; }
function irPara(id){
  if (intro) { intro = null; }
  camTravada = !id;
  var dicaEl = document.getElementById('dica'); if (dicaEl) dicaEl.textContent = id ? DICA_PADRAO : 'Visão geral fixa · clique numa sala ou num botão pra mover a câmera';
  if (!id) { alvoDest.set(17,-6,24); distDest = 66; phiDest = 1.02; thetaDest = -0.55; return; }   // de lado, pra ver a planta no alto e o letreiro nas fachadas
  var g = grupoSalas[id]; if (!g) return;
  alvoDest.set(g.centro.x, g.sala.elev || 0, g.centro.z); distDest = Math.max(12, Math.max(g.sala.w, g.sala.d)*1.5); phiDest = 0.85;
  if (id === 'cpd') thetaDest = 1.0;   // olha do lado leste, onde fica a frente dos racks
}
// Entrada "de cima pra baixo": o mapa abre alto, vendo Botafogo, e desce até o 5º andar da Livemode.
var camSuave = 0.12, intro = null;
// Abertura (Guilherme, 2026-11-11): a câmera começa no Cristo Redentor, de frente pro rosto, sobe e atravessa Botafogo girando até pousar no 5º andar da Livemode.
// Chega no mesmo ponto de repouso de sempre (alvoDest/distDest/phiDest/thetaDest). Tocar, arrastar, rodar a roda ou apertar um botão pula a abertura.
if (!DEMO && !PARAM.cam) {
  intro = { t0:null, dur:12500, th0:Math.PI/2 + 0.35, ph0:1.45, d0:105, a0:new THREE.Vector3(CORC.x, TERREO + CORC.alt + 27, CORC.z) };
  alvo.copy(intro.a0); dist = intro.d0; phi = intro.ph0; theta = intro.th0;
}
function cancelarIntro(){ if (!intro) return; intro = null; alvoDest.copy(alvo); distDest = dist; phiDest = phi; thetaDest = theta; }
function posCamera(){
  if (passeio) {
    var py0 = passeio.y || 0;
    if (passeio.rua) { alvo.set(passeio.x, TERREO, passeio.z); alvoDest.copy(alvo); }
    if (terceira) {
      var el = Math.max(-0.05, Math.min(1.1, 0.28 - passeio.pitch)), ce = Math.cos(el), sy3 = Math.sin(passeio.yaw), cy3 = Math.cos(passeio.yaw), d3 = 2.4;
      var tc = 0.3; while (tc <= 2.4 && !bate(passeio.x + sy3*ce*tc, passeio.z + cy3*ce*tc)) tc += 0.1;
      d3 = Math.max(0.3, Math.min(2.4, tc - 0.15));
      camera.position.set(passeio.x + sy3*ce*d3, py0 + Math.max(0.35, 1.0 + Math.sin(el)*d3), passeio.z + cy3*ce*d3);
      camera.lookAt(passeio.x, py0 + 0.95, passeio.z);
      if (boneco) boneco.visible = d3 > 0.8;
      return;
    }
    camera.position.set(passeio.x, OLHO + py0, passeio.z); camera.rotation.set(passeio.pitch, passeio.yaw, 0, 'YXZ'); return;
  }
  if (intro) {
    var tn = performance.now(); if (intro.t0 == null) intro.t0 = tn;
    var uu = Math.min(1, (tn - intro.t0)/intro.dur), ee = uu*uu*(3 - 2*uu);
    alvo.set(intro.a0.x + (alvoDest.x - intro.a0.x)*ee, intro.a0.y + (alvoDest.y - intro.a0.y)*ee, intro.a0.z + (alvoDest.z - intro.a0.z)*ee);
    dist = intro.d0 * Math.pow(distDest/intro.d0, ee) * (1 + 5.5*Math.sin(Math.PI*ee));
    phi = intro.ph0 + (phiDest - intro.ph0)*ee; theta = intro.th0 + (thetaDest - intro.th0)*ee;
    if (uu >= 1) { intro = null; alvo.copy(alvoDest); dist = distDest; phi = phiDest; theta = thetaDest; }
    camera.position.set(alvo.x + dist*Math.sin(phi)*Math.sin(theta), alvo.y + dist*Math.cos(phi), alvo.z + dist*Math.sin(phi)*Math.cos(theta));
    camera.lookAt(alvo); return;
  }
  alvo.lerp(alvoDest, camSuave); dist += (distDest-dist)*camSuave; theta += (thetaDest-theta)*camSuave*1.6; phi += (phiDest-phi)*camSuave*1.6;
  camera.position.set(alvo.x + dist*Math.sin(phi)*Math.sin(theta), alvo.y + dist*Math.cos(phi), alvo.z + dist*Math.sin(phi)*Math.cos(theta));
  camera.lookAt(alvo);
}
var arrasto = null, moveu = false;
var ponteiros = {}, pinca = null;
function nPonteiros(){ return Object.keys(ponteiros).length; }
function medidaPinca(){ var k = Object.keys(ponteiros), p = ponteiros[k[0]], q = ponteiros[k[1]]; return { d:Math.max(1, Math.hypot(p.x-q.x, p.y-q.y)), x:(p.x+q.x)/2, y:(p.y+q.y)/2 }; }
renderer.domElement.addEventListener('contextmenu', function(e){ e.preventDefault(); });
renderer.domElement.addEventListener('pointerdown', function(e){
  cancelarIntro();
  ponteiros[e.pointerId] = { x:e.clientX, y:e.clientY };
  if (nPonteiros() === 2) { pinca = medidaPinca(); arrasto = null; moveu = true; }
  else if (nPonteiros() === 1) { arrasto = { x:e.clientX, y:e.clientY, pan:(e.button===2||e.shiftKey), toque:(e.pointerType==='touch') }; moveu = false; }
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (er) {}
});
renderer.domElement.addEventListener('pointermove', function(e){
  if (ponteiros[e.pointerId]) { ponteiros[e.pointerId].x = e.clientX; ponteiros[e.pointerId].y = e.clientY; }
  if (pinca && nPonteiros() === 2) {
    var m = medidaPinca();
    if (!passeio && !camTravada) {
      distDest = Math.max(6, Math.min(2500, distDest*(pinca.d/m.d)));
      var kk = dist*0.0016, mdx = m.x-pinca.x, mdy = m.y-pinca.y;
      alvoDest.x -= (mdx*Math.cos(theta) + mdy*Math.sin(theta))*kk; alvoDest.z -= (-mdx*Math.sin(theta) + mdy*Math.cos(theta))*kk;
    }
    pinca = m; return;
  }
  if(!arrasto) return; var dx=e.clientX-arrasto.x, dy=e.clientY-arrasto.y; if(Math.abs(dx)+Math.abs(dy)>(arrasto.toque?10:3)) moveu = true;
  arrasto.x=e.clientX; arrasto.y=e.clientY;
  if (passeio) { passeio.yaw -= dx*0.005; passeio.pitch = Math.max(-1.1, Math.min(1.1, passeio.pitch - dy*0.005)); return; }
  if (camTravada) return;
  if (arrasto.pan) { var k=dist*0.0016; alvoDest.x -= (dx*Math.cos(theta) + dy*Math.sin(theta))*k; alvoDest.z -= (-dx*Math.sin(theta) + dy*Math.cos(theta))*k; }
  else { thetaDest -= dx*0.006; phiDest = Math.max(0.15, Math.min(1.45, phiDest - dy*0.006)); }
});
function soltarPonteiro(e, clique){
  delete ponteiros[e.pointerId]; if (nPonteiros() < 2) pinca = null;
  var n = nPonteiros();
  if (n === 0) { var foi = arrasto && !moveu; arrasto = null; if (foi && clique) clicar(e); }
  else if (n === 1) { var k0 = Object.keys(ponteiros)[0]; arrasto = { x:ponteiros[k0].x, y:ponteiros[k0].y, pan:false, toque:true }; moveu = true; }
}
renderer.domElement.addEventListener('pointerup', function(e){ soltarPonteiro(e, true); });
renderer.domElement.addEventListener('pointercancel', function(e){ soltarPonteiro(e, false); });
renderer.domElement.addEventListener('wheel', function(e){ e.preventDefault(); cancelarIntro(); if (passeio || camTravada) return; distDest = Math.max(6, Math.min(2500, distDest*(1+e.deltaY*0.001))); }, { passive:false });

var ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function clicar(e){
  var r = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-r.left)/r.width)*2-1; mouse.y = -((e.clientY-r.top)/r.height)*2+1;
  ray.setFromCamera(mouse, camera);
  if (modoEle) { var hitE = ray.intersectObjects(alvosEle, false)[0]; if (hitE) { painelNo(hitE.object.userData.eletr); } return; }
  var hitA = ray.intersectObjects(alvosAntena, false)[0];
  if (hitA && hitA.object.userData.eleMini) { if (passeio) sairPasseio(); mostrarEletrica(true); return; }
  if (hitA) { if (passeio) document.body.classList.add('com-painel'); painelAntenas(); return; }
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
var terceira = true, boneco = null, rumo = 0, andou = 0;
var LIMITE_RUA = NIVEL >= 2 ? 140 : LEVE ? 240 : 450;
function baterRua(x, z){
  if (Math.hypot(x - PCX, z - PCZ) > LIMITE_RUA) return true;
  if (x > 250 || Math.hypot(x - BAIA.x, z - BAIA.z) < 440) return true;
  for (var m = 0; m < MORROS_EXCL.length; m++) if (Math.hypot(x - MORROS_EXCL[m][0], z - MORROS_EXCL[m][1]) < MORROS_EXCL[m][2] - 10) return true;
  if (x > PF.x0 - 0.7 && x < PF.x1 + 0.7 && z > PF.z0 - 0.3 && z < PF.z1 + 0.8) return true;
  var i;
  for (i = 0; i < RECT_RUA.length; i++) { var r = RECT_RUA[i]; if (Math.abs(x - r.x) < r.hw + 0.3 && Math.abs(z - r.z) < r.hd + 0.3) return true; }
  for (i = 0; i < ARV.length; i++) { var a = ARV[i]; if (Math.abs(x - a[0]) < 0.6 && Math.abs(z - a[1]) < 0.6) return true; }
  for (i = 0; i < ESTAC.length; i++) { var c = ESTAC[i], lx = (c[2] > 1.2 && c[2] < 1.9) || (c[2] < -1.2 && c[2] > -1.9); if (Math.abs(x - c[0]) < (lx ? 2.3 : 1.0) + 0.2 && Math.abs(z - c[1]) < (lx ? 1.0 : 2.3) + 0.2) return true; }
  return false;
}
function bate(x, z){ if (passeio && passeio.rua) return baterRua(x, z); for (var i=0;i<PAREDES.length;i++){ var p = PAREDES[i]; if (Math.abs(x-p.x) < p.hw+RAIO && Math.abs(z-p.z) < p.hd+RAIO) return true; } return false; }
function entrarPasseio(){
  cancelarIntro();
  camTravada = false;
  if (modoEle) mostrarEletrica(false);
  passeio = { x:1.1, z:7.25, yaw:-Math.PI/2, pitch:-0.05 };   // no hall, de frente pra porta da Central   // no corredor, na porta da Central, olhando pra dentro
  rumo = passeio.yaw + Math.PI; andou = 0;
  boneco = new THREE.Group(); montarBoneco(boneco, '', avatarValido(DADOS.eu && DADOS.eu.avatar)); boneco.position.set(passeio.x, 0, passeio.z); boneco.rotation.y = rumo; boneco.visible = terceira; cena.add(boneco);
  camera.fov = terceira ? 60 : 70; camera.updateProjectionMatrix(); modoEmpresa(true);
  atualizarBotaoVisao();
  document.body.classList.add('passeio'); document.body.classList.remove('com-painel');
  document.getElementById('passear-btn').textContent = '⬆ Visão de cima';
  var dc = document.getElementById('dica'); if (dc) dc.textContent = TOQUE ? 'Joystick = andar · arraste = olhar em volta · toque = detalhes' : 'Setas/WASD = andar (Shift corre) · arraste = olhar em volta · V = trocar visão · clique = detalhes';
}
function sairPasseio(){
  if (passeio) enviarPresenca({ sair:true });
  passeio = null; teclas = {}; joy.x = joy.y = 0; alvoDest.set(17, 0, 19);
  if (boneco) { cena.remove(boneco); boneco = null; }
  camera.fov = 45; camera.updateProjectionMatrix(); modoEmpresa(false);
  document.body.classList.remove('passeio'); document.body.classList.remove('com-painel');
  document.getElementById('passear-btn').textContent = '🚶 Passear';
  var dc = document.getElementById('dica'); if (dc) dc.textContent = DICA_PADRAO;
}
function andar(dt){
  if (!passeio) return;
  var f = (teclas.KeyW||teclas.ArrowUp?1:0) - (teclas.KeyS||teclas.ArrowDown?1:0) - joy.y;
  var l = (teclas.KeyD||teclas.ArrowRight?1:0) - (teclas.KeyA||teclas.ArrowLeft?1:0) + joy.x;
  if (teclas.KeyQ) passeio.yaw += dt*1.8;
  if (teclas.KeyE) passeio.yaw -= dt*1.8;
  var correndo = !!(teclas.ShiftLeft||teclas.ShiftRight), mexendo = !!(f || l), mx = 0, mz = 0;
  if (mexendo) {
    var n = Math.min(1, Math.sqrt(f*f + l*l)) / Math.sqrt(f*f + l*l), v = (correndo ? 4.2 : 2.2) * (passeio.rua ? 1.8 : 1) * dt * n;
    var sy = Math.sin(passeio.yaw), cy = Math.cos(passeio.yaw);
    mx = (-sy*f + cy*l) * v; mz = (-cy*f - sy*l) * v;
    if (!bate(passeio.x + mx, passeio.z)) passeio.x += mx;
    if (!bate(passeio.x, passeio.z + mz)) passeio.z += mz;
  }
  if (boneco) {
    boneco.position.x = passeio.x; boneco.position.z = passeio.z;
    if (mexendo) {
      var dd = Math.atan2(mx, mz) - rumo; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); rumo += dd * Math.min(1, dt*10);
      andou += dt * (correndo ? 13 : 8) * (passeio.rua ? 0.8 : 1);
    }
    boneco.rotation.y = rumo; boneco.position.y = (passeio.y || 0) + (mexendo ? Math.abs(Math.sin(andou)) * 0.07 : 0);
  }
  if (passeio.rua && Math.abs(passeio.x - PCX) < 6 && passeio.z > PF.z0 - 1.0) voltarCentral();
}
function atualizarBotaoRua(){ var bt = document.getElementById('rua-btn'); if (bt) bt.textContent = passeio && passeio.rua ? '🏢 Entrar na central' : '🏙 Ir pra rua'; var dc = document.getElementById('dica'); if (dc && passeio) dc.textContent = passeio.rua ? (TOQUE ? 'Joystick = andar pela rua · arraste = olhar · a portaria te leva de volta' : 'Setas/WASD = andar pela rua (Shift corre) · arraste = olhar · V = trocar visão · a portaria te leva de volta') : (TOQUE ? 'Joystick = andar · arraste = olhar em volta · toque = detalhes' : 'Setas/WASD = andar (Shift corre) · arraste = olhar em volta · V = trocar visão · clique = detalhes'); }
function irParaRua(){
  if (!passeio) return;
  passeio.rua = true; passeio.y = TERREO; passeio.x = PCX; passeio.z = PF.z0 - 6; passeio.yaw = 0; passeio.pitch = -0.05; rumo = Math.PI; teclas = {};
  modoEmpresa(false); document.body.classList.remove('com-painel'); if (boneco) { boneco.position.set(passeio.x, TERREO, passeio.z); boneco.rotation.y = rumo; boneco.scale.setScalar(1.4); } atualizarBotaoRua();
}
function voltarCentral(){
  if (!passeio) return;
  passeio.rua = false; passeio.y = 0; passeio.x = 1.1; passeio.z = 7.25; passeio.yaw = -Math.PI/2; passeio.pitch = -0.05; rumo = passeio.yaw + Math.PI; teclas = {};
  modoEmpresa(true); if (boneco) { boneco.position.set(passeio.x, 0, passeio.z); boneco.rotation.y = rumo; boneco.scale.setScalar(1); } atualizarBotaoRua();
}
function atualizarBotaoVisao(){ var bt = document.getElementById('visao-btn'); if (bt) bt.textContent = terceira ? '👁 1ª pessoa' : '🧍 3ª pessoa'; }
function alternarVisao(){
  terceira = !terceira; if (!passeio) return;
  camera.fov = terceira ? 60 : 70; camera.updateProjectionMatrix(); if (boneco) boneco.visible = terceira; atualizarBotaoVisao();
}
window.addEventListener('keydown', function(e){
  if (!passeio) return; var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
  if (e.code === 'Escape') { sairPasseio(); return; }
  if (e.code === 'KeyV') { alternarVisao(); return; }
  if (/^(Key[WASDQE]|Arrow|Shift)/.test(e.code)) { teclas[e.code] = true; e.preventDefault(); }
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
if (psBtn && psBtn.parentNode) { var vzBtn = document.createElement('button'); vzBtn.className = 'btn btn-mostrar'; vzBtn.id = 'visao-btn'; psBtn.parentNode.insertBefore(vzBtn, psBtn.nextSibling); vzBtn.onclick = alternarVisao; atualizarBotaoVisao();
  var ruaBtn = document.createElement('button'); ruaBtn.className = 'btn btn-mostrar'; ruaBtn.id = 'rua-btn'; psBtn.parentNode.insertBefore(ruaBtn, psBtn.nextSibling); ruaBtn.onclick = function(){ if (passeio && passeio.rua) voltarCentral(); else irParaRua(); }; atualizarBotaoRua(); }
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
      g.position.set(p.x, p.rua ? TERREO : 0, p.z); v = visitantes[p.nome] = { grupo:g, x:p.x, z:p.z, yaw:p.yaw, av:chave };
    }
    v.x = p.x; v.z = p.z; v.yaw = p.yaw; v.rua = !!p.rua;
    if (atores[p.nome]) atores[p.nome].grupo.visible = false;   // não mostra a mesma pessoa sentada e andando
  });
  Object.keys(visitantes).forEach(function(n){ if (!vivos[n]) { cena.remove(visitantes[n].grupo); delete visitantes[n]; if (atores[n]) atores[n].grupo.visible = true; } });
}
function animarVisitantes(dt){
  Object.keys(visitantes).forEach(function(n){ var v = visitantes[n], g = v.grupo, k = Math.min(1, dt*5);
    g.position.x += (v.x - g.position.x)*k; g.position.z += (v.z - g.position.z)*k; g.position.y = v.rua ? TERREO : 0; g.rotation.y = v.yaw + Math.PI; });
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
      enviarPresenca({ x:passeio.x, z:passeio.z, yaw:passeio.yaw, rua:passeio.rua ? 1 : 0, avatar:(DADOS.eu && DADOS.eu.avatar) || null }); }
  } else if (agora - ultimoEnvio > 4000) {
    ultimoEnvio = agora;
    fetch('/api/presenca', { credentials:'same-origin' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if (d) receberPresenca(d); }).catch(function(){});
  }
}
setInterval(cicloPresenca, 2000);
window.addEventListener('pagehide', function(){ if (passeio && navigator.sendBeacon) navigator.sendBeacon('/api/presenca', new Blob([JSON.stringify({ sair:true })], { type:'application/json' })); });

// onde estou (pro rótulo do "olha isso"): sala + rack mais perto, se estiver no CPD
function ondeEstou(x, z){
  if (passeio && passeio.rua) return 'Rua em Botafogo';
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
// ── Sensores de temperatura da central (Nextcon IoT): a ponte (dentro da rede) manda as leituras, o Pulse guarda e o mapa mostra ──
var SENSORES = {};
// Onde cada sensor está (Guilherme, 2026-11-10: os três ficam no CPD) e o nome que aparece. Ajuste x/z pra mover o sensor na sala.
var SENSOR_LUGAR = {
  'nextcon-1': { nome:'Sensor 1', sala:'cpd', x:5.2, z:36.5 },
  'nextcon-2': { nome:'Sensor 2', sala:'cpd', x:5.2, z:42.5 },
  'nextcon-3': { nome:'Sensor 3', sala:'cpd', x:5.2, z:48.5 }
};
function nomeSensor(s){ return (SENSOR_LUGAR[s.id] && SENSOR_LUGAR[s.id].nome) || s.nome; }
var marcadoresSensor = {};
function soltarMarcadorSensor(m){
  cena.remove(m.g); var i = ROTULOS_SALA.indexOf(m.rot); if (i >= 0) ROTULOS_SALA.splice(i, 1);
  m.g.traverse(function(o){ if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
}
// Caixinha do sensor na parede + rótulo "Sensor 1 · 20,1 °C" colorido pela temperatura (some do mapa se a leitura parar: fica cinza)
function desenharSensores3D(){
  Object.keys(SENSORES).forEach(function(id){
    var lg = SENSOR_LUGAR[id]; if (!lg) return;
    var s = SENSORES[id], velho = s.idade > 90000, corHex = velho ? '#7b86a0' : corTemp(s.temp);
    var txt = nomeSensor(s) + ' · ' + (s.temp != null && !velho ? s.temp.toFixed(1).replace('.', ',') + ' °C' : 'sem leitura');
    var m = marcadoresSensor[id];
    if (m && m.txt === txt && m.cor === corHex) return;
    if (m) soltarMarcadorSensor(m);
    var g = new THREE.Group();
    var caixa3 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(corHex) }));
    caixa3.position.set(lg.x, 1.55, lg.z); caixa3.userData.sensor = id; g.add(caixa3);
    var rot = etiqueta(txt, corHex, 0.85); rot.position.set(lg.x - 0.4, 2.8, lg.z); g.add(rot); ROTULOS_SALA.push(rot);
    cena.add(g); marcadoresSensor[id] = { g:g, rot:rot, txt:txt, cor:corHex };
  });
}
// Alerta a partir de 24 °C (decisão do Guilherme): verde até 24, amarelo de 24 a 27, vermelho de 27 pra cima, azul abaixo de 18
var LIMITE_ALERTA_TEMP = 24;
function corTemp(t){ return t >= 27 ? '#ff4d5e' : t >= LIMITE_ALERTA_TEMP ? '#ffb020' : t < 18 ? '#4cc9f0' : '#3ddc97'; }
function corCo2(c){ return c >= 1500 ? '#ff4d5e' : c >= 1000 ? '#ffb020' : '#9fb0d0'; }
function sparkTemp(hist){
  if (!hist || hist.length < 2) return '';
  var mn = Math.min.apply(null, hist), mx = Math.max.apply(null, hist);
  if (mx - mn < 2) { var med = (mx + mn) / 2; mn = med - 1; mx = med + 1; }
  var pts = hist.map(function(v, i){ return (i / (hist.length - 1) * 100).toFixed(1) + ',' + (18 - (v - mn) / (mx - mn) * 16).toFixed(1); }).join(' ');
  return '<svg viewBox="0 0 100 20" preserveAspectRatio="none" style="width:100%;height:24px;display:block;margin-top:4px"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
}
function textoIdade(ms){ var s = Math.round(ms / 1000); return s < 90 ? 'há ' + s + ' s' : 'sem leitura há ' + Math.round(s / 60) + ' min'; }
function blocoSensores(){
  var ids = Object.keys(SENSORES || {}).sort(); if (!ids.length) return '';
  var h = '<h2>Temperatura da central</h2>';
  ids.forEach(function(id){
    var s = SENSORES[id], velho = s.idade > 90000, cor = velho ? '#7b86a0' : corTemp(s.temp);
    h += '<div class="ev" style="border-left:4px solid ' + cor + '"><b>' + esc(nomeSensor(s)) + '</b><span class="tag" style="background:' + cor + ';color:#0b1020">' + (s.temp != null ? s.temp.toFixed(1) + ' °C' : '—') + '</span>' +
         '<small>' + (s.umid != null ? Math.round(s.umid) + '% umidade' : '') + (s.co2 != null ? ' · CO₂ <span style="color:' + corCo2(s.co2) + '">' + Math.round(s.co2) + ' ppm</span>' : '') + ' · ' + textoIdade(s.idade) + '</small>' +
         '<div style="color:' + cor + '">' + sparkTemp(s.hist) + '</div></div>';
  });
  return h;
}
function aplicarSensores(d){
  var novo = {}; Object.keys(d.sensores || {}).forEach(function(id){ var x = d.sensores[id]; x.idade = d.agora - x.t; novo[id] = x; });
  SENSORES = novo;
  var b = document.getElementById('bloco-sensores'); if (b) b.innerHTML = blocoSensores();
  desenharSensores3D();
  // faixa no topo enquanto algum sensor estiver acima do limite
  var faixa = document.getElementById('alerta-temp');
  if (faixa) {
    var quentes = Object.keys(novo).filter(function(id){ return novo[id].idade <= 90000 && novo[id].temp >= LIMITE_ALERTA_TEMP; });
    if (quentes.length) {
      var mx2 = Math.max.apply(null, quentes.map(function(id){ return novo[id].temp; }));
      faixa.textContent = 'CPD com temperatura alta: ' + quentes.map(function(id){ return nomeSensor(novo[id]) + ' ' + novo[id].temp.toFixed(1).replace('.', ',') + ' °C'; }).join(' · ');
      faixa.className = 'alerta-temp' + (mx2 >= 27 ? ' crit' : ''); faixa.hidden = false;
    } else { faixa.hidden = true; }
  }
  var chip = document.getElementById('sensor-chip');
  if (chip) {
    var vivos = Object.keys(novo).filter(function(id){ return novo[id].idade <= 90000 && novo[id].temp != null; });
    if (!vivos.length) { chip.textContent = ''; return; }
    var mx = Math.max.apply(null, vivos.map(function(id){ return novo[id].temp; }));
    chip.textContent = 'Central ' + mx.toFixed(1) + ' °C'; chip.style.color = corTemp(mx);
  }
}
function buscarSensores(){
  if (DEMO) { if (DEMO.sensores) aplicarSensores({ agora: Date.now(), sensores: DEMO.sensores }); return; }
  fetch('/api/sensores', { credentials:'same-origin', cache:'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if (d) aplicarSensores(d); }).catch(function(){});
}
buscarSensores(); setInterval(buscarSensores, LEVE ? 15000 : 10000);

// ── Alertas do Zabbix do CPD (do Bruno): o Pulse SÓ LÊ e mostra. Não reconhece alerta, não comanda nada e não fala na Alexa ──
// A ponte consulta o Zabbix (API, métodos *.get, usuário somente-leitura) e manda o resumo; aqui vira cor no rack, faixa no topo e lista no painel.
var ZBX = null;
var COR_SEV = ['#97aab3', '#7499ff', '#ffc859', '#ffa059', '#e97659', '#e45959'];
var NOME_SEV = ['Não classificado', 'Informação', 'Atenção', 'Média', 'Alta', 'Desastre'];
function idadeTxt(seg){ if (seg < 90) return seg + ' s'; if (seg < 5400) return Math.round(seg / 60) + ' min'; if (seg < 172800) return Math.round(seg / 3600) + ' h'; return Math.round(seg / 86400) + ' dias'; }
function zbxFresco(){ return !!(ZBX && !ZBX.erro && ZBX.idade <= 90000); }
function cartaoAlerta(p){
  var cor = COR_SEV[p.sev] || COR_SEV[0], seg = Math.max(0, Math.round(((ZBX.agoraSrv || Date.now()) - p.desde * 1000) / 1000));
  return '<div class="ev" style="border-left:4px solid ' + cor + '"><b>' + esc(p.equip || p.host) + '</b><span class="tag" style="background:' + cor + ';color:#0b1020">' + esc(NOME_SEV[p.sev] || '') + '</span>' +
    '<small>' + esc(p.nome) + '</small><small>' + (p.rack ? 'Rack ' + esc(p.rack) + ' · ' : '') + esc(p.host) + ' · há ' + idadeTxt(seg) + (p.ack ? ' · reconhecido' : '') + '</small>' +
    (p.link ? '<a class="yt" href="' + esc(p.link) + '" target="_blank" rel="noopener">Abrir no painel</a>' : '') + '</div>';
}
function alertasDoRack(cod){
  if (!zbxFresco()) return '';
  var l = ZBX.problemas.filter(function(p){ return p.rack === cod; }).sort(function(a, b){ return b.sev - a.sev; });
  if (!l.length) return '';
  var h = '<h2>Alertas do Zabbix neste rack</h2>'; l.forEach(function(p){ h += cartaoAlerta(p); }); return h;
}
function blocoZabbix(){
  if (!ZBX) return '';
  var h = '<h2>Alertas do CPD (monitoramento)</h2>';
  if (ZBX.erro) return h + '<div class="vazio">A ponte não conseguiu ler o monitoramento: ' + esc(ZBX.erro) + '</div>';
  if (!zbxFresco()) return h + '<div class="vazio">Sem dados do monitoramento há ' + idadeTxt(Math.round(ZBX.idade / 1000)) + ' (a ponte parou?).</div>';
  var l = ZBX.problemas.slice().sort(function(a, b){ return b.sev - a.sev || b.desde - a.desde; });
  var T = ZBX.totais;
  if (T) h += '<div class="vazio">' + T.total + ' equipamentos · <span style="color:#3ddc97">' + T.ok + ' ok</span> · <span style="color:#ffa059">' + T.alerta + ' alerta</span> · <span style="color:#e45959">' + T.critico + ' crítico</span> · ' + T.offline + ' offline</div>';
  if (!l.length) return h + '<div class="ev" style="border-left:4px solid #3ddc97"><b>Nenhum alerta ativo ✓</b><small>' + (ZBX.hostsTotal ? ZBX.hostsTotal + ' equipamentos monitorados' : 'Zabbix ' + esc(ZBX.versao)) + '</small></div>';
  l.slice(0, 12).forEach(function(p){ h += cartaoAlerta(p); });
  if (l.length > 12) h += '<div class="vazio">+ ' + (l.length - 12) + ' alertas no Zabbix</div>';
  return h;
}
var halosRack = {}, racksQuentes = [];
function soltarHalo(c){ var h = halosRack[c]; if (!h) return; cena.remove(h.s); var i = ROTULOS_SALA.indexOf(h.s); if (i >= 0) ROTULOS_SALA.splice(i, 1); if (h.s.material.map) h.s.material.map.dispose(); h.s.material.dispose(); delete halosRack[c]; }
function pintarRacksZabbix(){
  var por = {};
  if (zbxFresco()) ZBX.problemas.forEach(function(p){ if (!p.rack) return; var r = por[p.rack] || (por[p.rack] = { sev:-1, n:0 }); r.n++; if (p.sev > r.sev) r.sev = p.sev; });
  racksQuentes = [];
  alvosRack.forEach(function(m){
    var cod = m.userData.rack, a = por[cod]; if (!m.material || !m.material.emissive) return;
    if (m.userData.emiOrig === undefined) m.userData.emiOrig = [m.material.emissive.getHex(), m.material.emissiveIntensity];
    if (a) { m.material.emissive.setHex(parseInt(COR_SEV[a.sev].slice(1), 16)); m.material.emissiveIntensity = 0.45; if (a.sev >= 4) racksQuentes.push(m); }
    else { m.material.emissive.setHex(m.userData.emiOrig[0]); m.material.emissiveIntensity = m.userData.emiOrig[1]; }
  });
  Object.keys(halosRack).forEach(function(c){ if (!por[c] || por[c].n !== halosRack[c].n || por[c].sev !== halosRack[c].sev) soltarHalo(c); });
  Object.keys(por).forEach(function(c){
    if (halosRack[c]) return;
    var corpo = alvosRack.filter(function(m){ return m.userData.rack === c; })[0]; if (!corpo) return;
    var v = new THREE.Vector3(); corpo.getWorldPosition(v);
    var sp = etiqueta('⚠ ' + c + ' · ' + por[c].n + (por[c].n === 1 ? ' alerta' : ' alertas'), COR_SEV[por[c].sev], 0.6); sp.position.set(v.x - 0.3, 3.1, v.z); cena.add(sp); ROTULOS_SALA.push(sp);
    halosRack[c] = { s:sp, n:por[c].n, sev:por[c].sev };
  });
}
function animarRacksZbx(t){ if (!racksQuentes.length) return; var k = 0.3 + 0.3 * Math.sin(t * 5); racksQuentes.forEach(function(m){ m.material.emissiveIntensity = k; }); }
function aplicarZabbix(d){
  ZBX = d.zabbix || null; if (ZBX) { ZBX.idade = d.agora - ZBX.t; ZBX.agoraSrv = d.agora; }
  var b = document.getElementById('bloco-zabbix'); if (b) b.innerHTML = blocoZabbix();
  pintarRacksZabbix();
  var chip = document.getElementById('zbx-chip'), faixa = document.getElementById('alerta-zbx');
  if (chip) {
    if (!ZBX) chip.textContent = '';
    else if (!zbxFresco()) { chip.textContent = 'Monitoramento sem dados'; chip.style.color = '#7b86a0'; }
    else if (!ZBX.problemas.length) { chip.textContent = 'CPD sem alertas'; chip.style.color = '#3ddc97'; }
    else { var mx = Math.max.apply(null, ZBX.problemas.map(function(p){ return p.sev; })); chip.textContent = 'CPD ' + ZBX.problemas.length + (ZBX.problemas.length === 1 ? ' alerta' : ' alertas'); chip.style.color = COR_SEV[mx]; }
  }
  if (faixa) {
    var graves = zbxFresco() ? ZBX.problemas.filter(function(p){ return p.sev >= 4; }).sort(function(a, b){ return b.sev - a.sev || b.desde - a.desde; }) : [];
    if (graves.length) {
      faixa.textContent = 'Alerta no CPD: ' + (graves[0].equip || graves[0].host) + ' — ' + graves[0].nome + (graves.length > 1 ? ' (+' + (graves.length - 1) + ')' : '');
      faixa.className = 'alerta-temp zbx' + (graves[0].sev >= 5 ? ' crit' : ''); faixa.hidden = false;
    } else { faixa.hidden = true; }
  }
}
function buscarZabbix(){
  if (DEMO) { if (DEMO.zabbix) aplicarZabbix({ agora: Date.now(), zabbix: DEMO.zabbix }); return; }
  fetch('/api/zabbix', { credentials:'same-origin', cache:'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if (d) aplicarZabbix(d); }).catch(function(){});
}
buscarZabbix(); setInterval(buscarZabbix, LEVE ? 20000 : 12000);

var btnLeve = document.getElementById('btn-leve');
if (btnLeve) { btnLeve.className = 'btn-leve' + (LEVE ? ' on' : ''); btnLeve.textContent = LEVE ? '⚡' + NIVEL : '⚡'; btnLeve.title = LEVE ? 'Modo leve nível ' + NIVEL + ' (clique pra mudar: completo → leve → mais leve)' : 'Modo completo (clique pra ligar o modo leve)'; btnLeve.onclick = function(){ location.href = location.pathname + '?leve=' + ((NIVEL + 1) % 3); }; }
var moBtn = document.getElementById('mostrar-btn'); if (moBtn) moBtn.onclick = painelMostrar;

function redimensionar(){ var w=window.innerWidth,h=window.innerHeight;
  if (LEVE) { renderer.setPixelRatio(Math.min(1, Math.sqrt((NIVEL >= 2 ? 1000000 : 1300000)/(w*h)))); }   // TV 4K: no máximo ~1,3 milhão de pixels
  renderer.setSize(w,h); if (css3) css3.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', redimensionar); redimensionar();

// ── Loop ──
var relogio = new THREE.Clock();
// Modo leve: o que pesa numa TV é o NÚMERO DE DESENHOS por quadro (a planta tinha ~900), não os triângulos. Junta as peças fixas
// (centenas de caixinhas) em poucas malhas por tipo de material, e esconde os rótulos pequenos quando a câmera está longe.
var rotulosPerto = [];
function juntarEstaticos(){
  if (!LEVE) return;
  // no modo leve os LEDs dos racks e os barquinhos deixam de piscar/balançar: assim entram na junção (eram ~140 desenhos)
  racksLeds.length = 0; barcos.length = 0;
  var protegidos = new Set();
  Object.keys(grupoSalas).forEach(function(id){ var gi = grupoSalas[id]; [gi.aoVivo, gi.pgm, gi.alerta].forEach(function(m){ if (m) protegidos.add(m); }); });
  racksLeds.forEach(function(l){ protegidos.add(l.m); });
  protegidos.add(discoSol); protegidos.add(lua);
  var dinamicos = new Set(MATS_NOITE.map(function(p){ return p[0]; })); dinamicos.add(matCristo);
  cena.updateMatrixWorld(true);
  var porTipo = {}, retirar = [], v = new THREE.Vector3();
  function oculto(o){ for (var p = o; p; p = p.parent) { if (!p.visible) return true; } return false; }
  function dentro(o, g){ for (var p = o; p; p = p.parent) { if (p === g) return true; } return false; }
  cena.traverse(function(o){
    if (dentro(o, grupoPasseio) || dentro(o, grupoEle) || dentro(o, aviao) || dentro(o, bondinho) || barcos.some(function(b){ return dentro(o, b); })) return;
    if (o.isSprite) { if (!dentro(o, RIO) && ROTULOS_SALA.indexOf(o) < 0 && !oculto(o)) { o.getWorldPosition(v); rotulosPerto.push({ s:o, x:v.x, y:v.y, z:v.z }); } return; }
    if (!o.isMesh || o.isInstancedMesh || protegidos.has(o)) return;
    var mt = o.material;
    if (!mt || Array.isArray(mt) || (mt.type !== 'MeshStandardMaterial' && mt.type !== 'MeshLambertMaterial' && mt.type !== 'MeshBasicMaterial') || mt.map || mt.transparent || mt.vertexColors || mt.side !== THREE.FrontSide || dinamicos.has(mt)) return;
    var basico = mt.type === 'MeshBasicMaterial';
    if (Object.keys(o.userData).length || oculto(o)) return;
    var pos = o.geometry.attributes.position; if (!pos || pos.count > 6000) return;
    var chave = basico ? 'B|' + mt.fog : [mt.roughness, mt.metalness, mt.emissive.getHex(), mt.emissiveIntensity, mt.flatShading ? 1 : 0, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0].join('|');
    var grupo = porTipo[chave] || (porTipo[chave] = { mt:mt, o:o, pos:[], nor:[], cor:[] });
    var g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(o.matrixWorld);
    var p3 = g.attributes.position.array, n3 = g.attributes.normal.array, i;
    for (i = 0; i < p3.length; i++) { grupo.pos.push(p3[i]); grupo.nor.push(n3[i]); }
    for (i = 0; i < p3.length / 3; i++) grupo.cor.push(mt.color.r, mt.color.g, mt.color.b);
    g.dispose(); retirar.push(o);
  });
  retirar.forEach(function(o){ if (o.parent) o.parent.remove(o); });
  Object.keys(porTipo).forEach(function(k){
    var t = porTipo[k], g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(t.cor, 3));
    var m = new THREE.Mesh(g, t.mt.type === 'MeshBasicMaterial' ? new THREE.MeshBasicMaterial({ vertexColors:true, fog:t.mt.fog }) : new THREE.MeshStandardMaterial({ vertexColors:true, roughness:t.mt.roughness, metalness:t.mt.metalness, emissive:t.mt.emissive.clone(), emissiveIntensity:t.mt.emissiveIntensity, flatShading:t.mt.flatShading }));
    m.castShadow = t.o.castShadow; m.receiveShadow = t.o.receiveShadow; m.frustumCulled = false; cena.add(m);
  });
}
var contQuadros = 0;
function rotulosSoDePerto(){
  if (!rotulosPerto.length || (contQuadros++ % 12)) return;
  var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  rotulosPerto.forEach(function(r){ var dx = r.x - cx, dy = r.y - cy, dz = r.z - cz; r.s.visible = (dx*dx + dy*dy + dz*dz) < (NIVEL >= 2 ? 1900 : 4900); });
}
// Medição automática: depois de uns 4 s de aquecimento, mede quanto tempo leva cada quadro. Se não chega a ~28 quadros/s,
// sobe um nível (completo → leve → mais leve) e recarrega. Só roda se a pessoa não escolheu o nível na mão.
var bench = { ativo: !MANUAL && NIVEL < 2, ini: 0, ultimo: 0, d: [] };
function medirFluidez(agora){
  if (!bench.ativo) return;
  if (document.visibilityState !== 'visible') { bench.ini = 0; bench.d = []; return; }
  var d = agora - bench.ultimo; bench.ultimo = agora;
  if (!bench.ini) { bench.ini = agora; return; }
  if (agora - bench.ini < 4000) return;
  if (d < 700) bench.d.push(d);
  if (agora - bench.ini > 14000) {
    bench.ativo = false;
    var s = bench.d.slice().sort(function(a, b){ return a - b; }), med = s[s.length >> 1] || 0;
    if (s.length >= 50 && med > (NIVEL ? 44 : 36)) { try { localStorage.setItem('mapa-leve', String(NIVEL + 1)); } catch(e){} location.reload(); }
  }
}
var ultimoQuadro = 0;
function laco(){
  if (LEVE) { var agoraMs = performance.now(); if (agoraMs - ultimoQuadro < 30) { requestAnimationFrame(laco); return; } ultimoQuadro = agoraMs; }
  medirFluidez(performance.now()); rotulosSoDePerto();
  var dt = Math.min(relogio.getDelta(), 0.1), t = relogio.elapsedTime;
  andar(dt); posCamera(); animarPessoas(dt, t); animarVisitantes(dt); animarRio(dt, t);
  Object.keys(grupoSalas).forEach(function(id){ var gi = grupoSalas[id], m = gi.aoVivo; if(m){ m.material.opacity = m.userData.ligado ? 0.32 + 0.14*Math.sin(t*3) : 0; } if(gi.pgm){ gi.pgm.material.emissiveIntensity = (m && m.userData.ligado) ? 1.5 + 0.4*Math.sin(t*3) : 0.35; } });
  Object.keys(marcadoresChamado).forEach(function(k, i){ var m=marcadoresChamado[k]; m.rotation.y = t*2; m.position.y = ALTURA_PAREDE+1.1+Math.sin(t*3+i)*0.1; });
  if (modoEle) { fluxos.forEach(function(f){ var q = posNoFluxo(f, t*0.08); f.m.position.set(ew(q[0]), 0.18, ez(q[1])); }); }
  animarRacksZbx(t);
  animarNuvem(t);
  animarPin(t);
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
juntarEstaticos();
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
<div id="topo"><h1>Mapa 3D</h1><span class="sub">central ao vivo</span><span class="sp"></span>${isGestor && !demo ? '<button class="btn btn-falar" id="falar-btn" title="Recado falado em voz alta pela Echo da central">&#128227; <span class="rot">Falar com a central</span></button>' : ''}${demo ? '' : '<button class="btn" id="avatar-btn" title="Escolher como você aparece no mapa">&#129485; Meu avatar</button>'}<button class="btn-leve" id="btn-leve" title="Modo leve: para TV e computador fraco">⚡</button><span class="clima" id="zbx-chip"></span><span class="clima" id="sensor-chip"></span><span class="clima" id="clima"></span><span class="relogio" id="relogio">--:--</span>
  <div class="menu"><button class="btn" id="menu-btn" aria-label="Menu">&#9776;</button><div class="lista">${menuItens(isGestor, { classe: '' })}</div></div></div>
<div id="cena"></div><div id="painel"></div><div id="olha" hidden></div><div id="joy" aria-label="Andar"><div id="joy-pino"></div></div><button class="btn" id="fechar-painel" aria-label="Fechar painel">&#10005;</button><div id="dica">Arraste = girar · Shift/botão direito = mover · roda = zoom · clique numa sala</div>
<div id="atalhos"><button class="btn btn-passear" id="passear-btn">&#128694; Passear</button><button class="btn btn-mostrar" id="mostrar-btn">&#128205; Mostrar para a central</button><button class="btn" data-vai="geral">Visão geral</button><button class="btn" data-vai="central">Central</button><button class="btn" data-vai="playout">Playout</button><button class="btn" data-vai="estudio1">Estúdio 1</button><button class="btn" data-vai="estudio2">Estúdio 2</button><button class="btn" data-vai="nuvem">Nuvem</button><button class="btn" data-vai="cpd">CPD</button><button class="btn" data-vai="eletrica">&#9889; Elétrica</button></div>
<div class="alerta-temp" id="alerta-temp" hidden></div>
<div class="alerta-temp zbx" id="alerta-zbx" hidden></div>
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
