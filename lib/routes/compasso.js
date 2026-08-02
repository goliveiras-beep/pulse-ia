// lib/routes/compasso.js — Compasso: board de tarefas (Kanban) em metodologia ágil.
// Qualquer colaborador ativo pode criar, mover e editar qualquer tarefa; excluir é
// restrito a quem criou a tarefa ou ao gestor.
import { sheetsRequest } from '../google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX  = 60 * 60 * 24 * 7;
const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const RANGE        = 'Compasso!A2:I500';
const STATUS_COLS  = ['A Fazer', 'Em Andamento', 'Concluído'];
const PRIORIDADES  = ['Baixa', 'Média', 'Alta'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function gerarId() { return 'CMP-' + Math.random().toString(36).slice(2, 8).toUpperCase(); }
function agoraBRT() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
}
function iniciais(n) { return (n || '?').split(' ').slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?'; }

// Prazo (SLA) — "atrasada" (passou a data), "atencao" (vence em até 3 dias), "ok" (no prazo).
function hojeISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
function diasPara(prazo) {
  if (!prazo) return null;
  const hoje = new Date(hojeISO() + 'T00:00:00');
  const alvo = new Date(prazo + 'T00:00:00');
  return Math.round((alvo - hoje) / 86400000);
}
function slaInfo(prazo) {
  const d = diasPara(prazo);
  if (d === null) return null;
  if (d < 0) return { label: 'Atrasada', codigo: 'atrasada' };
  if (d <= 3) return { label: d === 0 ? 'Vence hoje' : `Vence em ${d}${d === 1 ? ' dia' : ' dias'}`, codigo: 'atencao' };
  return { label: 'No prazo', codigo: 'ok' };
}

function parseCookies(h) { const c = {}; (h || '').split(';').forEach(x => { const p = x.trim().split('='); c[p.shift()] = p.join('='); }); return c; }
function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const last = d.lastIndexOf('|'), sec = d.lastIndexOf('|', last - 1);
    const data = d.slice(0, sec), h = d.slice(sec + 1, last), ts = d.slice(last + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(data + ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}

// Cria a aba Compasso (com headers) se ainda não existir — sem isso, a primeira gravação
// derrubaria a function inteira (mesma classe de bug já corrigida no RepositorioConfig).
async function garantirAba() {
  try {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(RANGE)}`);
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message)) throw e;
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: 'Compasso' } } }]
    });
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('Compasso!A1:I1')}?valueInputOption=USER_ENTERED`, 'PUT', {
      values: [['ID', 'Titulo', 'Descricao', 'Responsavel', 'Status', 'Prioridade', 'CriadoPor', 'CriadoEm', 'Prazo']]
    });
  }
}

// ── HTML ─────────────────────────────────────────────────────────────────────
function renderPage({ nome, isGestor, tarefas, equipeAtivos }) {
  const corPrioridade = p => p === 'Alta' ? '#dc2626' : p === 'Média' ? '#d97706' : '#16a34a';

  const colunasHtml = STATUS_COLS.map(status => {
    const itens = tarefas.filter(t => t.status === status || (!STATUS_COLS.includes(t.status) && status === 'A Fazer'));
    const cardsHtml = itens.length ? itens.map(t => {
      const resps = (t.responsavel || '').split(',').map(s => s.trim()).filter(Boolean);
      const respsHtml = resps.length
        ? resps.map(n => `<span class="card-resp"><span class="avatar-mini">${esc(iniciais(n))}</span>${esc(n.split(' ')[0])}</span>`).join('')
        : '<span class="card-resp" style="color:var(--muted)">Sem responsável</span>';
      const sla = slaInfo(t.prazo);
      const slaHtml = sla ? `<span class="sla-badge sla-${sla.codigo}">${esc(sla.label)}</span>` : '';
      return `
      <div class="card-tarefa" onclick="abrirTarefa('${esc(t.id)}')">
        <div class="card-prior" style="background:${corPrioridade(t.prioridade)}"></div>
        <div class="card-titulo">${esc(t.titulo)}</div>
        ${t.descricao ? `<div class="card-desc">${esc(t.descricao)}</div>` : ''}
        <div class="card-footer">
          <span class="card-resps">${respsHtml}</span>
          <span style="display:flex;align-items:center;gap:2px">${t.prazo ? `<span class="card-prazo">📅 ${esc(t.prazo)}</span>` : ''}${slaHtml}</span>
        </div>
      </div>`;
    }).join('') : `<div class="col-empty">Nenhuma tarefa aqui</div>`;
    return `
      <div class="coluna">
        <div class="coluna-header">
          <span class="coluna-titulo">${esc(status)}</span>
          <span class="coluna-count">${itens.length}</span>
        </div>
        <div class="coluna-cards">${cardsHtml}</div>
        <button class="btn-add-coluna" onclick="novaTarefa('${esc(status)}')">+ Nova tarefa</button>
      </div>`;
  }).join('');

  const checkboxesResp = equipeAtivos.map(n => `<label style="display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:13px;font-weight:400;margin:0;cursor:pointer"><input type="checkbox" value="${esc(n)}" class="resp-checkbox" style="width:auto;margin:0"> ${esc(n)}</label>`).join('');
  const optsStatus = STATUS_COLS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  const optsPrior = PRIORIDADES.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const optsPessoaFiltro = equipeAtivos.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Compasso — Pulse</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#e53e3e">
<style>
:root{--bg:#f5f5f5;--bg2:#fff;--card:#fff;--text:#1a1a1a;--muted:#777;--border:#e5e5e5;--header:#161920;--blue:#1d4ed8;--input-bg:#fff;--input-border:#e0e0e0;--text2:#555}
html.dark{--bg:#1c1f26;--bg2:#242836;--card:#242836;--text:#e2e8f0;--muted:#718096;--border:#2d3748;--header:#0f1117;--blue:#63b3ed;--input-bg:#2d3140;--input-border:#3d4660;--text2:#a0aec0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,.06)}
.logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:10px;color:#778}
.hr{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:6px;padding:5px 10px;font-size:12px;color:#cbd5e1;background:none;cursor:pointer}
.wrap{max-width:1200px;margin:0 auto;padding:20px}
.top-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.top-info .title{font-size:22px;font-weight:800;color:var(--text)}
.top-info .sub{font-size:12px;color:var(--muted);margin-top:4px}
.btn-nova{border:none;border-radius:8px;background:#1d4ed8;color:#fff;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer}
.filtros-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
.view-toggle{display:flex;gap:4px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:3px}
.view-btn{border:none;background:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;font-family:inherit}
.view-btn.active{background:var(--bg);color:var(--text)}
.filtros-bar select{border:1px solid var(--input-border);border-radius:8px;padding:7px 10px;font-size:12px;background:var(--input-bg);color:var(--text);font-family:inherit;outline:none}
.metric-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
@media (max-width:700px){.metric-cards{grid-template-columns:1fr}}
.metric-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.metric-label{font-size:12px;color:var(--muted);margin-bottom:6px}
.metric-value{font-size:26px;font-weight:800}
.chart-box{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px}
.chart-label{font-size:12px;color:var(--muted);margin-bottom:10px;font-weight:600}
.sla-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap}
.sla-atrasada{background:rgba(220,38,38,.15);color:#dc2626}
.sla-atencao{background:rgba(217,119,6,.15);color:#d97706}
.sla-ok{background:rgba(22,163,74,.15);color:#16a34a}
.board{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
@media (max-width:820px){.board{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;padding-bottom:6px}.coluna{min-width:85vw;scroll-snap-align:start}}
.coluna{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;display:flex;flex-direction:column;min-height:120px}
.coluna-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:0 2px}
.coluna-titulo{font-size:13px;font-weight:700}
.coluna-count{background:var(--bg);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--muted);margin-left:auto}
.coluna-cards{display:flex;flex-direction:column;gap:8px;flex:1}
.col-empty{font-size:12px;color:var(--muted);text-align:center;padding:16px 0}
.card-tarefa{background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:10px 12px;cursor:pointer;position:relative;padding-left:16px;transition:transform .1s}
.card-tarefa:hover{transform:translateY(-1px);border-color:var(--blue)}
.card-prior{position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:9px 0 0 9px}
.card-titulo{font-size:13px;font-weight:600;margin-bottom:4px}
.card-desc{font-size:11px;color:var(--muted);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.card-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--text2)}
.card-resps{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.card-resp{display:flex;align-items:center;gap:5px}
.avatar-mini{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.card-prazo{white-space:nowrap}
.btn-add-coluna{margin-top:8px;background:none;border:1px dashed var(--border);border-radius:8px;padding:8px;font-size:12px;color:var(--muted);cursor:pointer}
.btn-add-coluna:hover{border-color:var(--blue);color:var(--blue)}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 24px;width:420px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow-y:auto}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px}
.modal label{display:block;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;margin-top:10px}
.modal input,.modal textarea,.modal select{width:100%;border:1px solid var(--input-border);border-radius:8px;padding:9px 12px;font-size:13px;background:var(--input-bg);color:var(--text);outline:none;font-family:inherit}
.modal textarea{resize:vertical;min-height:60px}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
.btn-cancel-m{background:none;border:1px solid var(--border);border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;color:var(--text)}
.btn-ok{background:#1d4ed8;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer}
.btn-danger{background:#dc2626;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer}
#toast{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:300;color:#fff}
.m-keep{display:flex}
.menu-item{display:block;padding:9px 14px;font-size:13px;color:var(--text);text-decoration:none}
.menu-item:hover{background:var(--bg)}
.alerta-banner{display:none;align-items:center;gap:10px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;margin-bottom:14px;flex-wrap:wrap}
.alerta-atrasada{background:rgba(220,38,38,.12);color:#dc2626;border:1px solid rgba(220,38,38,.3)}
.alerta-atencao{background:rgba(217,119,6,.12);color:#d97706;border:1px solid rgba(217,119,6,.3)}
.alerta-btn{margin-left:auto;border:none;color:#fff;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.alerta-atrasada .alerta-btn{background:#dc2626}
.alerta-atencao .alerta-btn{background:#d97706}
.chip-minhas{display:flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--card);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit}
.chip-badge{background:#1d4ed8;color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;font-weight:700;min-width:18px;text-align:center}
</style>
</head>
<body>
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Compasso</div><div class="hs">Tarefas · Metodologia ágil</div></div>
  <div class="hr">
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'☀️':'🌙';})()">🌙</button>
    <div class="m-keep" style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">☰</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">🏠 Início</a>
        <a href="/api/escalas?v=semana" class="menu-item">📅 Escala</a>
        <a href="/api/compasso" class="menu-item">🧭 Compasso</a>
        ${isGestor ? `
        <a href="/api/equipe-view" class="menu-item">👥 Equipe</a>
        <a href="/api/ausencias" class="menu-item">📆 Ausências</a>
        <a href="/api/banco-horas" class="menu-item">📊 Banco de horas</a>
        ` : ''}
        <a href="/api/repositorio" class="menu-item">📁 Central de Conhecimento</a>
        <a href="/api/equipamentos" class="menu-item">📦 Equipamentos</a>
        <a href="/api/chamados" class="menu-item">🎫 Chamados</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">🚪 Sair</button>
        </form>
      </div>
    </div>
  </div>
</div>
<div class="wrap">
  <div id="alerta-pessoal" class="alerta-banner"></div>
  <div class="top-bar">
    <div class="top-info">
      <div class="title">🧭 Compasso</div>
      <div class="sub">Board de tarefas — crie, mova e acompanhe o que a equipe está fazendo.</div>
    </div>
    <button class="btn-nova" onclick="novaTarefa('A Fazer')">+ Nova tarefa</button>
  </div>

  <div class="filtros-bar">
    <div class="view-toggle">
      <button id="vb-quadro" class="view-btn active" onclick="mudarView('quadro')">📋 Quadro</button>
      <button id="vb-grafico" class="view-btn" onclick="mudarView('grafico')">📊 Gráficos</button>
    </div>
    <button class="chip-minhas" onclick="focarMinhasTarefas()">🔔 Minhas tarefas <span id="chip-minhas-badge" class="chip-badge">0</span></button>
    <select id="f-pessoa" onchange="aplicarFiltros()">
      <option value="">Todas as pessoas</option>
      ${optsPessoaFiltro}
    </select>
    <select id="f-status" onchange="aplicarFiltros()">
      <option value="">Todo status</option>
      ${optsStatus}
    </select>
    <select id="f-prioridade" onchange="aplicarFiltros()">
      <option value="">Toda prioridade</option>
      ${optsPrior}
    </select>
  </div>

  <div id="quadro-view">
    <div class="board" id="board-view">${colunasHtml}</div>
  </div>

  <div id="grafico-view" style="display:none">
    <div class="metric-cards">
      <div class="metric-card"><div class="metric-label">🔴 Atrasadas</div><div class="metric-value" id="mv-atrasadas" style="color:#dc2626">0</div></div>
      <div class="metric-card"><div class="metric-label">🟡 Vencem em até 3 dias</div><div class="metric-value" id="mv-atencao" style="color:#d97706">0</div></div>
      <div class="metric-card"><div class="metric-label">🟢 No prazo</div><div class="metric-value" id="mv-ok" style="color:#16a34a">0</div></div>
    </div>
    <div class="chart-box">
      <div class="chart-label">Tarefas por pessoa</div>
      <div style="position:relative;height:280px"><canvas id="chart-pessoa"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-label">Tarefas por status</div>
      <div style="position:relative;height:220px"><canvas id="chart-status"></canvas></div>
    </div>
  </div>
</div>

<!-- Modal nova/editar tarefa -->
<div class="modal-bg" id="modal-tarefa">
  <div class="modal">
    <h3 id="modal-titulo-h">📌 Nova tarefa</h3>
    <input type="hidden" id="t-id">
    <label>Título</label>
    <input id="t-titulo" maxlength="150" placeholder="O que precisa ser feito?">
    <label>Descrição</label>
    <textarea id="t-descricao" maxlength="1000" placeholder="Detalhes (opcional)"></textarea>
    <label>Responsáveis (pode marcar mais de um)</label>
    <div id="t-responsaveis-lista" style="max-height:150px;overflow-y:auto;border:1px solid var(--input-border);border-radius:8px;padding:6px 8px">${checkboxesResp}</div>
    <label>Status</label>
    <select id="t-status">${optsStatus}</select>
    <label>Prioridade</label>
    <select id="t-prioridade">${optsPrior}</select>
    <label>Prazo (opcional)</label>
    <input type="date" id="t-prazo">
    <div class="modal-btns">
      <button class="btn-danger" id="t-btn-excluir" style="display:none;margin-right:auto" onclick="excluirTarefa()">Excluir</button>
      <button class="btn-cancel-m" onclick="closeModal('modal-tarefa')">Cancelar</button>
      <button class="btn-ok" onclick="salvarTarefa()">Salvar</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
var NOME_ATUAL = ${JSON.stringify(nome)};
var IS_GESTOR = ${JSON.stringify(!!isGestor)};
var TAREFAS = ${JSON.stringify(tarefas)};
var STATUS_COLS = ${JSON.stringify(STATUS_COLS)};

function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});

function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-bg').forEach(function(m){m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('open');});});

function showToast(msg,ok){var t=document.getElementById('toast');t.textContent=msg;t.style.background=ok?'#166534':'#dc2626';t.style.display='block';setTimeout(function(){t.style.display='none';},2600);}

// ── Filtros + view Quadro/Gráficos ─────────────────────────────────────────
var viewAtual='quadro';
var chartPessoa=null, chartStatus=null;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function iniciais(n){return (n||'?').split(' ').slice(0,2).map(function(p){return p[0]||'';}).join('').toUpperCase()||'?';}
function corPrioridade(p){return p==='Alta'?'#dc2626':p==='Média'?'#d97706':'#16a34a';}
function hojeISOClient(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function diasParaClient(prazo){if(!prazo)return null;var hoje=new Date(hojeISOClient()+'T00:00:00');var alvo=new Date(prazo+'T00:00:00');return Math.round((alvo-hoje)/86400000);}
function slaInfo(prazo){
  var d=diasParaClient(prazo);
  if(d===null)return null;
  if(d<0)return{label:'Atrasada',codigo:'atrasada'};
  if(d<=3)return{label:(d===0?'Vence hoje':'Vence em '+d+(d===1?' dia':' dias')),codigo:'atencao'};
  return{label:'No prazo',codigo:'ok'};
}

function tarefaPassaFiltro(t,fp,fs,fpr){
  if(fp){var resps=(t.responsavel||'').split(',').map(function(s){return s.trim();});if(resps.indexOf(fp)===-1)return false;}
  if(fs && t.status!==fs)return false;
  if(fpr && t.prioridade!==fpr)return false;
  return true;
}
function listaFiltrada(){
  var fp=document.getElementById('f-pessoa').value;
  var fs=document.getElementById('f-status').value;
  var fpr=document.getElementById('f-prioridade').value;
  return TAREFAS.filter(function(t){return tarefaPassaFiltro(t,fp,fs,fpr);});
}

function montarCard(t){
  var resps=(t.responsavel||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
  var respsHtml=resps.length?resps.map(function(n){return '<span class="card-resp"><span class="avatar-mini">'+esc(iniciais(n))+'</span>'+esc(n.split(' ')[0])+'</span>';}).join(''):'<span class="card-resp" style="color:var(--muted)">Sem responsável</span>';
  var sla=slaInfo(t.prazo);
  var slaHtml=sla?'<span class="sla-badge sla-'+sla.codigo+'">'+esc(sla.label)+'</span>':'';
  return '<div class="card-tarefa" onclick="abrirTarefa(\\''+t.id+'\\')">'
    +'<div class="card-prior" style="background:'+corPrioridade(t.prioridade)+'"></div>'
    +'<div class="card-titulo">'+esc(t.titulo)+'</div>'
    +(t.descricao?'<div class="card-desc">'+esc(t.descricao)+'</div>':'')
    +'<div class="card-footer">'
    +'<span class="card-resps">'+respsHtml+'</span>'
    +'<span style="display:flex;align-items:center;gap:2px">'+(t.prazo?'<span class="card-prazo">📅 '+esc(t.prazo)+'</span>':'')+slaHtml+'</span>'
    +'</div></div>';
}
function montarColunas(lista){
  return STATUS_COLS.map(function(status){
    var itens=lista.filter(function(t){return t.status===status || (STATUS_COLS.indexOf(t.status)===-1 && status==='A Fazer');});
    var cardsHtml=itens.length?itens.map(montarCard).join(''):'<div class="col-empty">Nenhuma tarefa aqui</div>';
    return '<div class="coluna"><div class="coluna-header"><span class="coluna-titulo">'+esc(status)+'</span><span class="coluna-count">'+itens.length+'</span></div>'
      +'<div class="coluna-cards">'+cardsHtml+'</div>'
      +'<button class="btn-add-coluna" onclick="novaTarefa(\\''+status+'\\')">+ Nova tarefa</button></div>';
  }).join('');
}

function renderGraficos(lista){
  var atrasadas=0, atencao=0, ok=0;
  var porPessoa={}, porStatus={};
  STATUS_COLS.forEach(function(s){porStatus[s]=0;});
  lista.forEach(function(t){
    var s=slaInfo(t.prazo);
    if(s){if(s.codigo==='atrasada')atrasadas++;else if(s.codigo==='atencao')atencao++;else ok++;}
    var resps=(t.responsavel||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
    if(!resps.length)resps=['Sem responsável'];
    resps.forEach(function(p){porPessoa[p]=(porPessoa[p]||0)+1;});
    porStatus[t.status]=(porStatus[t.status]||0)+1;
  });
  document.getElementById('mv-atrasadas').textContent=atrasadas;
  document.getElementById('mv-atencao').textContent=atencao;
  document.getElementById('mv-ok').textContent=ok;

  var pessoasOrd=Object.keys(porPessoa).sort(function(a,b){return porPessoa[b]-porPessoa[a];}).slice(0,10);
  if(chartPessoa)chartPessoa.destroy();
  chartPessoa=new Chart(document.getElementById('chart-pessoa'),{
    type:'bar',
    data:{labels:pessoasOrd,datasets:[{data:pessoasOrd.map(function(p){return porPessoa[p];}),backgroundColor:'#1d4ed8',borderRadius:4,maxBarThickness:22}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{stepSize:1,color:'#8892a0'},grid:{color:'rgba(128,128,128,.15)'}},y:{ticks:{color:'#8892a0'},grid:{display:false}}}}
  });

  if(chartStatus)chartStatus.destroy();
  chartStatus=new Chart(document.getElementById('chart-status'),{
    type:'bar',
    data:{labels:STATUS_COLS,datasets:[{data:STATUS_COLS.map(function(s){return porStatus[s]||0;}),backgroundColor:['#94a3b8','#1d4ed8','#16a34a'],borderRadius:4,maxBarThickness:50}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:'#8892a0'},grid:{display:false}},y:{ticks:{stepSize:1,color:'#8892a0'},grid:{color:'rgba(128,128,128,.15)'}}}}
  });
}

function aplicarFiltros(){
  var lista=listaFiltrada();
  document.getElementById('board-view').innerHTML=montarColunas(lista);
  if(viewAtual==='grafico')renderGraficos(lista);
}

// ── Sinalização pessoal: tarefas atribuídas a mim, prazo vencendo/atrasado ──
function minhasTarefasAbertas(){
  return TAREFAS.filter(function(t){
    var resps=(t.responsavel||'').split(',').map(function(s){return s.trim();});
    return resps.indexOf(NOME_ATUAL)!==-1 && t.status!=='Concluído';
  });
}
function renderAlertaPessoal(){
  var minhas=minhasTarefasAbertas();
  var badge=document.getElementById('chip-minhas-badge');
  if(badge)badge.textContent=minhas.length;

  var atrasadas=[], atencao=[];
  minhas.forEach(function(t){
    var s=slaInfo(t.prazo);
    if(s && s.codigo==='atrasada')atrasadas.push(t);
    else if(s && s.codigo==='atencao')atencao.push(t);
  });
  var el=document.getElementById('alerta-pessoal');
  if(!el)return;
  if(!atrasadas.length && !atencao.length){el.style.display='none';el.innerHTML='';return;}
  var partes=[];
  if(atrasadas.length)partes.push('<b>'+atrasadas.length+'</b> atrasada'+(atrasadas.length>1?'s':''));
  if(atencao.length)partes.push('<b>'+atencao.length+'</b> vencendo em breve');
  el.className='alerta-banner '+(atrasadas.length?'alerta-atrasada':'alerta-atencao');
  el.innerHTML='⚠️ Você tem '+partes.join(' e ')+' entre suas tarefas no Compasso. <button class="alerta-btn" onclick="focarMinhasTarefas()">Ver tarefas</button>';
  el.style.display='flex';
}
function focarMinhasTarefas(){
  document.getElementById('f-pessoa').value=NOME_ATUAL;
  aplicarFiltros();
  mudarView('quadro');
  document.getElementById('board-view').scrollIntoView({behavior:'smooth'});
}

function mudarView(v){
  viewAtual=v;
  document.getElementById('vb-quadro').classList.toggle('active',v==='quadro');
  document.getElementById('vb-grafico').classList.toggle('active',v==='grafico');
  document.getElementById('quadro-view').style.display=v==='quadro'?'':'none';
  document.getElementById('grafico-view').style.display=v==='grafico'?'':'none';
  if(v==='grafico')renderGraficos(listaFiltrada());
}

function novaTarefa(status){
  document.getElementById('modal-titulo-h').textContent='📌 Nova tarefa';
  document.getElementById('t-id').value='';
  document.getElementById('t-titulo').value='';
  document.getElementById('t-descricao').value='';
  document.querySelectorAll('.resp-checkbox').forEach(function(c){c.checked=false;});
  document.getElementById('t-status').value=status;
  document.getElementById('t-prioridade').value='Baixa';
  document.getElementById('t-prazo').value='';
  document.getElementById('t-btn-excluir').style.display='none';
  openModal('modal-tarefa');
  setTimeout(function(){document.getElementById('t-titulo').focus();},80);
}

function abrirTarefa(id){
  var t=TAREFAS.find(function(x){return x.id===id;});
  if(!t)return;
  document.getElementById('modal-titulo-h').textContent='📌 Editar tarefa';
  document.getElementById('t-id').value=t.id;
  document.getElementById('t-titulo').value=t.titulo||'';
  document.getElementById('t-descricao').value=t.descricao||'';
  var respsAtuais=(t.responsavel||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
  document.querySelectorAll('.resp-checkbox').forEach(function(c){c.checked=respsAtuais.indexOf(c.value)!==-1;});
  document.getElementById('t-status').value=t.status||'A Fazer';
  document.getElementById('t-prioridade').value=t.prioridade||'Baixa';
  document.getElementById('t-prazo').value=t.prazo||'';
  var podeExcluir = IS_GESTOR || t.criadoPor===NOME_ATUAL;
  document.getElementById('t-btn-excluir').style.display=podeExcluir?'inline-block':'none';
  openModal('modal-tarefa');
}

async function salvarTarefa(){
  var id=document.getElementById('t-id').value;
  var titulo=document.getElementById('t-titulo').value.trim();
  if(!titulo){showToast('Título é obrigatório',false);return;}
  var body={
    id: id||undefined,
    titulo: titulo,
    descricao: document.getElementById('t-descricao').value.trim(),
    responsavel: Array.prototype.map.call(document.querySelectorAll('.resp-checkbox:checked'),function(c){return c.value;}).join(', '),
    status: document.getElementById('t-status').value,
    prioridade: document.getElementById('t-prioridade').value,
    prazo: document.getElementById('t-prazo').value,
  };
  var action = id ? 'editar' : 'criar';
  closeModal('modal-tarefa');
  try{
    var r=await fetch('/api/compasso?action='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(d.ok){showToast(id?'✅ Tarefa atualizada!':'✅ Tarefa criada!',true);setTimeout(function(){location.reload();},700);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

async function excluirTarefa(){
  var id=document.getElementById('t-id').value;
  if(!id)return;
  if(!confirm('Excluir essa tarefa?'))return;
  closeModal('modal-tarefa');
  try{
    var r=await fetch('/api/compasso?action=excluir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})});
    var d=await r.json();
    if(d.ok){showToast('🗑️ Excluída.',true);setTimeout(function(){location.reload();},700);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

(function(){var dk=document.documentElement.classList.contains('dark');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'☀️':'🌙';})();
renderAlertaPessoal();
</script>
</body></html>`;
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  let isGestor = false;
  let equipeAtivos = [];
  try {
    const eq = await getSheet('Equipe!A2:N200');
    const u = eq.find(r => r[0] === session.nome);
    isGestor = u?.[8] === 'gestor' && (u?.[10] || 'ativo') === 'ativo';
    equipeAtivos = eq.filter(r => r[0] && (r[10] || 'ativo').toLowerCase() === 'ativo').map(r => r[0]);
  } catch {}

  if (req.method === 'POST') {
    const action = req.query.action;
    const body = req.body || {};

    try {
      await garantirAba();

      if (action === 'criar') {
        if (!body.titulo?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
        const id = gerarId();
        await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('Compasso!A:I')}:append?valueInputOption=USER_ENTERED`, 'POST', {
          values: [[id, body.titulo.trim(), body.descricao || '', body.responsavel || '', body.status || 'A Fazer', body.prioridade || 'Baixa', session.nome, agoraBRT(), body.prazo || '']]
        });
        return res.status(200).json({ ok: true, id });
      }

      if (action === 'editar' || action === 'mover') {
        if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
        const rows = await getSheet(RANGE);
        const idx = rows.findIndex(r => r[0] === body.id);
        if (idx < 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
        const linha = idx + 2;
        const atual = rows[idx];
        const novaLinha = [
          body.id,
          body.titulo !== undefined ? body.titulo.trim() : atual[1] || '',
          body.descricao !== undefined ? body.descricao : atual[2] || '',
          body.responsavel !== undefined ? body.responsavel : atual[3] || '',
          body.status !== undefined ? body.status : atual[4] || '',
          body.prioridade !== undefined ? body.prioridade : atual[5] || '',
          atual[6] || '',
          atual[7] || '',
          body.prazo !== undefined ? body.prazo : atual[8] || '',
        ];
        await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`Compasso!A${linha}:I${linha}`)}?valueInputOption=USER_ENTERED`, 'PUT', { values: [novaLinha] });
        return res.status(200).json({ ok: true });
      }

      if (action === 'excluir') {
        if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
        const rows = await getSheet(RANGE);
        const idx = rows.findIndex(r => r[0] === body.id);
        if (idx < 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
        const criadoPor = rows[idx][6] || '';
        if (!isGestor && criadoPor !== session.nome) return res.status(403).json({ error: 'Só quem criou ou o gestor pode excluir' });
        const meta = await sheetsRequest(SHEET_ID, '');
        const sheet = meta.sheets?.find(s => s.properties.title === 'Compasso');
        if (!sheet) return res.status(500).json({ error: 'Aba não encontrada' });
        await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
          requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: idx + 1, endIndex: idx + 2 } } }]
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Ação inválida' });
    } catch (err) {
      console.error('compasso POST ERRO:', err.message);
      return res.status(500).json({ error: 'Erro ao processar', detail: err.message });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  try {
    await garantirAba();
    const rows = await getSheet(RANGE);
    const tarefas = rows.filter(r => r[0]).map(r => ({
      id: r[0], titulo: r[1] || '', descricao: r[2] || '', responsavel: r[3] || '',
      status: r[4] || 'A Fazer', prioridade: r[5] || 'Baixa', criadoPor: r[6] || '', criadoEm: r[7] || '', prazo: r[8] || '',
    }));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(renderPage({ nome: session.nome, isGestor, tarefas, equipeAtivos }));
  } catch (err) {
    console.error('compasso GET ERRO:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar', detail: err.message });
  }
}
