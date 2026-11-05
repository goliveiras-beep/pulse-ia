// lib/routes/compasso.js — Compasso: board de tarefas (Kanban) em metodologia ágil.
// Qualquer colaborador ativo pode criar, mover e editar qualquer tarefa; excluir é
// restrito a quem criou a tarefa ou ao gestor.
import { sheetsRequest } from '../google-auth.js';
import { menuItens } from '../menu.js';
import { sincronizarTarefaCompasso, reconciliarAgendaCompasso } from '../google-calendar.js';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX  = 60 * 60 * 24 * 7;
const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const RANGE        = 'Compasso!A2:M500'; // A-I tarefa · J-M: AtualizadoEm, AtualizadoPor, Saude, Progresso
const STATUS_COLS  = ['A Fazer', 'Em Andamento', 'Concluído'];
const PRIORIDADES  = ['Baixa', 'Média', 'Alta'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
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
function slaInfo(prazo, status) {
  if (status === 'Concluído') return { label: 'Concluída', codigo: 'concluida' };
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
    if (!assinaturaBate(h, hash(data + ts))) return null;
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
async function garantirAbaBase() {
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

// Aba com o histórico de atualizações de cada tarefa (uma linha por atualização) e as 4 colunas novas da aba
// Compasso. Gravação sempre por PUT em linha calculada com RAW (nada vira fórmula, sem o bug do values.append).
const ABA_ATUALIZ = 'CompassoAtualizacoes';
const SAUDES = ['No prazo', 'Em risco', 'Atrasada'];
async function garantirAba() { await garantirAbaBase(); await garantirCabecalhoExtra(); }
let cabecalhoExtraOk = false;
async function garantirCabecalhoExtra() {
  if (cabecalhoExtraOk) return;
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('Compasso!J1:M1')}?valueInputOption=RAW`, 'PUT', { values: [['AtualizadoEm', 'AtualizadoPor', 'Saude', 'Progresso']] });
  cabecalhoExtraOk = true;
}
// Aba "Tipo": atualizacao (escrita pela equipe) | status (mudança de status, automática) | etapa (etapa marcada/desmarcada).
let cabecalhoUpdOk = false;
async function garantirAbaAtualizacoes() {
  try {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA_ATUALIZ + '!A1:A1')}`);
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message)) throw e;
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: ABA_ATUALIZ } } }] });
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA_ATUALIZ + '!A1:H1')}?valueInputOption=RAW`, 'PUT', {
      values: [['Tarefa', 'Em', 'Autor', 'Texto', 'Saude', 'Progresso', 'NovoPrazo', 'Tipo']],
    });
    cabecalhoUpdOk = true;
    return;
  }
  if (!cabecalhoUpdOk) { // aba criada antes da coluna Tipo existir
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA_ATUALIZ + '!H1')}?valueInputOption=RAW`, 'PUT', { values: [['Tipo']] });
    cabecalhoUpdOk = true;
  }
}
// Uma linha no histórico da tarefa (status/etapa). Não derruba a ação principal se falhar: quem chama trata.
async function registrarEvento(id, autor, tipo, texto) {
  await garantirAbaAtualizacoes();
  const existentes = await getSheet(ABA_ATUALIZ + '!A2:A5000');
  const n = 2 + existentes.length;
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA_ATUALIZ}!A${n}:H${n}`)}?valueInputOption=RAW`, 'PUT', {
    values: [[id, new Date().toISOString(), autor, texto, '', '', '', tipo]],
  });
}

// Etapas do processo de cada tarefa: uma linha por tarefa, com a lista em JSON [{t: título, f: quando foi feita, p: quem fez}].
// O progresso do cartão vem só delas (quando a tarefa tem etapas).
const ABA_ETAPAS = 'CompassoEtapas';
const MAX_ETAPAS = 30;
async function garantirAbaEtapas() {
  try {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA_ETAPAS + '!A1:A1')}`);
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message)) throw e;
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: ABA_ETAPAS } } }] });
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA_ETAPAS + '!A1:D1')}?valueInputOption=RAW`, 'PUT', {
      values: [['Tarefa', 'Etapas', 'AtualizadoEm', 'AtualizadoPor']],
    });
  }
}
function parseEtapas(celula) {
  try {
    const a = JSON.parse(celula || '[]');
    return Array.isArray(a) ? a.filter(e => e && typeof e.t === 'string' && e.t.trim()).map(e => ({ t: e.t, f: e.f || '', p: e.p || '' })) : [];
  } catch { return []; }
}
function resumoEtapas(lista) {
  const feitas = lista.filter(e => e.f).length;
  const prox = lista.find(e => !e.f);
  return { total: lista.length, feitas, prox: prox ? prox.t : '' };
}
// Modelos de processo sugeridos (ponto de partida: a equipe edita as etapas depois).
const MODELOS_ETAPAS = {
  'Instalação de equipamento': ['Levantar requisitos e local', 'Separar material e cabos', 'Montar e cabear', 'Configurar e energizar', 'Testar com a operação', 'Documentar e entregar'],
  'Manutenção preventiva': ['Planejar a janela de manutenção', 'Inspecionar o equipamento', 'Executar a manutenção', 'Testar após a manutenção', 'Registrar o relatório'],
  'Teste de conceito (POC)': ['Definir objetivo e critérios de sucesso', 'Preparar o ambiente', 'Executar os testes', 'Avaliar os resultados', 'Decidir e registrar'],
  'Software ou aplicação': ['Levantar requisitos', 'Desenvolver ou configurar', 'Testar', 'Instalar em produção', 'Treinar a equipe'],
};

// ── Sinais de atualização do cartão ─────────────────────────────────────────────
// ES5 de propósito e sem variáveis de fora: estas três funções são injetadas TAL QUAL no JavaScript do navegador
// (via toString), então o servidor (primeira renderização) e a tela (filtros) calculam e desenham exatamente igual.
function criadoEmISO(t) {
  var m = /(\d+)\/(\d+)\/(\d+),? (\d+):(\d+)/.exec((t && t.criadoEm) || '');
  if (!m) return '';
  var p = function (n) { return ('0' + n).slice(-2); };
  return m[3] + '-' + p(m[2]) + '-' + p(m[1]) + 'T' + p(m[4]) + ':' + p(m[5]) + ':00-03:00'; // criadoEm é horário de Brasília
}
function diasDesdeAtualizacao(t) {
  if (!t || t.status === 'Concluído') return null;
  var ref = new Date(t.atualizadoEm || criadoEmISO(t));
  if (isNaN(ref.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - ref.getTime()) / 86400000));
}
function sinaisCard(t, esc) {
  var html = '';
  var dias = diasDesdeAtualizacao(t);
  if (dias !== null) {
    var nunca = !t.atualizadoEm;
    var plural = dias === 1 ? ' dia' : ' dias';
    var txt = nunca
      ? (dias === 0 ? 'Criada hoje' : 'Sem atualização há ' + dias + plural)
      : 'Atualizada ' + (dias === 0 ? 'hoje' : 'há ' + dias + plural) + (t.atualizadoPor ? ' · ' + esc(t.atualizadoPor.split(' ')[0]) : '');
    html += '<div class="card-upd ' + (dias >= 7 ? 'upd-warn' : 'upd-ok') + '" onclick="event.stopPropagation();abrirTarefa(\'' + esc(t.id) + '\',\'upd\')" title="Registrar atualização">🕒 ' + txt + '</div>';
  }
  if (t.status !== 'Concluído' && t.saude) {
    var cl = t.saude === 'No prazo' ? 'saude-ok' : t.saude === 'Em risco' ? 'saude-risco' : 'saude-atraso';
    html += '<span class="saude-chip ' + cl + '">' + esc(t.saude) + '</span>';
  }
  var te = parseInt(t.etapasTotal, 10) || 0;
  if (t.status !== 'Concluído' && te > 0) {
    var fe = parseInt(t.etapasFeitas, 10) || 0;
    var n = Math.min(te, 12), cheias = Math.round(fe / te * n), segs = '';
    for (var k = 0; k < n; k++) segs += '<span' + (k < cheias ? ' class="on"' : '') + '></span>';
    html += '<div class="card-etapas" onclick="event.stopPropagation();abrirTarefa(\'' + esc(t.id) + '\',\'evo\')" title="Ver as etapas">'
      + '<div class="ce-topo"><b>' + fe + ' de ' + te + (te === 1 ? ' etapa' : ' etapas') + '</b><span>' + Math.round(100 * fe / te) + '%</span></div>'
      + '<div class="ce-segs">' + segs + '</div>'
      + (t.etapaProx ? '<div class="ce-prox">Próxima: <b>' + esc(t.etapaProx) + '</b></div>' : '') + '</div>';
  } else {
    var p = parseInt(t.progresso, 10);
    if (t.status !== 'Concluído' && p > 0) html += '<div class="prog" title="Progresso ' + Math.min(100, p) + '%"><i style="width:' + Math.min(100, p) + '%"></i></div>';
  }
  return html ? '<div class="card-sinais">' + html + '</div>' : '';
}

// ── HTML ─────────────────────────────────────────────────────────────────────
function renderPage({ nome, isGestor, isView, tarefas, equipeAtivos }) {
  const optsModelos = Object.keys(MODELOS_ETAPAS).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  const optsProgresso = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(p => `<option value="${p}">${p}%</option>`).join('');
  const corPrioridade = p => p === 'Alta' ? '#dc2626' : p === 'Média' ? '#d97706' : '#16a34a';

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
.sla-concluida{background:rgba(22,163,74,.15);color:#16a34a}
.backlog-item{background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:10px 14px;display:flex;align-items:center;gap:12px;margin-bottom:8px}
.backlog-item .card-titulo{flex:1}
.backlog-empty{font-size:13px;color:var(--muted);text-align:center;padding:24px 0}
.col-empty{font-size:12px;color:var(--muted);text-align:center;padding:16px 0}
.card-titulo{font-size:13px;font-weight:600;margin-bottom:4px}
.card-resps{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.card-resp{display:flex;align-items:center;gap:5px}
.avatar-mini{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.card-prazo{white-space:nowrap}
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
.card-sinais{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 7px}
.card-upd{font-size:10.5px;font-weight:600;cursor:pointer}
.card-upd:hover{text-decoration:underline}
.upd-ok{color:var(--muted)}
.upd-warn{color:#b45309}
html.dark .upd-warn{color:#fbbf24}
.saude-chip{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px}
.saude-ok{background:rgba(22,163,74,.15);color:#16a34a}
.saude-risco{background:rgba(217,119,6,.15);color:#d97706}
.saude-atraso{background:rgba(220,38,38,.15);color:#dc2626}
.prog{flex:1 1 100%;height:4px;border-radius:999px;background:var(--border);overflow:hidden}
.prog i{display:block;height:100%;background:#16a34a}
.mtabs{display:flex;gap:16px;border-bottom:1px solid var(--border);margin:-4px 0 6px}
.mtab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 0;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;font-family:inherit;margin-bottom:-1px}
.mtab.active{color:var(--text);border-bottom-color:#1d4ed8}
.modal.larga{width:540px}
.upd-alerta{border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.5;margin-bottom:6px}
.upd-alerta.warn{background:rgba(217,119,6,.12);border:1px solid rgba(217,119,6,.3);color:#b45309}
html.dark .upd-alerta.warn{color:#fbbf24}
.upd-alerta.info{background:var(--bg);border:1px solid var(--border);color:var(--text2)}
.saude-btns{display:flex;gap:6px;flex-wrap:wrap}
.saude-btn{background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.saude-btn.s-ok.on{background:#16a34a;border-color:#16a34a;color:#fff}
.saude-btn.s-risco.on{background:#d97706;border-color:#d97706;color:#fff}
.saude-btn.s-atraso.on{background:#dc2626;border-color:#dc2626;color:#fff}
.tl{margin-top:16px}
.tl-titulo{font-size:12px;font-weight:700;margin-bottom:8px}
.tl-item{display:flex;gap:10px;padding-bottom:14px;position:relative}
.tl-item:not(:last-child)::before{content:'';position:absolute;left:4px;top:14px;bottom:0;width:2px;background:var(--border)}
.tl-dot{width:10px;height:10px;border-radius:50%;background:#94a3b8;margin-top:4px;flex:none}
.tl-dot.venceu{background:#dc2626}.tl-dot.upd{background:#1d4ed8}
.tl-t{font-size:12px;font-weight:600}.tl-m{font-size:11px;color:var(--muted);margin-top:2px}
.tl-txt{font-size:13px;margin-top:4px;white-space:pre-wrap;word-break:break-word}
.tl-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.card-etapas{flex:1 1 100%;cursor:pointer}
.ce-topo{display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:4px}
.ce-segs{display:flex;gap:3px}
.ce-segs span{flex:1;height:5px;border-radius:999px;background:var(--border)}
.ce-segs span.on{background:#16a34a}
.ce-prox{font-size:11px;color:var(--muted);margin-top:5px}
.evo-bloco{margin-top:16px}
.evo-topo{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.evo-acoes{display:flex;gap:6px;flex-wrap:wrap}
.evo-acoes select{width:auto!important;padding:5px 8px!important;font-size:12px!important}
.btn-mini{background:none;border:1px solid var(--border);border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text);font-family:inherit}
.prog.big{height:6px;margin-bottom:10px}
.etapas{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.etapa{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--border)}
.etapa:first-child{border-top:0}
.etapa input{width:16px!important;height:16px;margin:0;flex:none;padding:0!important}
.etapa label{flex:1;margin:0!important;font-size:13px!important;font-weight:500!important;color:var(--text)!important;cursor:pointer}
.etapa.feita label{text-decoration:line-through;color:var(--muted)!important}
.etapa-meta{font-size:11px;color:var(--muted);white-space:nowrap}
.etapa-prox{font-size:10px;font-weight:700;color:#0e7c7b;background:rgba(14,124,123,.15);border-radius:999px;padding:2px 8px}
.etapa-x{background:none;border:0;color:var(--muted);font-size:16px;cursor:pointer;padding:0 4px}
.evo-add{display:flex;gap:6px;margin-top:8px}
.trilha{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap}
.tr-item{flex:1 1 110px;min-width:90px}
.tr-linha{display:flex;align-items:center}
.tr-bolha{width:20px;height:20px;border-radius:50%;background:var(--border);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box}
.tr-fio{flex:1;height:2px;background:var(--border);margin:0 5px}
.tr-item.ok .tr-bolha{background:#16a34a}.tr-item.ok .tr-fio{background:#16a34a}
.tr-item.agora .tr-bolha{background:var(--card);border:3px solid #1d4ed8}
.tr-t{font-size:12px;font-weight:600;margin-top:6px}.tr-item.agora .tr-t{color:#1d4ed8}
.tr-s{font-size:11px;color:var(--muted);margin-top:2px;padding-right:6px}
.tr-item:last-child .tr-fio{display:none}
.tl-dot.status{background:#7c3aed}.tl-dot.etapa{background:#16a34a}
:root{--lane:#eceef2;--red:#b42318;--red-bg:#fee4e2;--amber:#b54708;--amber-bg:#fef0c7;--teal:#0e7c7b;--teal-bg:#d5f2f0;--gray-bg:#f2f4f7;--gray-fg:#344054}
html.dark{--lane:#1a1d27;--red:#f97066;--red-bg:rgba(240,68,56,.2);--amber:#fdb022;--amber-bg:rgba(247,144,9,.2);--teal:#3fb8b6;--teal-bg:rgba(63,184,182,.18);--gray-bg:#2d3140;--gray-fg:#cbd5e1}
.wrap{max-width:1360px}
.top-info .title{font-size:28px;font-weight:700;letter-spacing:-.02em}
.top-info .sub{font-size:14px}
.top-acoes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn-nova,.btn-ok{background:#0e7c7b}
.chip-badge{background:#0e7c7b}
.mtab.active{border-bottom-color:#0e7c7b}
.tl-dot.upd{background:#0e7c7b}
.view-toggle{background:var(--lane);border:0;border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}
.view-btn{padding:7px 14px;border-radius:8px;font-size:13px}
.view-btn.active{background:var(--card);color:var(--text);box-shadow:0 1px 2px rgba(16,24,40,.15)}
.faixa-aviso{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--amber-bg);border:1px solid rgba(181,71,8,.3);border-radius:12px;padding:12px 16px;margin-bottom:14px;font-size:14px;line-height:1.5}
.faixa-aviso p{flex:1 1 300px}
.faixa-btns{display:flex;gap:8px;flex-wrap:wrap}
.btn-ghost{border:1px solid var(--input-border);background:var(--card);color:var(--text);border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.stat{flex:1 1 200px;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;cursor:pointer;font-family:inherit;color:var(--text)}
.stat:hover{border-color:var(--teal)}
.stat-l{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.stat-v{font-size:30px;font-weight:700;margin-top:6px;line-height:1;font-variant-numeric:tabular-nums}
.stat-v small{font-size:15px;font-weight:500;color:var(--muted)}
.stat-s{font-size:13px;color:var(--text2);margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat-bar{height:6px;border-radius:999px;background:var(--border);margin-top:10px;overflow:hidden}
.stat-bar i{display:block;height:100%;background:var(--teal)}
.filtros-bar{justify-content:space-between}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{border:1px solid var(--input-border);background:var(--card);color:var(--text2);border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.chip.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.chip.chip-red{border-color:var(--red);color:var(--red)}
.chip.chip-red.on{background:var(--red);color:#fff}
.chip-n{opacity:.7;margin-left:4px;font-variant-numeric:tabular-nums}
.filtros-dir{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.f-busca{border:1px solid var(--input-border);border-radius:10px;padding:7px 12px;font-size:13px;background:var(--input-bg);color:var(--text);font-family:inherit;outline:none;min-width:180px}
.board2{display:flex;gap:16px;align-items:flex-start}
@media (max-width:900px){.board2{overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px}.col2{flex:0 0 85vw!important;scroll-snap-align:start}}
.col2{flex:1 1 0;min-width:0;background:var(--lane);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}
.col2-head{display:flex;align-items:center;gap:8px;padding:2px 4px 4px}
.col2-head h2{font-size:14px;font-weight:700}
.col2-dot{width:10px;height:10px;border-radius:50%;flex:none}
.col2-n{font-size:13px;font-weight:600;color:var(--muted)}
.col2-add{margin-left:auto;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--text2);font-size:18px;line-height:1;cursor:pointer}
.col2-add:hover{background:var(--card)}
.col2-cards{display:flex;flex-direction:column;gap:10px}
.col-mais{border:1px dashed var(--muted);background:transparent;color:var(--text2);border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.nc{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.06)}
.nc:hover{border-color:var(--teal)}
.nc:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.nc-top{display:flex;align-items:center;gap:8px}
.nc-dot{width:8px;height:8px;border-radius:50%;flex:none}
.nc-prio{font-size:12px;font-weight:500;color:var(--text2)}
.nc-titulo{font-size:14px;font-weight:600;line-height:1.4;margin:0}
.nc-desc{font-size:12px;color:var(--muted);line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.nc-feito .nc-titulo{color:var(--muted)}
.nc .card-sinais{margin:0}
.nc-rodape{display:flex;align-items:center;justify-content:space-between;gap:8px}
.due{display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap}
.due-red{background:var(--red-bg);color:var(--red)}
.due-amber{background:var(--amber-bg);color:var(--amber)}
.due-gray{background:var(--gray-bg);color:var(--gray-fg)}
.nc-avs{display:flex;align-items:center}
.nc-av{width:28px;height:28px;box-sizing:border-box;border-radius:50%;border:2px solid var(--card);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.nc-mais{background:var(--gray-bg);color:var(--gray-fg)}
.nc-semresp{font-size:12px;font-weight:600;color:var(--amber);border:1px dashed var(--amber);border-radius:999px;padding:3px 10px}
.meu-resumo{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.meu-sec{margin-bottom:22px}
.meu-sec h2{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px}
.meu-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
.mc-acoes{display:flex;gap:8px;flex-wrap:wrap}
.mc-btn{flex:1;min-height:40px;border:1px solid var(--input-border);background:var(--card);color:var(--text);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;padding:0 12px}
.mc-btn.pri{background:#0e7c7b;border-color:#0e7c7b;color:#fff;flex:1.4}
.mc-btn.risco{border-color:var(--amber);color:var(--amber)}
.meu-vazio{font-size:14px;color:var(--muted);padding:20px 0}
.alerta-banner.esconde-meu{display:none!important}
.view-toggle{max-width:100%;overflow-x:auto;flex-wrap:nowrap}
.view-btn{white-space:nowrap}
@media (max-width:600px){
  .wrap{padding:14px}
  .top-info .title{font-size:24px}
  .top-acoes{width:100%}
  .btn-nova{width:100%}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stat{padding:10px 12px}
  .stat-v{font-size:24px}
  .stat-s{white-space:normal;font-size:12px}
  .faixa-aviso{padding:10px 12px;font-size:13px;align-items:flex-start}
  .faixa-aviso p{flex:1 1 0;min-width:0}
  .f-busca{flex:1 1 100%}
  .filtros-dir{width:100%}
  .meu-lista{grid-template-columns:1fr}
}
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
        ${menuItens(isGestor)}
      </div>
    </div>
  </div>
</div>
<div class="wrap">
  <div class="top-bar">
    <div class="top-info">
      <div class="title">Compasso</div>
      <div class="sub">O que está andando, o que travou e o que venceu, em um lugar só.</div>
    </div>
    <div class="top-acoes">
      <div class="view-toggle" role="tablist" aria-label="Visões">
        <button id="vb-quadro" class="view-btn active" role="tab" onclick="mudarView('quadro')">Quadro</button>
        <button id="vb-meu" class="view-btn" role="tab" onclick="mudarView('meu')">Meu trabalho</button>
        <button id="vb-grafico" class="view-btn" role="tab" onclick="mudarView('grafico')">Gráficos</button>
        <button id="vb-backlog" class="view-btn" role="tab" onclick="mudarView('backlog')">Concluídas</button>
      </div>
      <button class="btn-nova" onclick="novaTarefa('A Fazer')">+ Nova tarefa</button>
    </div>
  </div>

  <div id="alerta-pessoal" class="alerta-banner"></div>

  <div id="faixa-saude"></div>

  <div class="filtros-bar" id="filtros">
    <div class="chips" id="chips"></div>
    <div class="filtros-dir">
      <input id="f-busca" type="search" class="f-busca" placeholder="Buscar… (Ctrl K)" aria-label="Buscar tarefas" oninput="aplicarFiltros()">
      <select id="f-pessoa" onchange="aplicarFiltros()" aria-label="Responsável">
        <option value="">Todas as pessoas</option>
        ${optsPessoaFiltro}
      </select>
      <select id="f-prioridade" onchange="aplicarFiltros()" aria-label="Prioridade">
        <option value="">Toda prioridade</option>
        ${optsPrior}
      </select>
      <select id="f-ordem" onchange="aplicarFiltros()" aria-label="Ordenar">
        <option value="prazo">Ordenar: prazo</option>
        <option value="prioridade">Ordenar: prioridade</option>
        <option value="parado">Ordenar: mais parada</option>
        <option value="recente">Ordenar: mais recente</option>
      </select>
      ${isGestor ? '<button class="chip-minhas" onclick="conferirAgenda()" title="Confere e corrige o prazo de todas as tarefas na Agenda do Google de cada responsável">📅 Conferir agenda</button>' : ''}
    </div>
  </div>

  <div id="quadro-view">
    <div class="board2" id="board-view"></div>
  </div>

  <div id="meu-view" style="display:none"></div>

  <div id="backlog-view" style="display:none">
    <div id="backlog-lista"></div>
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
  <div class="modal" id="modal-box">
    <h3 id="modal-titulo-h">📌 Nova tarefa</h3>
    <input type="hidden" id="t-id">
    <div class="mtabs" id="modal-tabs" style="display:none">
      <button type="button" class="mtab active" id="tab-det" onclick="trocarAba('det')">Detalhes</button>
      <button type="button" class="mtab" id="tab-evo" onclick="trocarAba('evo')">Evolução</button>
      <button type="button" class="mtab" id="tab-upd" onclick="trocarAba('upd')">Atualizações <span id="tab-upd-n"></span></button>
    </div>
    <div id="pane-det">
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
    <div style="font-size:10px;color:var(--muted);margin-top:4px">📅 Com prazo definido, cria um evento (com aviso) na Agenda do Google de cada responsável que já autorizou a sincronização.</div>
    <div class="modal-btns">
      <button class="btn-danger" id="t-btn-excluir" style="display:none;margin-right:auto" onclick="excluirTarefa()">Excluir</button>
      <button class="btn-cancel-m" onclick="closeModal('modal-tarefa')">Cancelar</button>
      <button class="btn-ok" onclick="salvarTarefa()">Salvar</button>
    </div>
    </div>
    <div id="pane-evo" style="display:none">
      <div class="evo-bloco" style="margin-top:4px">
        <div class="tl-titulo">Trilha da tarefa</div>
        <div id="evo-trilha"></div>
        <div class="tl-m" style="margin-top:8px">A trilha é preenchida sozinha: cada mudança de status registra quem mudou, quando e quanto tempo a tarefa ficou em cada fase.</div>
      </div>
      <div class="evo-bloco">
        <div class="evo-topo">
          <div class="tl-titulo" style="margin:0">Etapas do processo <span id="evo-cont" style="font-weight:500;color:var(--muted)"></span></div>
          <div class="evo-acoes" id="evo-acoes">
            <select id="evo-modelo" onchange="usarModelo()"><option value="">Usar um modelo…</option>${optsModelos}</select>
            <button type="button" class="btn-mini" onclick="etapasDaDescricao()" title="Cada linha da descrição vira uma etapa">Criar da descrição</button>
          </div>
        </div>
        <div class="prog big"><i id="evo-barra" style="width:0%"></i></div>
        <ul class="etapas" id="evo-lista"></ul>
        <div class="evo-add" id="evo-add">
          <input id="evo-novo" maxlength="120" placeholder="Nova etapa" onkeydown="teclaEtapa(event)">
          <button type="button" class="btn-mini" onclick="addEtapa()">+ Etapa</button>
        </div>
        <div class="tl-m" style="margin-top:8px">O progresso do cartão vem só das etapas concluídas. Os modelos são sugestões: edite à vontade.</div>
      </div>
      <div class="tl"><div class="tl-titulo">Linha do tempo</div><div id="evo-linha"></div></div>
    </div>
    <div id="pane-upd" style="display:none">
      <div id="upd-alerta" class="upd-alerta info"></div>
      <div id="upd-form">
        <label>Nova atualização</label>
        <textarea id="u-texto" maxlength="1000" placeholder="O que andou, o que travou e qual o próximo passo?"></textarea>
        <label>Saúde da tarefa</label>
        <div class="saude-btns">
          <button type="button" class="saude-btn s-ok" data-s="No prazo" onclick="escolherSaude('No prazo')">No prazo</button>
          <button type="button" class="saude-btn s-risco" data-s="Em risco" onclick="escolherSaude('Em risco')">Em risco</button>
          <button type="button" class="saude-btn s-atraso" data-s="Atrasada" onclick="escolherSaude('Atrasada')">Atrasada</button>
        </div>
        <div id="u-prog-bloco">
        <label>Progresso</label>
        <select id="u-progresso"><option value="">Não alterar</option>${optsProgresso}</select>
        </div>
        <label>Novo prazo (opcional)</label>
        <input type="date" id="u-prazo">
        <div class="modal-btns">
          <button class="btn-cancel-m" onclick="closeModal('modal-tarefa')">Fechar</button>
          <button class="btn-ok" id="u-btn" onclick="publicarAtualizacao()">Publicar atualização</button>
        </div>
      </div>
      <div class="tl"><div class="tl-titulo">Linha do tempo</div><div id="upd-lista"></div></div>
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
var IS_VIEW = ${JSON.stringify(!!isView)};
var MODELOS = ${JSON.stringify(MODELOS_ETAPAS)};
${criadoEmISO.toString()}
${diasDesdeAtualizacao.toString()}
${sinaisCard.toString()}

function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});

function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-bg').forEach(function(m){m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('open');});});

function showToast(msg,ok,ms){var t=document.getElementById('toast');t.textContent=msg;t.style.background=ok?'#166534':'#dc2626';t.style.display='block';clearTimeout(showToast._t);showToast._t=setTimeout(function(){t.style.display='none';},ms||2600);}

// ── Filtros + view Quadro/Gráficos ─────────────────────────────────────────
var viewAtual='quadro';
var chartPessoa=null, chartStatus=null;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function iniciais(n){return (n||'?').split(' ').slice(0,2).map(function(p){return p[0]||'';}).join('').toUpperCase()||'?';}
function corPrioridade(p){return p==='Alta'?'#dc2626':p==='Média'?'#d97706':'#16a34a';}
function hojeISOClient(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function diasParaClient(prazo){if(!prazo)return null;var hoje=new Date(hojeISOClient()+'T00:00:00');var alvo=new Date(prazo+'T00:00:00');return Math.round((alvo-hoje)/86400000);}
function slaInfo(prazo,status){
  if(status==='Concluído')return{label:'Concluída',codigo:'concluida'};
  var d=diasParaClient(prazo);
  if(d===null)return null;
  if(d<0)return{label:'Atrasada',codigo:'atrasada'};
  if(d<=3)return{label:(d===0?'Vence hoje':'Vence em '+d+(d===1?' dia':' dias')),codigo:'atencao'};
  return{label:'No prazo',codigo:'ok'};
}

var chipAtivo='todas', expandido={}, LIMITE_COL=6;
var PRIO_PESO={'Alta':0,'Média':1,'Baixa':2};
var PAL=[['#d1e9ff','#175cd3'],['#d5f2f0','#0a5f5e'],['#fce7f6','#c11574'],['#ebe9fe','#5925dc'],['#fef0c7','#b54708'],['#e0eaff','#3538cd']];
var COR_COL={'A Fazer':'#98a2b3','Em Andamento':'#1d4ed8','Concluído':'#0e7c7b'};
function respsDe(t){return (t.responsavel||'').split(',').map(function(s){return s.trim();}).filter(Boolean);}
function semAcento(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
function fmtDiaMes(p){var x=String(p||'').split('-');return x.length===3?x[2]+'/'+x[1]:String(p||'');}
function corAvatar(nome){var h=0;for(var i=0;i<nome.length;i++)h=(h*31+nome.charCodeAt(i))>>>0;return PAL[h%PAL.length];}
function avatarHtml(nome,i){var c=corAvatar(nome);return '<span class="nc-av" title="'+esc(nome)+'" aria-label="'+esc(nome)+'" style="background:'+c[0]+';color:'+c[1]+(i?';margin-left:-8px':'')+'">'+esc(iniciais(nome))+'</span>';}
function avataresHtml(t){
  var rs=respsDe(t);
  if(!rs.length)return '<span class="nc-semresp">Sem responsável</span>';
  var h=rs.slice(0,3).map(avatarHtml).join('');
  if(rs.length>3)h+='<span class="nc-av nc-mais" style="margin-left:-8px" title="'+esc(rs.slice(3).join(', '))+'">+'+(rs.length-3)+'</span>';
  return '<span class="nc-avs">'+h+'</span>';
}
function dueInfo(t){
  if(t.status==='Concluído')return{txt:t.prazo?'Prazo '+fmtDiaMes(t.prazo):'Concluída',cls:'due-gray'};
  var d=diasParaClient(t.prazo);
  if(d===null)return{txt:'Sem prazo',cls:'due-gray'};
  if(d<0)return{txt:'Atrasada há '+(-d)+(d===-1?' dia':' dias'),cls:'due-red'};
  if(d===0)return{txt:'Vence hoje',cls:'due-amber'};
  if(d<=3)return{txt:'Vence em '+d+(d===1?' dia':' dias'),cls:'due-amber'};
  return{txt:'Em '+d+' dias · '+fmtDiaMes(t.prazo),cls:'due-gray'};
}
function passaChip(t){
  if(chipAtivo==='todas')return true;
  if(t.status==='Concluído')return false;
  if(chipAtivo==='minhas')return respsDe(t).indexOf(NOME_ATUAL)!==-1;
  var d=diasParaClient(t.prazo);
  if(chipAtivo==='atrasadas')return d!==null&&d<0;
  if(chipAtivo==='semana')return d!==null&&d>=0&&d<=7;
  if(chipAtivo==='stale'){var du=diasDesdeAtualizacao(t);return du!==null&&du>=7;}
  return true;
}
function tarefaPassaFiltro(t,fp,fpr,q){
  if(fp&&respsDe(t).indexOf(fp)===-1)return false;
  if(fpr&&t.prioridade!==fpr)return false;
  if(q){var palheiro=semAcento(t.titulo+' '+t.descricao+' '+t.responsavel),termos=q.split(' ').filter(Boolean);
    for(var i=0;i<termos.length;i++){if(palheiro.indexOf(termos[i])===-1)return false;} // todas as palavras, em qualquer ordem
  }
  return passaChip(t);
}
function listaFiltrada(){
  var fp=document.getElementById('f-pessoa').value;
  var fpr=document.getElementById('f-prioridade').value;
  var q=semAcento(document.getElementById('f-busca').value.trim());
  return TAREFAS.filter(function(t){return tarefaPassaFiltro(t,fp,fpr,q);});
}
function ordenar(lista){
  var o=document.getElementById('f-ordem').value;
  return lista.slice().sort(function(a,b){
    if(o==='prioridade'){var dp=(PRIO_PESO[a.prioridade]===undefined?2:PRIO_PESO[a.prioridade])-(PRIO_PESO[b.prioridade]===undefined?2:PRIO_PESO[b.prioridade]);if(dp)return dp;}
    if(o==='parado'){var da=diasDesdeAtualizacao(a),db=diasDesdeAtualizacao(b);da=da===null?-1:da;db=db===null?-1:db;if(db!==da)return db-da;}
    if(o==='recente'){var ca=criadoEmISO(a),cb=criadoEmISO(b);if(ca!==cb)return ca<cb?1:-1;}
    var pa=a.prazo||'9999-99-99',pb=b.prazo||'9999-99-99';
    return pa<pb?-1:pa>pb?1:0;
  });
}

function montarCard(t){
  var di=dueInfo(t),feito=t.status==='Concluído';
  return '<article class="nc'+(feito?' nc-feito':'')+'" tabindex="0" role="button" onclick="abrirTarefa(\\''+esc(t.id)+'\\')">'
    +'<div class="nc-top"><span class="nc-dot" style="background:'+corPrioridade(t.prioridade)+'"></span><span class="nc-prio">'+esc(t.prioridade||'Baixa')+'</span></div>'
    +'<h3 class="nc-titulo">'+esc(t.titulo)+'</h3>'
    +(t.descricao&&!feito?'<div class="nc-desc">'+esc(t.descricao)+'</div>':'')
    +sinaisCard(t,esc)
    +'<div class="nc-rodape"><span class="due '+di.cls+'">'+esc(di.txt)+'</span>'+avataresHtml(t)+'</div>'
    +'</article>';
}
function expandirColuna(status){expandido[status]=true;aplicarFiltros();}
function montarColunas(lista){
  return STATUS_COLS.map(function(status){
    var itens=ordenar(lista.filter(function(t){return t.status===status||(STATUS_COLS.indexOf(t.status)===-1&&status==='A Fazer');}));
    var lim=expandido[status]?itens.length:LIMITE_COL;
    var cards=itens.slice(0,lim).map(montarCard).join('')||'<div class="col-empty">Nenhuma tarefa aqui</div>';
    var mais=itens.length>lim?'<button type="button" class="col-mais" onclick="expandirColuna(\\''+status+'\\')">Mostrar mais '+(itens.length-lim)+'</button>':'';
    return '<section class="col2"><div class="col2-head"><span class="col2-dot" style="background:'+COR_COL[status]+'"></span><h2>'+esc(status)+'</h2><span class="col2-n">'+itens.length+'</span>'
      +'<button type="button" class="col2-add" aria-label="Nova tarefa em '+esc(status)+'" onclick="novaTarefa(\\''+status+'\\')">+</button></div>'
      +'<div class="col2-cards">'+cards+'</div>'+mais+'</section>';
  }).join('');
}

function contagens(){
  var c={todas:TAREFAS.length,minhas:0,atrasadas:0,stale:0,semana:0};
  TAREFAS.forEach(function(t){
    if(t.status==='Concluído')return;
    var d=diasParaClient(t.prazo),du=diasDesdeAtualizacao(t);
    if(respsDe(t).indexOf(NOME_ATUAL)!==-1)c.minhas++;
    if(d!==null&&d<0)c.atrasadas++;
    if(d!==null&&d>=0&&d<=7)c.semana++;
    if(du!==null&&du>=7)c.stale++;
  });
  return c;
}
function setChip(c){chipAtivo=c;if(viewAtual!=='quadro')mudarView('quadro');else aplicarFiltros();}
function renderChips(){
  var c=contagens(),defs=[['todas','Todas'],['minhas','Minhas'],['atrasadas','Atrasadas'],['stale','Sem atualização 7+ dias'],['semana','Vencem na semana']];
  document.getElementById('chips').innerHTML=defs.map(function(x){
    var on=chipAtivo===x[0];
    return '<button type="button" class="chip'+(on?' on':'')+(x[0]==='atrasadas'?' chip-red':'')+'" aria-pressed="'+on+'" onclick="setChip(\\''+x[0]+'\\')">'+x[1]+' <span class="chip-n">'+c[x[0]]+'</span></button>';
  }).join('');
  var b=document.getElementById('chip-minhas-badge');if(b)b.textContent=c.minhas;
}
function renderFaixa(){
  var abertas=0,aFazer=0,andamento=0,atr=0,semana=0,conc=0,maior=0,prox=null,stale=0;
  TAREFAS.forEach(function(t){
    if(t.status==='Concluído'){conc++;return;}
    abertas++;if(t.status==='Em Andamento')andamento++;else aFazer++;
    var d=diasParaClient(t.prazo),du=diasDesdeAtualizacao(t);
    if(d!==null&&d<0){atr++;if(-d>maior)maior=-d;}
    if(d!==null&&d>=0&&d<=7){semana++;if(!prox||t.prazo<prox.prazo)prox=t;}
    if(du!==null&&du>=7)stale++;
  });
  var total=TAREFAS.length,pct=total?Math.round(100*conc/total):0,h='';
  if(atr>0){
    h+='<div class="faixa-aviso"><span aria-hidden="true">⚠️</span><p><b>'+atr+(atr===1?' tarefa passou do prazo':' tarefas passaram do prazo')+'</b>'
      +(stale?' e '+stale+(stale===1?' está':' estão')+' sem atualização há 7+ dias':'')
      +'. Atualize o andamento ou ajuste o prazo: a agenda de cada responsável acompanha.</p>'
      +'<div class="faixa-btns"><button type="button" class="btn-ghost" onclick="setChip(\\'atrasadas\\')">Ver atrasadas</button>'
      +(stale?'<button type="button" class="btn-ghost" onclick="setChip(\\'stale\\')">Ver paradas</button>':'')+'</div></div>';
  }
  function stat(chip,rot,cor,valor,sub,extra){return '<button type="button" class="stat" onclick="setChip(\\''+chip+'\\')"><div class="stat-l"'+(cor?' style="color:'+cor+'"':'')+'>'+rot+'</div><div class="stat-v"'+(cor?' style="color:'+cor+'"':'')+'>'+valor+'</div><div class="stat-s">'+sub+'</div>'+(extra||'')+'</button>';}
  h+='<div class="stats">'
    +stat('todas','Abertas','',abertas,aFazer+' a fazer · '+andamento+' em andamento')
    +stat('atrasadas','Atrasadas','var(--red)',atr,atr?(abertas?Math.round(100*atr/abertas):0)+'% das abertas · maior atraso: '+maior+(maior===1?' dia':' dias'):'nenhuma atrasada')
    +stat('semana','Vencem em 7 dias','var(--amber)',semana,prox?(semana===1?esc(prox.titulo):'próxima: '+esc(prox.titulo)):'nenhuma nos próximos 7 dias')
    +stat('todas','Concluídas','var(--teal)',conc+' <small>de '+total+'</small>',pct+'% do total','<div class="stat-bar"><i style="width:'+pct+'%"></i></div>')
    +'</div>';
  document.getElementById('faixa-saude').innerHTML=h;
}

// ── Meu trabalho: o que é meu, por urgência, com ações de um toque ──
function cardMeu(t){
  var di=dueInfo(t),du=diasDesdeAtualizacao(t);
  var parado=du!==null&&du>=7?'<span class="due due-amber">'+(t.atualizadoEm?'Atualizada há '+du+' dias':'Sem atualização há '+du+' dias')+'</span>':'';
  var acoes=IS_VIEW?'':'<div class="mc-acoes"><button type="button" class="mc-btn pri" onclick="abrirTarefa(\\''+esc(t.id)+'\\',\\'upd\\')">Atualizar</button>'
    +'<button type="button" class="mc-btn risco" onclick="marcarRisco(\\''+esc(t.id)+'\\')">Em risco</button>'
    +'<button type="button" class="mc-btn" onclick="concluirRapido(\\''+esc(t.id)+'\\')">Concluir</button></div>';
  return '<article class="nc"><div class="nc-top"><span class="nc-dot" style="background:'+corPrioridade(t.prioridade)+'"></span><span class="nc-prio">'+esc(t.prioridade||'Baixa')+' · '+esc(t.status)+'</span></div>'
    +'<h3 class="nc-titulo" style="cursor:pointer" onclick="abrirTarefa(\\''+esc(t.id)+'\\')">'+esc(t.titulo)+'</h3>'
    +sinaisCard(t,esc)
    +'<div class="nc-rodape"><span class="due '+di.cls+'">'+esc(di.txt)+'</span>'+parado+'</div>'+acoes+'</article>';
}
function renderMeu(){
  var minhas=ordenar(TAREFAS.filter(function(t){return t.status!=='Concluído'&&respsDe(t).indexOf(NOME_ATUAL)!==-1;}));
  var g={atr:[],sem:[],dep:[]};
  minhas.forEach(function(t){var d=diasParaClient(t.prazo);if(d!==null&&d<0)g.atr.push(t);else if(d!==null&&d<=7)g.sem.push(t);else g.dep.push(t);});
  var concl=TAREFAS.filter(function(t){return t.status==='Concluído'&&respsDe(t).indexOf(NOME_ATUAL)!==-1;}).length;
  function sec(tit,cor,lista){return lista.length?'<div class="meu-sec"><h2 style="color:'+cor+'">'+tit+' · '+lista.length+'</h2><div class="meu-lista">'+lista.map(cardMeu).join('')+'</div></div>':'';}
  var h='<div class="meu-resumo"><div class="stat" style="cursor:default"><div class="stat-l" style="color:var(--red)">Atrasadas</div><div class="stat-v" style="color:var(--red)">'+g.atr.length+'</div></div>'
    +'<div class="stat" style="cursor:default"><div class="stat-l" style="color:var(--amber)">Vencem em 7 dias</div><div class="stat-v" style="color:var(--amber)">'+g.sem.length+'</div></div>'
    +'<div class="stat" style="cursor:default"><div class="stat-l" style="color:var(--teal)">Concluídas</div><div class="stat-v" style="color:var(--teal)">'+concl+'</div></div></div>';
  h+=sec('Atrasadas','var(--red)',g.atr)+sec('Esta semana','var(--amber)',g.sem)+sec('Depois','var(--text2)',g.dep);
  if(!minhas.length)h+='<div class="meu-vazio">Você não tem tarefas abertas. 🎉</div>';
  document.getElementById('meu-view').innerHTML=h;
}
async function marcarRisco(id){
  var t=TAREFAS.find(function(x){return x.id===id;});if(!t)return;
  try{
    var r=await fetch('/api/compasso?action=atualizar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,saude:'Em risco'})});
    var d=await r.json();
    if(d.ok){t.saude='Em risco';t.atualizadoEm=d.atualizadoEm;t.atualizadoPor=NOME_ATUAL;aplicarFiltros();renderAlertaPessoal();showToast('Marcada como em risco',true);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}
async function concluirRapido(id){
  var t=TAREFAS.find(function(x){return x.id===id;});if(!t)return;
  if(!confirm('Marcar "'+t.titulo+'" como concluída?'))return;
  try{
    var r=await fetch('/api/compasso?action=editar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,status:'Concluído'})});
    var d=await r.json();
    if(d.ok){t.status='Concluído';aplicarFiltros();renderAlertaPessoal();showToast('✅ Tarefa concluída!'+avisoAgenda(d.agenda),true);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

function renderGraficos(lista){
  var atrasadas=0, atencao=0, ok=0;
  var porPessoa={}, porStatus={};
  STATUS_COLS.forEach(function(s){porStatus[s]=0;});
  lista.forEach(function(t){
    var s=slaInfo(t.prazo,t.status);
    if(s){if(s.codigo==='atrasada')atrasadas++;else if(s.codigo==='atencao')atencao++;else if(s.codigo==='ok')ok++;}
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
  renderChips();renderFaixa();
  if(viewAtual==='grafico')renderGraficos(lista);
  if(viewAtual==='backlog')renderBacklog();
  if(viewAtual==='meu')renderMeu();
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

  var atrasadas=[], atencao=[], semAtu=[];
  minhas.forEach(function(t){
    var s=slaInfo(t.prazo,t.status);
    if(s && s.codigo==='atrasada')atrasadas.push(t);
    else if(s && s.codigo==='atencao')atencao.push(t);
    var du=diasDesdeAtualizacao(t);if(du!==null&&du>=7)semAtu.push(t);
  });
  var el=document.getElementById('alerta-pessoal');
  if(!el)return;
  if(!atrasadas.length && !atencao.length && !semAtu.length){el.style.display='none';el.innerHTML='';return;}
  var partes=[];
  if(atrasadas.length)partes.push('<b>'+atrasadas.length+'</b> atrasada'+(atrasadas.length>1?'s':''));
  if(atencao.length)partes.push('<b>'+atencao.length+'</b> vencendo em breve');
  if(semAtu.length)partes.push('<b>'+semAtu.length+'</b> sem atualização há 7+ dias');
  el.className='alerta-banner '+(atrasadas.length?'alerta-atrasada':'alerta-atencao');
  var lista=partes.length>1?partes.slice(0,-1).join(', ')+' e '+partes[partes.length-1]:partes[0];
  el.innerHTML='<span>⚠️ Você tem '+lista+' entre suas tarefas no Compasso.</span><button class="alerta-btn" onclick="focarMinhasTarefas()">Ver tarefas</button>';
  el.style.display='flex';
}
function focarMinhasTarefas(){
  chipAtivo='minhas';
  document.getElementById('f-pessoa').value='';
  mudarView('quadro');
  document.getElementById('board-view').scrollIntoView({behavior:'smooth'});
}

function mudarView(v){
  viewAtual=v;
  ['quadro','meu','grafico','backlog'].forEach(function(k){
    var b=document.getElementById('vb-'+k);if(b)b.classList.toggle('active',v===k);
  });
  document.getElementById('quadro-view').style.display=v==='quadro'?'':'none';
  document.getElementById('meu-view').style.display=v==='meu'?'':'none';
  document.getElementById('grafico-view').style.display=v==='grafico'?'':'none';
  document.getElementById('backlog-view').style.display=v==='backlog'?'':'none';
  document.getElementById('faixa-saude').style.display=v==='quadro'?'':'none';
  document.getElementById('alerta-pessoal').classList.toggle('esconde-meu',v==='meu');
  document.getElementById('chips').style.display=v==='quadro'?'':'none';
  document.getElementById('filtros').style.display=v==='meu'?'none':'';
  aplicarFiltros();
}

function renderBacklog(){
  var concluidas=TAREFAS.filter(function(t){return t.status==='Concluído';});
  var fp=document.getElementById('f-pessoa').value;
  var fpr=document.getElementById('f-prioridade').value;
  if(fp)concluidas=concluidas.filter(function(t){return (t.responsavel||'').split(',').map(function(s){return s.trim();}).indexOf(fp)!==-1;});
  if(fpr)concluidas=concluidas.filter(function(t){return t.prioridade===fpr;});
  var el=document.getElementById('backlog-lista');
  if(!concluidas.length){el.innerHTML='<div class="backlog-empty">Nenhuma tarefa concluída ainda.</div>';return;}
  el.innerHTML=concluidas.map(function(t){
    var resps=(t.responsavel||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var respsHtml=resps.length?resps.map(function(n){return '<span class="card-resp"><span class="avatar-mini">'+esc(iniciais(n))+'</span>'+esc(n.split(' ')[0])+'</span>';}).join(''):'<span class="card-resp" style="color:var(--muted)">Sem responsável</span>';
    return '<div class="backlog-item" onclick="abrirTarefa(\\''+t.id+'\\')">'
      +'<span class="sla-badge sla-concluida">Concluída</span>'
      +'<span class="card-titulo">'+esc(t.titulo)+'</span>'
      +'<span class="card-resps">'+respsHtml+'</span>'
      +(t.prazo?'<span class="card-prazo">📅 '+esc(t.prazo)+'</span>':'')
      +'</div>';
  }).join('');
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
  document.getElementById('modal-tabs').style.display='none';
  trocarAba('det');
  openModal('modal-tarefa');
  setTimeout(function(){document.getElementById('t-titulo').focus();},80);
}

function abrirTarefa(id,aba){
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
  document.getElementById('modal-tabs').style.display='flex';
  document.getElementById('tab-upd-n').textContent='';
  limparComposer();
  ajustarBlocoProgresso(t);
  document.getElementById('upd-form').style.display=IS_VIEW?'none':'';
  document.getElementById('evo-acoes').style.display=IS_VIEW?'none':'';
  document.getElementById('evo-add').style.display=IS_VIEW?'none':'';
  trocarAba(aba==='upd'||aba==='evo'?aba:'det');
  openModal('modal-tarefa');
}

var saudeSel='';
function trocarAba(a){
  ['det','evo','upd'].forEach(function(k){
    document.getElementById('pane-'+k).style.display=a===k?'':'none';
    document.getElementById('tab-'+k).classList.toggle('active',a===k);
  });
  document.getElementById('modal-box').classList.toggle('larga',a!=='det');
  if(a==='upd')carregarAtualizacoes();
  if(a==='evo')carregarEvolucao();
}
function limparComposer(){
  saudeSel='';
  document.getElementById('u-texto').value='';
  document.getElementById('u-progresso').value='';
  document.getElementById('u-prazo').value='';
  document.querySelectorAll('.saude-btn').forEach(function(b){b.classList.remove('on');});
}
function escolherSaude(s){
  saudeSel=(saudeSel===s?'':s);
  document.querySelectorAll('.saude-btn').forEach(function(b){b.classList.toggle('on',b.dataset.s===saudeSel);});
}
function fmtDataHora(iso){var d=new Date(iso);return isNaN(d.getTime())?String(iso||''):d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function fmtDia(s){return String(s||'').split('-').reverse().join('/');}
function atualizarAlertaUpd(t){
  var el=document.getElementById('upd-alerta');
  var d=diasDesdeAtualizacao(t);
  if(d===null){el.style.display='none';return;}
  el.style.display='';
  if(!t.atualizadoEm&&d>=7){el.className='upd-alerta warn';el.textContent='Sem atualização desde a criação ('+d+' dias). Registre em poucas linhas como está o andamento.';}
  else if(d>=7){el.className='upd-alerta warn';el.textContent='Última atualização há '+d+' dias'+(t.atualizadoPor?' (por '+t.atualizadoPor+')':'')+'. Registre como está o andamento.';}
  else if(!t.atualizadoEm){el.className='upd-alerta info';el.textContent='Ainda sem atualização. Vale registrar o andamento.';}
  else{el.className='upd-alerta info';el.textContent='Atualizada '+(d===0?'hoje':'há '+d+(d===1?' dia':' dias'))+(t.atualizadoPor?' por '+t.atualizadoPor:'')+'.';}
}
var ETAPAS=[], EVENTOS=[];
function tarefaAberta(){var id=document.getElementById('t-id').value;return TAREFAS.find(function(x){return x.id===id;});}
function ajustarBlocoProgresso(t){var b=document.getElementById('u-prog-bloco');if(b)b.style.display=(t&&t.etapasTotal>0)?'none':'';}
function contarAtualizacoes(){var n=EVENTOS.filter(function(u){return (u.tipo||'atualizacao')==='atualizacao';}).length;return n?'('+n+')':'';}

function montarTimeline(t,itens){
  var ev=itens.map(function(u){return{ts:u.em,tipo:u.tipo||'atualizacao',u:u};});
  var dp=diasParaClient(t.prazo);
  if(t.status!=='Concluído'&&dp!==null&&dp<0)ev.push({ts:t.prazo+'T23:59:59-03:00',tipo:'venceu'});
  ev.push({ts:criadoEmISO(t),tipo:'criada'});
  ev.sort(function(a,b){return new Date(b.ts)-new Date(a.ts);});
  return ev.map(function(e){
    if(e.tipo==='venceu')return '<div class="tl-item"><span class="tl-dot venceu"></span><div><div class="tl-t" style="color:#dc2626">Prazo venceu</div><div class="tl-m">'+fmtDia(t.prazo)+' · registrado automaticamente</div></div></div>';
    if(e.tipo==='criada')return '<div class="tl-item"><span class="tl-dot"></span><div><div class="tl-t">'+esc(t.criadoPor||'Alguém')+' criou a tarefa</div><div class="tl-m">'+fmtDataHora(e.ts)+'</div></div></div>';
    var u=e.u;
    if(e.tipo==='status')return '<div class="tl-item"><span class="tl-dot status"></span><div><div class="tl-t">'+esc(u.autor)+' mudou o status</div><div class="tl-m">'+fmtDataHora(u.em)+'</div><div class="tl-chips"><span class="saude-chip" style="background:var(--bg);color:var(--text2)">'+esc(u.texto)+'</span></div></div></div>';
    if(e.tipo==='etapa')return '<div class="tl-item"><span class="tl-dot etapa"></span><div><div class="tl-t">'+esc(u.autor)+' '+esc(u.texto)+'</div><div class="tl-m">'+fmtDataHora(u.em)+'</div></div></div>';
    var chips='';
    if(u.saude)chips+='<span class="saude-chip '+(u.saude==='No prazo'?'saude-ok':u.saude==='Em risco'?'saude-risco':'saude-atraso')+'">'+esc(u.saude)+'</span>';
    if(u.progresso!=='')chips+='<span class="saude-chip" style="background:var(--bg);color:var(--text2)">'+esc(u.progresso)+'%</span>';
    if(u.novoPrazo)chips+='<span class="saude-chip" style="background:var(--bg);color:var(--text2)">Novo prazo '+fmtDia(u.novoPrazo)+'</span>';
    return '<div class="tl-item"><span class="tl-dot upd"></span><div><div class="tl-t">'+esc(u.autor)+'</div><div class="tl-m">'+fmtDataHora(u.em)+'</div>'+(chips?'<div class="tl-chips">'+chips+'</div>':'')+(u.texto?'<div class="tl-txt">'+esc(u.texto)+'</div>':'')+'</div></div>';
  }).join('');
}

function montarTrilha(t,eventos){
  var ordem=['A Fazer','Em Andamento','Concluído'];
  var entrada={};
  eventos.filter(function(u){return u.tipo==='status';}).sort(function(a,b){return new Date(a.em)-new Date(b.em);}).forEach(function(u){
    var p=String(u.texto||'').split(' → '),origem=p[0],para=p[1];
    if(origem&&!entrada[origem])entrada[origem]={em:criadoEmISO(t),por:t.criadoPor||''}; // a fase de onde saiu começou na criação
    if(para&&!entrada[para])entrada[para]={em:u.em,por:u.autor};
  });
  var ia=ordem.indexOf(t.status);
  function dias(de,ate){return Math.max(0,Math.floor((ate-new Date(de))/86400000));}
  function txtDias(n){return n===0?'menos de 1 dia':n+(n===1?' dia':' dias');}
  function item(estado,titulo,sub){return '<li class="tr-item '+estado+'"><div class="tr-linha"><span class="tr-bolha">'+(estado==='ok'?'✓':'')+'</span><span class="tr-fio"></span></div><div class="tr-t">'+titulo+'</div><div class="tr-s">'+sub+'</div></li>';}
  var html='<ol class="trilha">'+item('ok','Criada',fmtDia(criadoEmISO(t).slice(0,10))+' · '+esc(t.criadoPor||''));
  ordem.forEach(function(S,i){
    var en=entrada[S];
    if(S===t.status&&S!=='Concluído'){
      var desde=en?en.em:criadoEmISO(t);
      html+=item('agora',esc(S)+' · agora',(en?fmtDia(en.em.slice(0,10))+' · ':'desde a criação · ')+'há '+txtDias(dias(desde,Date.now())));
    }else if(S===t.status||en||i<ia){
      var sub=en?fmtDia(en.em.slice(0,10))+' · '+esc(String(en.por||'').split(' ')[0]):'sem registro';
      if(en){var prox=null;for(var j=i+1;j<ordem.length;j++){if(entrada[ordem[j]]){prox=entrada[ordem[j]].em;break;}}
        if(prox)sub+=' · ficou '+txtDias(dias(en.em,new Date(prox)));}
      html+=item('ok',esc(S),sub);
    }else{
      html+=item('pend',esc(S),S==='Concluído'&&t.prazo?'prazo '+fmtDia(t.prazo):'ainda não iniciou');
    }
  });
  return html+'</ol>';
}

function renderEtapas(t){
  var total=ETAPAS.length,feitas=ETAPAS.filter(function(e){return e.f;}).length;
  document.getElementById('evo-cont').textContent=total?'· '+feitas+' de '+total:'';
  document.getElementById('evo-barra').style.width=(total?Math.round(100*feitas/total):0)+'%';
  var prox=-1;ETAPAS.forEach(function(e,i){if(!e.f&&prox<0)prox=i;});
  var ul=document.getElementById('evo-lista');
  if(!total){ul.innerHTML='<li class="tl-m" style="padding:12px 14px">Nenhuma etapa ainda. Use um modelo, crie a partir da descrição ou adicione abaixo.</li>';}
  else ul.innerHTML=ETAPAS.map(function(e,i){
    return '<li class="etapa'+(e.f?' feita':'')+'"><input type="checkbox" id="et-'+i+'" '+(e.f?'checked ':'')+(IS_VIEW?'disabled ':'')+'onchange="alternarEtapa('+i+',this.checked)"><label for="et-'+i+'">'+esc(e.t)+'</label>'
      +(e.f?'<span class="etapa-meta">'+esc(String(e.p||'').split(' ')[0])+' · '+fmtDia(String(e.f).slice(0,10))+'</span>':(i===prox?'<span class="etapa-prox">próxima</span>':''))
      +(IS_VIEW?'':'<button type="button" class="etapa-x" aria-label="Remover etapa" onclick="removerEtapa('+i+')">×</button>')+'</li>';
  }).join('');
  t.etapasTotal=total;t.etapasFeitas=feitas;t.etapaProx=prox>=0?ETAPAS[prox].t:'';
  ajustarBlocoProgresso(t);
}
function renderEvolucao(){
  var t=tarefaAberta();if(!t)return;
  document.getElementById('evo-trilha').innerHTML=montarTrilha(t,EVENTOS);
  renderEtapas(t);
  document.getElementById('evo-linha').innerHTML=montarTimeline(t,EVENTOS);
  document.getElementById('tab-upd-n').textContent=contarAtualizacoes();
}
async function carregarEvolucao(){
  var t=tarefaAberta();if(!t)return;
  document.getElementById('evo-lista').innerHTML='<li class="tl-m" style="padding:12px 14px">Carregando…</li>';
  try{
    var rs=await Promise.all([fetch('/api/compasso?action=etapas&id='+encodeURIComponent(t.id)),fetch('/api/compasso?action=atualizacoes&id='+encodeURIComponent(t.id))]);
    var e=await rs[0].json(),a=await rs[1].json();
    ETAPAS=e.etapas||[];EVENTOS=a.atualizacoes||[];
  }catch(err){document.getElementById('evo-lista').innerHTML='<li class="tl-m" style="padding:12px 14px">Não foi possível carregar a evolução.</li>';return;}
  renderEvolucao();
}
async function recarregarEventos(t){
  try{var r=await fetch('/api/compasso?action=atualizacoes&id='+encodeURIComponent(t.id));var j=await r.json();EVENTOS=j.atualizacoes||[];}catch(e){}
  renderEvolucao();
}
async function chamarEtapas(corpo){
  var t=tarefaAberta();if(!t)return null;
  corpo.id=t.id;
  try{
    var r=await fetch('/api/compasso?action=etapas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)});
    var d=await r.json();
    if(!d.ok){showToast('Erro: '+(d.error||'?'),false);return null;}
    ETAPAS=d.etapas||[];
    if(d.progresso!==undefined&&d.progresso!==null)t.progresso=String(d.progresso);
    if(d.atualizadoEm){t.atualizadoEm=d.atualizadoEm;t.atualizadoPor=NOME_ATUAL;}
    return d;
  }catch(e){showToast('Erro de conexão',false);return null;}
}
function titulosAtuais(){return ETAPAS.map(function(e){return e.t;});}
async function salvarTitulos(titulos){
  var d=await chamarEtapas({op:'definir',titulos:titulos});
  var t=tarefaAberta();
  if(d){renderEtapas(t);aplicarFiltros();renderAlertaPessoal();}
  return d;
}
async function addEtapa(){
  var el=document.getElementById('evo-novo');var v=el.value.trim();if(!v)return;
  var d=await salvarTitulos(titulosAtuais().concat([v]));
  if(d)el.value='';
}
function teclaEtapa(ev){if(ev.key==='Enter'){ev.preventDefault();addEtapa();}}
async function removerEtapa(i){
  var e=ETAPAS[i];
  if(e&&e.f&&!confirm('Essa etapa já foi concluída. Remover mesmo assim?'))return;
  var t=titulosAtuais();t.splice(i,1);
  await salvarTitulos(t);
}
async function usarModelo(){
  var sel=document.getElementById('evo-modelo');var m=sel.value;sel.value='';
  if(!m||!MODELOS[m])return;
  if(ETAPAS.length&&!confirm('Substituir as etapas atuais pelas do modelo "'+m+'"? As já concluídas com o mesmo nome são mantidas.'))return;
  await salvarTitulos(MODELOS[m]);
}
async function etapasDaDescricao(){
  var t=tarefaAberta();if(!t)return;
  var linhas=String(t.descricao||'').split(/\\r?\\n/).map(function(x){return x.replace(/^[-•*\\d.)\\s]+/,'').trim();}).filter(Boolean);
  if(!linhas.length){showToast('A descrição não tem linhas para virar etapas',false);return;}
  if(ETAPAS.length&&!confirm('Substituir as etapas atuais pelas '+linhas.length+' linhas da descrição?'))return;
  await salvarTitulos(linhas);
}
async function alternarEtapa(i,feito){
  var t=tarefaAberta();
  var d=await chamarEtapas({op:'alternar',i:i,feito:feito});
  if(!d){renderEtapas(t);return;}
  renderEtapas(t);aplicarFiltros();renderAlertaPessoal();
  await recarregarEventos(t);
  var total=ETAPAS.length,feitas=ETAPAS.filter(function(e){return e.f;}).length;
  if(feito&&total&&feitas===total&&t.status!=='Concluído'&&confirm('Todas as etapas foram concluídas. Marcar a tarefa como Concluída?')){
    try{
      var r=await fetch('/api/compasso?action=editar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:t.id,status:'Concluído'})});
      var j=await r.json();
      if(j.ok){t.status='Concluído';aplicarFiltros();renderAlertaPessoal();showToast('✅ Tarefa concluída!'+avisoAgenda(j.agenda),true);closeModal('modal-tarefa');}
      else showToast('Erro: '+(j.error||'?'),false);
    }catch(e){showToast('Erro de conexão',false);}
  }
}

async function carregarAtualizacoes(){
  var t=tarefaAberta();if(!t)return;
  atualizarAlertaUpd(t);ajustarBlocoProgresso(t);
  var lista=document.getElementById('upd-lista');
  lista.innerHTML='<div class="tl-m">Carregando…</div>';
  try{var r=await fetch('/api/compasso?action=atualizacoes&id='+encodeURIComponent(t.id));var d=await r.json();EVENTOS=d.atualizacoes||[];}
  catch(e){lista.innerHTML='<div class="tl-m">Não foi possível carregar as atualizações.</div>';return;}
  document.getElementById('tab-upd-n').textContent=contarAtualizacoes();
  lista.innerHTML=montarTimeline(t,EVENTOS);
}
async function publicarAtualizacao(){
  var id=document.getElementById('t-id').value;
  var texto=document.getElementById('u-texto').value.trim();
  var prog=document.getElementById('u-progresso').value;
  var novoPrazo=document.getElementById('u-prazo').value;
  if(!texto&&!saudeSel&&prog===''&&!novoPrazo){showToast('Escreva a atualização ou informe saúde, progresso ou novo prazo',false);return;}
  var btn=document.getElementById('u-btn');btn.disabled=true;
  try{
    var r=await fetch('/api/compasso?action=atualizar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,texto:texto,saude:saudeSel,progresso:prog,novoPrazo:novoPrazo})});
    var d=await r.json();
    if(d.ok){
      var t=TAREFAS.find(function(x){return x.id===id;});
      if(t){t.atualizadoEm=d.atualizadoEm;t.atualizadoPor=NOME_ATUAL;if(saudeSel)t.saude=saudeSel;if(prog!=='')t.progresso=prog;if(novoPrazo)t.prazo=novoPrazo;}
      limparComposer();
      aplicarFiltros();renderAlertaPessoal();carregarAtualizacoes();
      var aviso=avisoAgenda(d.agenda);
      showToast('✅ Atualização publicada!'+aviso,!aviso,aviso?6000:2600);
    }else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
  finally{btn.disabled=false;}
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
    if(d.ok){var aviso=avisoAgenda(d.agenda);showToast((id?'✅ Tarefa atualizada!':'✅ Tarefa criada!')+aviso,!aviso,aviso?6000:2600);setTimeout(function(){location.reload();},aviso?6200:700);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

var ROTULO_AGENDA={sem_autorizacao:'ainda não autorizou a agenda',token_invalido:'precisa autorizar a agenda de novo',erro:'falha ao gravar na agenda'};
function avisoAgenda(lista){
  var ruins=(lista||[]).filter(function(a){return ROTULO_AGENDA[a.estado];});
  if(!ruins.length)return '';
  return ' ⚠ Fora da agenda: '+ruins.map(function(a){return a.nome.split(' ')[0]+' ('+ROTULO_AGENDA[a.estado]+')';}).join('; ')+'.';
}
async function conferirAgenda(){
  showToast('Conferindo a agenda de todos…',true,60000);
  try{
    var r=await fetch('/api/compasso?action=sincronizar-agenda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({simular:true})});
    var d=await r.json();
    if(!d.ok){showToast('Erro: '+(d.error||'?'),false);return;}
    var rs=d.resumo,linhas=['Simulação (nada foi alterado ainda):','• '+rs.criado+' evento(s) a criar, '+rs.atualizado+' a atualizar, '+rs.removido+' a remover, '+rs.semMudanca+' já corretos.'];
    if(rs.semAutorizacao.length)linhas.push('• Ainda não autorizaram a agenda: '+rs.semAutorizacao.join(', '));
    if(rs.acessoRecusado.length)linhas.push('• Precisam autorizar de novo: '+rs.acessoRecusado.join(', '));
    if(rs.comErro.length)linhas.push('• Com erro: '+rs.comErro.join(', '));
    if(!(rs.criado+rs.atualizado+rs.removido)){alert(linhas.join('\\n'));showToast('Agenda já está em dia',true);return;}
    if(!confirm(linhas.join('\\n')+'\\n\\nAplicar agora nas agendas?')){showToast('Nada foi alterado',true);return;}
    showToast('Atualizando as agendas…',true,60000);
    var r2=await fetch('/api/compasso?action=sincronizar-agenda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({simular:false})});
    var d2=await r2.json();
    if(!d2.ok){showToast('Erro: '+(d2.error||'?'),false);return;}
    var x=d2.resumo;showToast('📅 Agenda atualizada: '+x.criado+' criado(s), '+x.atualizado+' atualizado(s), '+x.removido+' removido(s).',true,6000);
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
inicializarAtalhos();
aplicarFiltros();
renderAlertaPessoal();
function inicializarAtalhos(){
  document.addEventListener('keydown',function(e){
    if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();mudarView('quadro');var b=document.getElementById('f-busca');b.focus();b.select();}
  });
  document.getElementById('board-view').addEventListener('keydown',function(e){
    if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('nc'))e.target.click();
  });
}
</script>
</body></html>`;
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  let isGestor = false;
  let isView = false;
  let equipeAtivos = [];
  try {
    const eq = await getSheet('Equipe!A2:N200');
    const u = eq.find(r => r[0] === session.nome);
    isGestor = u?.[8] === 'gestor' && (u?.[10] || 'ativo') === 'ativo';
    isView = u?.[8] === 'view';
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
        const tarefaObj = { id, titulo: body.titulo.trim(), descricao: body.descricao || '', status: body.status || 'A Fazer', prioridade: body.prioridade || 'Baixa', prazo: body.prazo || '' };
        const respList = (body.responsavel || '').split(',').map(s => s.trim()).filter(Boolean);
        const agenda = await Promise.all(respList.map(p => sincronizarTarefaCompasso(p, id, tarefaObj)));
        return res.status(200).json({ ok: true, id, agenda });
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
        if (atual[4] && novaLinha[4] && atual[4] !== novaLinha[4]) {
          try { await registrarEvento(body.id, session.nome, 'status', atual[4] + ' → ' + novaLinha[4]); }
          catch (e) { console.error('compasso: não registrou a mudança de status', e.message); }
        }
        const respAntigos = (atual[3] || '').split(',').map(s => s.trim()).filter(Boolean);
        const respNovos = (novaLinha[3] || '').split(',').map(s => s.trim()).filter(Boolean);
        const tarefaObj = { id: body.id, titulo: novaLinha[1], descricao: novaLinha[2], status: novaLinha[4], prioridade: novaLinha[5], prazo: novaLinha[8] };
        const todosEnvolvidos = Array.from(new Set([...respAntigos, ...respNovos]));
        const agenda = await Promise.all(todosEnvolvidos.map(p => sincronizarTarefaCompasso(p, body.id, respNovos.includes(p) ? tarefaObj : null)));
        return res.status(200).json({ ok: true, agenda });
      }

      if (action === 'excluir') {
        if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
        const rows = await getSheet(RANGE);
        const idx = rows.findIndex(r => r[0] === body.id);
        if (idx < 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
        const criadoPor = rows[idx][6] || '';
        if (!isGestor && criadoPor !== session.nome) return res.status(403).json({ error: 'Só quem criou ou o gestor pode excluir' });
        const respAntigos = (rows[idx][3] || '').split(',').map(s => s.trim()).filter(Boolean);
        const meta = await sheetsRequest(SHEET_ID, '');
        const sheet = meta.sheets?.find(s => s.properties.title === 'Compasso');
        if (!sheet) return res.status(500).json({ error: 'Aba não encontrada' });
        await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
          requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: idx + 1, endIndex: idx + 2 } } }]
        });
        const agenda = await Promise.all(respAntigos.map(p => sincronizarTarefaCompasso(p, body.id, null)));
        return res.status(200).json({ ok: true, agenda });
      }

      if (action === 'etapas') {
        if (isView) return res.status(403).json({ error: 'Conta somente leitura não edita etapas' });
        if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
        if (body.op !== 'definir' && body.op !== 'alternar') return res.status(400).json({ error: 'Operação inválida' });
        const rows = await getSheet(RANGE);
        const idx = rows.findIndex(r => r[0] === body.id);
        if (idx < 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
        await garantirAbaEtapas();
        const linhasE = await getSheet(ABA_ETAPAS + '!A2:D500');
        const li = linhasE.findIndex(r => r[0] === body.id);
        let lista = li >= 0 ? parseEtapas(linhasE[li][1]) : [];
        const agoraISO = new Date().toISOString();
        let evento = '';
        if (body.op === 'definir') {
          const novos = (Array.isArray(body.titulos) ? body.titulos : []).map(x => String(x || '').trim().slice(0, 120)).filter(Boolean).slice(0, MAX_ETAPAS);
          // o que já foi feito fica feito: casa pelo título, sem diferenciar maiúscula de minúscula
          const antigos = new Map(lista.map(e => [e.t.toLowerCase(), e]));
          lista = novos.map(t => { const v = antigos.get(t.toLowerCase()); return v ? { t, f: v.f, p: v.p } : { t, f: '', p: '' }; });
        } else {
          const i = Number(body.i);
          if (!Number.isInteger(i) || i < 0 || i >= lista.length) return res.status(400).json({ error: 'Etapa inválida' });
          const feito = body.feito === true;
          lista[i] = feito ? { ...lista[i], f: agoraISO, p: session.nome } : { ...lista[i], f: '', p: '' };
          evento = (feito ? 'concluiu a etapa: ' : 'reabriu a etapa: ') + lista[i].t;
        }
        const resumo = resumoEtapas(lista);
        const nE = li >= 0 ? li + 2 : 2 + linhasE.length;
        await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA_ETAPAS}!A${nE}:D${nE}`)}?valueInputOption=RAW`, 'PUT', {
          values: [[body.id, JSON.stringify(lista), agoraISO, session.nome]],
        });
        const linha = idx + 2;
        const progresso = resumo.total ? Math.round(100 * resumo.feitas / resumo.total) : null;
        if (progresso !== null) {
          await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`Compasso!M${linha}`)}?valueInputOption=RAW`, 'PUT', { values: [[progresso]] });
        }
        let atualizadoEm;
        if (body.op === 'alternar') { // marcar etapa conta como atualização da tarefa
          atualizadoEm = agoraISO;
          await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`Compasso!J${linha}:K${linha}`)}?valueInputOption=RAW`, 'PUT', { values: [[agoraISO, session.nome]] });
          try { await registrarEvento(body.id, session.nome, 'etapa', evento); }
          catch (e) { console.error('compasso: não registrou a etapa no histórico', e.message); }
        }
        return res.status(200).json({ ok: true, etapas: lista, resumo, progresso, atualizadoEm });
      }

      if (action === 'atualizar') {
        if (isView) return res.status(403).json({ error: 'Conta somente leitura não registra atualizações' });
        if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
        const texto = String(body.texto || '').trim().slice(0, 1000);
        const saude = SAUDES.includes(body.saude) ? body.saude : '';
        const pr = body.progresso === undefined || body.progresso === null || body.progresso === '' ? NaN : Number(body.progresso);
        const progressoBruto = Number.isFinite(pr) ? Math.max(0, Math.min(100, Math.round(pr))) : null;
        const novoPrazo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.novoPrazo || '')) ? String(body.novoPrazo) : '';
        const rows = await getSheet(RANGE);
        const idx = rows.findIndex(r => r[0] === body.id);
        if (idx < 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
        // com etapas, o progresso vem só delas: o percentual manual é ignorado
        const temEtapas = parseEtapas(((await getSheet(ABA_ETAPAS + '!A2:D500')).find(r => r[0] === body.id) || [])[1]).length > 0;
        const progresso = temEtapas ? null : progressoBruto;
        if (!texto && !saude && progresso === null && !novoPrazo) return res.status(400).json({ error: 'Escreva a atualização ou informe saúde, progresso ou novo prazo' });
        await garantirAbaAtualizacoes();
        const existentes = await getSheet(ABA_ATUALIZ + '!A2:A5000');
        const n = 2 + existentes.length;
        const agoraISO = new Date().toISOString();
        await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA_ATUALIZ}!A${n}:H${n}`)}?valueInputOption=RAW`, 'PUT', {
          values: [[body.id, agoraISO, session.nome, texto, saude, progresso === null ? '' : progresso, novoPrazo, 'atualizacao']],
        });
        const linha = idx + 2, atual = rows[idx];
        await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`Compasso!J${linha}:M${linha}`)}?valueInputOption=RAW`, 'PUT', {
          values: [[agoraISO, session.nome, saude || atual[11] || '', progresso === null ? (atual[12] || '') : progresso]],
        });
        let agenda = [];
        if (novoPrazo) {
          await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`Compasso!I${linha}`)}?valueInputOption=USER_ENTERED`, 'PUT', { values: [[novoPrazo]] });
          const tarefaObj = { id: body.id, titulo: atual[1] || '', descricao: atual[2] || '', status: atual[4] || '', prioridade: atual[5] || '', prazo: novoPrazo };
          const resp = (atual[3] || '').split(',').map(x => x.trim()).filter(Boolean);
          agenda = await Promise.all(resp.map(p => sincronizarTarefaCompasso(p, body.id, tarefaObj)));
        }
        return res.status(200).json({ ok: true, atualizadoEm: agoraISO, agenda });
      }

      if (action === 'sincronizar-agenda') {
        if (!isGestor) return res.status(403).json({ error: 'Só o gestor pode sincronizar a agenda de todos' });
        const relatorio = await reconciliarAgendaCompasso({ simular: body.simular === true });
        return res.status(200).json({ ok: true, ...relatorio });
      }

      return res.status(400).json({ error: 'Ação inválida' });
    } catch (err) {
      console.error('compasso POST ERRO:', err.message);
      return res.status(500).json({ error: 'Erro ao processar', detail: err.message });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  if (req.query.action === 'etapas') {
    const id = String(req.query.id || '');
    const linhasE = await getSheet(ABA_ETAPAS + '!A2:D500'); // aba ainda não existe? getSheet devolve []
    const lista = parseEtapas((linhasE.find(r => r[0] === id) || [])[1]);
    return res.status(200).json({ ok: true, etapas: lista, resumo: resumoEtapas(lista) });
  }

  if (req.query.action === 'atualizacoes') {
    const id = String(req.query.id || '');
    const linhas = await getSheet(ABA_ATUALIZ + '!A2:H5000'); // aba ainda não existe? getSheet devolve []
    // mais nova primeiro; se duas caírem no mesmo instante, vale a ordem da linha na planilha (a de baixo é a mais nova)
    const atualizacoes = linhas.map((r, i) => ({ r, i })).filter(({ r }) => r[0] === id)
      .map(({ r, i }) => ({ em: r[1] || '', autor: r[2] || '', texto: r[3] || '', saude: r[4] || '', progresso: r[5] === undefined ? '' : String(r[5]), novoPrazo: r[6] || '', tipo: r[7] || 'atualizacao', _i: i }))
      .sort((a, b) => String(b.em).localeCompare(String(a.em)) || b._i - a._i)
      .slice(0, 100)
      .map(({ _i, ...resto }) => resto);
    return res.status(200).json({ ok: true, atualizacoes });
  }

  try {
    await garantirAba();
    const rows = await getSheet(RANGE);
    const tarefas = rows.filter(r => r[0]).map(r => ({
      id: r[0], titulo: r[1] || '', descricao: r[2] || '', responsavel: r[3] || '',
      status: r[4] || 'A Fazer', prioridade: r[5] || 'Baixa', criadoPor: r[6] || '', criadoEm: r[7] || '', prazo: r[8] || '',
      atualizadoEm: r[9] || '', atualizadoPor: r[10] || '', saude: r[11] || '', progresso: r[12] === undefined ? '' : String(r[12]),
    }));
    const mapaEtapas = new Map((await getSheet(ABA_ETAPAS + '!A2:D500')).filter(r => r[0]).map(r => [r[0], resumoEtapas(parseEtapas(r[1]))]));
    tarefas.forEach(t => { const e = mapaEtapas.get(t.id); t.etapasTotal = e ? e.total : 0; t.etapasFeitas = e ? e.feitas : 0; t.etapaProx = e ? e.prox : ''; });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(renderPage({ nome: session.nome, isGestor, isView, tarefas, equipeAtivos }));
  } catch (err) {
    console.error('compasso GET ERRO:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar', detail: err.message });
  }
}
