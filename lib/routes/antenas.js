// lib/routes/antenas.js — Registros técnicos, fase 2: manutenção das antenas (checklists de preventiva
// Plus/Básica, corretiva e emergencial, não conformidades, assinatura do avaliador e dashboard de SLA do
// contrato). Portado do artefato "Preventiva das Antenas — Checklists"; o navegador roda antenas.js.
// Dados: aba Antenas (um checklist por linha, JSON dividido em colunas pra caber no limite de 50 mil
// caracteres por célula) e aba AntenasConfig (SLA). Colaborador e gestor registram; perfil view só lê; só
// gestor apaga e altera prazos. A assinatura do avaliador vale pra quem está logado e não muda depois.
import { sheetsRequest, garantirLinhasSheet } from '../google-auth.js';
import { ANTENAS_CSS } from '../antenas-css.js';
import { createHash, timingSafeEqual, randomBytes } from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ABA = 'Antenas';
const ABA_CFG = 'AntenasConfig';
const CAB = ['ID', 'Criado em', 'Tipo', 'Status', 'Data', 'OS', 'Atualizado em', 'Atualizado por', 'Doc 1', 'Doc 2', 'Doc 3', 'Doc 4', 'Doc 5', 'Doc 6', 'Removido'];
const CHUNK = 45000, NCHUNKS = 6;
const MAX_LISTA = 300;
const COOKIE_NAME = 'pulse_session';

const ANT_IDS = ['RX01', 'RX02', 'RX03', 'RX04', 'RX05', 'RX06'];
const TIPOS = ['plus', 'basica', 'corretiva', 'emergencial'];
const STATUS = ['rascunho', 'aguardando', 'concluido'];
const PARECERES = ['Aprovado', 'Aprovado com ressalvas', 'Aceite condicionado às pendências do relatório', 'Reprovado'];
const SLA_CHAVES = ['emergencial', 'corretiva', 'emerg_d', 'corr_d', 'preventiva', 'nc_h', 'prev_int', 'plus_int', 'reinc_d'];

class HttpErr extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- sessão ----------
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
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
    if (!assinaturaBate(h, hash(data + ts))) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    return nome ? { nome } : null;
  } catch { return null; }
}

// Equipe (13 col): 0=nome, 8=perfil, 10=status. Devolve o usuário e a lista de técnicos da contratante.
async function getContexto(nome) {
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:M200')}`);
    const linhas = (d.values || []).filter(r => r[0] && (r[10] || 'ativo').toLowerCase() === 'ativo');
    const eu = linhas.find(r => r[0] === nome);
    if (!eu) return null;
    const perfil = eu[8] || 'colaborador';
    const equipe = linhas.filter(r => (r[8] || 'colaborador') === 'colaborador').map(r => r[0]);
    return { usuario: { nome, perfil, isGestor: perfil === 'gestor', isView: perfil === 'view' }, equipe };
  } catch { return null; }
}

// ---------- planilha ----------
async function garantirAba(nome, cabecalho) {
  try {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${nome}!A1:A1`)}`);
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message)) throw e;
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: nome, gridProperties: { rowCount: 1000, columnCount: cabecalho.length } } } }],
    });
    const fim = String.fromCharCode(64 + cabecalho.length);
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${nome}!A1:${fim}1`)}?valueInputOption=RAW`, 'PUT', { values: [cabecalho] });
  }
}
async function lerValores(range) {
  const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`);
  return d.values || [];
}
function docDeLinha(r) {
  try { return JSON.parse((r || []).slice(8, 14).map(x => x || '').join('')); } catch { return null; }
}
function linhaDeDoc(id, doc, quem) {
  const json = JSON.stringify(doc);
  if (json.length > CHUNK * NCHUNKS) throw new HttpErr(413, 'Checklist grande demais para salvar.');
  const partes = [];
  for (let i = 0; i < NCHUNKS; i++) partes.push(json.slice(i * CHUNK, (i + 1) * CHUNK));
  return [id, doc.criadoEm || '', doc.tipo, doc.status, (doc.ident && doc.ident.data) || '', (doc.ident && doc.ident.os) || '', new Date().toISOString(), quem, ...partes, ''];
}
async function acharLinha(id) {
  const ids = await lerValores(`${ABA}!A2:A3000`);
  const i = ids.findIndex(r => r[0] === id);
  return i < 0 ? 0 : i + 2;
}
async function gravarLinha(n, linha) {
  await garantirLinhasSheet(SHEET_ID, ABA, n);
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!A${n}:N${n}`)}?valueInputOption=RAW`, 'PUT', { values: [linha.slice(0, 14)] });
}

// ---------- validação do documento ----------
const DT_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?)?$/;
const CHAVE_ITEM_RE = /^[A-Za-z0-9]{1,5}\|RX0[1-6]$/;
const NUM_RE = /^-?[0-9]*[.,]?[0-9]*$/;
const SIG_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const dt = v => (typeof v === 'string' && DT_RE.test(v) ? v : '');
const dtOuNulo = v => (typeof v === 'string' && DT_RE.test(v) ? v : null);
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const igual = (a, b) => canon(a) === canon(b);

function sanExecucao(e) {
  const x = isObj(e) ? e : {};
  const out = { situacao: x.situacao === 'parcial' ? 'parcial' : 'completa' };
  if (x.motivo) out.motivo = str(x.motivo, 100);
  if (x.pendente) out.pendente = str(x.pendente, 500);
  if (x.retorno) out.retorno = dt(x.retorno).slice(0, 10);
  if (x.retornoFeito) out.retornoFeito = dt(x.retornoFeito).slice(0, 10);
  if (x.retornoPor) out.retornoPor = str(x.retornoPor, 40);
  if (isObj(x.continuacao) && /^[a-f0-9]{20}$/.test(x.continuacao.id || '')) out.continuacao = { id: x.continuacao.id, os: str(x.continuacao.os, 40) };
  return out;
}
function sanAcoes(m) {
  const out = {};
  if (!isObj(m)) return out;
  for (const k of Object.keys(m).slice(0, 400)) {
    if (!CHAVE_ITEM_RE.test(k) || !isObj(m[k])) continue;
    const a = m[k], o = {};
    if (a.acao != null) o.acao = str(a.acao);
    if (a.resolvida === 'S' || a.resolvida === 'N') o.resolvida = a.resolvida;
    if (a.resolvidaEm) o.resolvidaEm = dt(a.resolvidaEm);
    if (a.tipoRec === 'Emergencial' || a.tipoRec === 'Corretiva') o.tipoRec = a.tipoRec;
    out[k] = o;
  }
  return out;
}
function sanitizarDoc(d) {
  if (!isObj(d)) throw new HttpErr(400, 'Documento inválido.');
  if (!TIPOS.includes(d.tipo)) throw new HttpErr(400, 'Tipo de checklist inválido.');
  if (!STATUS.includes(d.status)) throw new HttpErr(400, 'Situação inválida.');
  const id = isObj(d.ident) ? d.ident : {};
  const out = {
    tipo: d.tipo, status: d.status, criadoEm: dt(d.criadoEm), criadoPor: str(d.criadoPor, 120),
    antenas: ANT_IDS.filter(a => Array.isArray(d.antenas) && d.antenas.includes(a)),
    ident: {
      data: dt(id.data).slice(0, 10), os: str(id.os, 40).replace(/[^A-Za-z0-9\-]/g, ''), tecnicos: str(id.tecnicos, 400),
      executor: str(id.executor, 200), obs: str(id.obs, 500), chamado: str(id.chamado, 60), problema: str(id.problema, 300),
      abertura: dt(id.abertura), normalizacao: dt(id.normalizacao), agendamento: dt(id.agendamento),
    },
    resp: {}, obs: {}, niveis: {}, ncs: [], ncAcoes: sanAcoes(d.ncAcoes), materiais: {}, executor: null, avaliador: null,
    execucao: sanExecucao(d.execucao),
  };
  if (isObj(d.resp)) for (const k of Object.keys(d.resp).slice(0, 600)) if (CHAVE_ITEM_RE.test(k) && ['OK', 'NC', 'NA'].includes(d.resp[k])) out.resp[k] = d.resp[k];
  if (isObj(d.obs)) for (const k of Object.keys(d.obs).slice(0, 600)) if (CHAVE_ITEM_RE.test(k) && typeof d.obs[k] === 'string' && d.obs[k]) out.obs[k] = str(d.obs[k]);
  if (isObj(d.niveis)) {
    for (const k of Object.keys(d.niveis).slice(0, 40)) {
      if (!/^RX0[1-6]\|[LRVH]$/.test(k) || !isObj(d.niveis[k])) continue;
      const v = {};
      for (const f of ['antes', 'depois', 'margemAntes', 'margemDepois']) {
        const x = d.niveis[k][f];
        if (typeof x === 'string' && x.length <= 12 && NUM_RE.test(x)) v[f] = x;
      }
      out.niveis[k] = v;
    }
  }
  if (Array.isArray(d.ncs)) {
    out.ncs = d.ncs.slice(0, 200).filter(isObj).map(n => {
      const o = { antena: ANT_IDS.includes(n.antena) ? n.antena : '', item: str(n.item, 8), desc: str(n.desc), acao: str(n.acao), resolvida: n.resolvida === 'S' ? 'S' : 'N', auto: n.auto === true };
      if (n.resolvidaEm) o.resolvidaEm = dt(n.resolvidaEm);
      if (n.tipoRec === 'Emergencial' || n.tipoRec === 'Corretiva') o.tipoRec = n.tipoRec;
      return o;
    });
  }
  if (isObj(d.materiais)) for (const k of Object.keys(d.materiais).slice(0, 30)) { const v = d.materiais[k]; if (typeof v === 'string' || typeof v === 'number') out.materiais[str(k, 60)] = str(String(v), 30); }
  if (isObj(d.executor)) out.executor = { nome: str(d.executor.nome, 120), data: dt(d.executor.data).slice(0, 10) };
  if (isObj(d.avaliador)) {
    const a = d.avaliador;
    const ass = typeof a.assinatura === 'string' && a.assinatura.length <= 60000 && SIG_RE.test(a.assinatura) ? a.assinatura : '';
    out.avaliador = { nome: str(a.nome, 120), data: dt(a.data).slice(0, 10), parecer: PARECERES.includes(a.parecer) ? a.parecer : 'Aprovado', obs: str(a.obs), assinatura: ass, userId: str(a.userId, 120), em: dt(a.em) };
  }
  if (isObj(d.continuaDe) && /^[a-f0-9]{20}$/.test(d.continuaDe.id || '')) {
    const c = d.continuaDe;
    out.continuaDe = { id: c.id, os: str(c.os, 40), raizOs: str(c.raizOs, 40), raizId: /^[a-f0-9]{20}$/.test(c.raizId || '') ? c.raizId : c.id, pendente: str(c.pendente) };
  }
  if (Array.isArray(d.herdado)) out.herdado = d.herdado.slice(0, 700).filter(k => typeof k === 'string' && CHAVE_ITEM_RE.test(k));
  if (isObj(d.ajustePend)) { out.ajustePend = {}; for (const a of ANT_IDS) if (d.ajustePend[a] === true) out.ajustePend[a] = true; }
  return out;
}

// Regras que o navegador não pode burlar: a assinatura é de quem está logado e fica fixa, checklist concluído
// não volta atrás e os itens dele ficam travados (só acompanhamento de NC e continuação seguem editáveis).
function conferirIntegridade(velho, novo, usuario) {
  novo.tipo = velho.tipo; novo.criadoEm = velho.criadoEm; novo.criadoPor = velho.criadoPor;
  if (velho.avaliador) {
    if (!igual(velho.avaliador, novo.avaliador)) throw new HttpErr(409, 'A assinatura do avaliador não pode ser alterada.');
  } else if (novo.avaliador) {
    if (novo.avaliador.nome.trim().toLowerCase() !== usuario.nome.trim().toLowerCase()) throw new HttpErr(403, 'O avaliador precisa ser a pessoa logada.');
    if (!novo.avaliador.assinatura) throw new HttpErr(400, 'Assinatura ausente ou inválida.');
  }
  if (novo.status === 'concluido' && !novo.avaliador) throw new HttpErr(400, 'Só é possível concluir com a assinatura do avaliador.');
  if (velho.status === 'concluido') {
    if (novo.status !== 'concluido') throw new HttpErr(409, 'Checklist concluído não volta para preenchimento.');
    if (!usuario.isGestor) {
      for (const k of ['antenas', 'ident', 'resp', 'obs', 'niveis', 'materiais', 'ajustePend', 'execucao', 'continuaDe', 'herdado']) {
        if (!igual(velho[k], novo[k])) throw new HttpErr(409, 'Checklist concluído: os itens estão travados.');
      }
    }
  }
}

function exigirEscrita(usuario) { if (usuario.isView) throw new HttpErr(403, 'Essa conta é somente leitura.'); }
function semAssinatura(doc) {
  if (doc && doc.avaliador && doc.avaliador.assinatura) return { ...doc, avaliador: { ...doc.avaliador, assinatura: '' } };
  return doc;
}

async function lerSla() {
  try {
    const rows = await lerValores(`${ABA_CFG}!A2:B20`);
    const r = rows.find(x => x[0] === 'sla');
    return r && r[1] ? JSON.parse(r[1]) : null;
  } catch { return null; }
}
function sanitizarSla(v) {
  if (!isObj(v)) throw new HttpErr(400, 'Prazos inválidos.');
  const out = {};
  for (const k of SLA_CHAVES) {
    const n = Number(v[k]);
    if (!(n > 0) || n > 100000) throw new HttpErr(400, 'Informe prazos maiores que zero.');
    out[k] = n;
  }
  out.inicio = typeof v.inicio === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.inicio) ? v.inicio : '';
  return out;
}

// ---------- página ----------
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function jsonSeguro(o) { return JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }

const PULSE_CSS = `
.phd{background:#161920;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.phd .logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.phd .ht{font-size:14px;font-weight:700;color:#fff;line-height:1.2}.phd .hs{font-size:11px;color:#999}
.phd .hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.phd .btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer}
.phd .menu{display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200}
.phd .menu a{display:block;padding:9px 14px;font-size:12px;color:var(--ink);white-space:nowrap;text-decoration:none}
.phd .menu a:hover{background:var(--soft)}
.rt-tabs{max-width:980px;margin:14px auto 0;padding:0 16px;display:flex;gap:6px;border-bottom:1px solid var(--line)}
.rt-tab{padding:9px 16px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.rt-tab.on{color:var(--ink);border-bottom-color:#e53e3e}
`;

function paginaHtml(ctx) {
  const { usuario, equipe } = ctx;
  const menuGestor = usuario.isGestor ? '<a href="/api/equipe-view">&#128101; Equipe</a><a href="/api/ausencias">&#128198; Ausências</a>' : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Antenas</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#e53e3e">
<style>${ANTENAS_CSS}${PULSE_CSS}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
</head>
<body>
<div class="phd">
  <div class="logo">P</div>
  <div><div class="ht">Pulse</div><div class="hs">Registros técnicos</div></div>
  <div class="hr">
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'☀️':'🌙';})()" style="font-size:14px;padding:3px 8px">🌙</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" class="menu">
        <a href="/api/app">&#127968; Início</a>
        <a href="/api/escalas?v=semana">&#128197; Escala</a>
        ${menuGestor}
        <a href="/api/repositorio">&#128193; Central de Conhecimento</a>
        <a href="/api/registros-tecnicos">&#128225; Registros técnicos</a>
      </div>
    </div>
  </div>
</div>
<div class="rt-tabs"><a class="rt-tab" href="/api/registros-tecnicos">Patch de RF</a><a class="rt-tab on" href="/api/antenas">Antenas</a></div>
<header class="top"><div class="wrap"><h1>Manutenção das antenas</h1><nav class="topnav" aria-label="Seções"><button data-view="lista" aria-current="page">Checklists</button><button data-view="dash">Dashboard</button></nav><span class="who brand" id="who"><img id="logoImg" src="/antenas-logo.png" alt="CazéTV"></span></div></header>
<main class="wrap" id="app"><p style="margin-top:24px;color:var(--muted)">Carregando…</p></main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
window.__AT=${jsonSeguro({ usuario, equipe })};
</script>
<script src="/antenas.js?v=1"></script>
</body>
</html>`;
}

// ---------- handler ----------
export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return req.method === 'POST' ? res.status(401).json({ error: 'Faça login novamente.' }) : res.redirect(302, '/api/app');
  const ctx = await getContexto(session.nome);
  if (!ctx) return req.method === 'POST' ? res.status(401).json({ error: 'Usuário não encontrado.' }) : res.redirect(302, '/api/app');
  const { usuario } = ctx;
  const action = req.query.action || '';

  try {
    if (req.method === 'GET' && !action) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(paginaHtml(ctx));
    }

    if (req.method === 'GET' && action === 'listar') {
      await garantirAba(ABA, CAB); await garantirAba(ABA_CFG, ['Chave', 'Valor']);
      const rows = await lerValores(`${ABA}!A2:O3000`);
      const docs = [];
      rows.forEach(r => {
        if (!r[0] || r[14]) return;
        const d = docDeLinha(r);
        if (d) docs.push({ id: r[0], ...semAssinatura(d) });
      });
      docs.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
      return res.status(200).json({ checklists: docs.slice(0, MAX_LISTA), sla: await lerSla() });
    }

    if (req.method === 'GET' && action === 'doc') {
      const id = String(req.query.id || '');
      if (!/^[a-f0-9]{20}$/.test(id)) throw new HttpErr(400, 'ID inválido.');
      const n = await acharLinha(id);
      if (!n) throw new HttpErr(404, 'Checklist não encontrado.');
      const [r] = await lerValores(`${ABA}!A${n}:O${n}`);
      const d = r && !r[14] ? docDeLinha(r) : null;
      if (!d) throw new HttpErr(404, 'Checklist não encontrado.');
      return res.status(200).json({ doc: { id, ...d } });
    }

    if (req.method !== 'POST') throw new HttpErr(405, 'Método não permitido.');
    const body = req.body || {};
    exigirEscrita(usuario);

    if (action === 'criar') {
      const doc = sanitizarDoc(body.doc);
      if (doc.status !== 'rascunho' || doc.avaliador) throw new HttpErr(400, 'Um checklist novo começa em preenchimento, sem assinatura.');
      doc.criadoEm = new Date().toISOString();
      doc.criadoPor = usuario.nome;
      await garantirAba(ABA, CAB);
      const ids = await lerValores(`${ABA}!A2:A3000`);
      const id = randomBytes(10).toString('hex');
      await gravarLinha(2 + ids.length, linhaDeDoc(id, doc, usuario.nome));
      return res.status(200).json({ ok: true, id });
    }

    if (action === 'salvar' || action === 'atualizar') {
      const id = String(body.id || '');
      if (!/^[a-f0-9]{20}$/.test(id)) throw new HttpErr(400, 'ID inválido.');
      const n = await acharLinha(id);
      if (!n) throw new HttpErr(404, 'Checklist não encontrado.');
      const [r] = await lerValores(`${ABA}!A${n}:O${n}`);
      const velho = r && !r[14] ? docDeLinha(r) : null;
      if (!velho) throw new HttpErr(404, 'Checklist não encontrado.');
      let novo;
      if (action === 'atualizar') {
        // só a execução (retorno/continuação de atividade parcial) pode ser atualizada por parcial
        if (!isObj(body.patch) || Object.keys(body.patch).some(k => k !== 'execucao')) throw new HttpErr(400, 'Atualização não permitida.');
        novo = { ...velho, execucao: sanExecucao(body.patch.execucao) };
      } else {
        novo = sanitizarDoc(body.doc);
        conferirIntegridade(velho, novo, usuario);
      }
      await gravarLinha(n, linhaDeDoc(id, novo, usuario.nome));
      return res.status(200).json({ ok: true });
    }

    if (action === 'apagar') {
      if (!usuario.isGestor) throw new HttpErr(403, 'Só o gestor pode apagar checklists.');
      const id = String(body.id || '');
      if (!/^[a-f0-9]{20}$/.test(id)) throw new HttpErr(400, 'ID inválido.');
      const n = await acharLinha(id);
      if (!n) throw new HttpErr(404, 'Checklist não encontrado.');
      await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!O${n}`)}?valueInputOption=RAW`, 'PUT', { values: [[`${usuario.nome} em ${new Date().toISOString()}`]] });
      return res.status(200).json({ ok: true });
    }

    if (action === 'sla') {
      if (!usuario.isGestor) throw new HttpErr(403, 'Só o gestor altera os prazos.');
      const sla = sanitizarSla(body.sla);
      await garantirAba(ABA_CFG, ['Chave', 'Valor']);
      const rows = await lerValores(`${ABA_CFG}!A2:B20`);
      const i = rows.findIndex(x => x[0] === 'sla');
      const n = 2 + (i < 0 ? rows.length : i);
      await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA_CFG}!A${n}:B${n}`)}?valueInputOption=RAW`, 'PUT', { values: [['sla', JSON.stringify(sla)]] });
      return res.status(200).json({ ok: true });
    }

    throw new HttpErr(400, 'Ação desconhecida.');
  } catch (e) {
    const status = e instanceof HttpErr ? e.status : 500;
    return res.status(status).json({ error: e instanceof HttpErr ? e.message : String(e.message || e) });
  }
}
