// api/chamados.js — Abertura e gestão de chamados de equipamento (defeito, manutenção,
// perda/extravio, dano). Acessível a gestor e colaborador; ações de gestão são gestor-only.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function parseCookies(cookieHeader) {
  const cookies = {};
  (cookieHeader||'').split(';').forEach(c => {
    const cookieParts = c.trim().split('=');
    const k = cookieParts.shift();
    cookies[k] = cookieParts.join('=');
  });
  return cookies;
}
function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
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
async function setSheet(range, values) {
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', { values });
}
async function proximaLinhaLivre(sheetName) {
  const atual = await getSheet(`${sheetName}!A2:A5000`);
  return atual.length + 2;
}
async function inserirLinhas(sheetName, colUltima, linhas, linhaInicial) {
  const fim = linhaInicial + linhas.length - 1;
  await setSheet(`${sheetName}!A${linhaInicial}:${colUltima}${fim}`, linhas);
}
function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtTimestamp(d) {
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const TIPOS_PROBLEMA = ['Defeito', 'Manutenção preventiva', 'Perda/Extravio', 'Dano', 'Outro'];
const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'];
const STATUS_CHAMADO = ['Aberto', 'Em andamento', 'Aguardando peça', 'Resolvido', 'Cancelado'];
const STATUS_FECHADO = ['Resolvido', 'Cancelado'];

async function registrarMovimentacaoEquipamento({ id, equipamento, de, para, responsavel, observacao, tipo }) {
  const linha = await proximaLinhaLivre('MovimentacoesEquipamento');
  await inserirLinhas('MovimentacoesEquipamento', 'H', [[
    fmtTimestamp(getBRT()), id, equipamento, de || '—', para || '—', responsavel, observacao || '', tipo
  ]], linha);
}

async function garantirAbaChamados() {
  const spreadsheet = await sheetsRequest(SHEET_ID, '');
  const sheets = spreadsheet.sheets || [];
  const temChamados = sheets.some(s => s.properties.title === 'Chamados');
  if (!temChamados) {
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: 'Chamados', gridProperties: { rowCount: 2000, columnCount: 12 } } } }]
    });
    await setSheet('Chamados!A1:L1', [[
      'ID', 'ID Equipamento', 'Equipamento', 'Tipo de Problema', 'Prioridade', 'Descrição',
      'Status', 'Aberto Por', 'Data Abertura', 'Responsável pelo Reparo', 'Data Última Atualização', 'Solução'
    ]]);
  }
}

function proximoChamadoId(chamadosRaw) {
  let max = 0;
  for (const r of chamadosRaw) {
    const m = String(r[0]||'').match(/^CHM-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'CHM-' + String(max + 1).padStart(4, '0');
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.method === 'GET') return res.redirect(302, '/api/app');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const equipeRaw = await getSheet('Equipe!A2:L200');
  const usuario = equipeRaw.find(r => r[0] === session.nome);
  if (!usuario || (usuario[10]||'ativo') !== 'ativo') {
    if (req.method === 'GET') return res.redirect(302, '/api/app');
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const isGestor = usuario[8] === 'gestor';

  await garantirAbaChamados();

  if (req.method === 'GET') {
    const [chamadosRaw, equipamentosRaw] = await Promise.all([
      getSheet('Chamados!A2:L2000'),
      getSheet('Equipamentos!A2:O3000'),
    ]);
    return renderChamados(res, session, isGestor, chamadosRaw, equipamentosRaw);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { action } = req.body || {};

  if (action === 'abrir') {
    const { idEquipamento, tipoProblema, prioridade, descricao } = req.body || {};
    if (!idEquipamento?.trim()) return res.status(400).json({ error: 'Selecione um equipamento' });
    if (!TIPOS_PROBLEMA.includes(tipoProblema)) return res.status(400).json({ error: 'Tipo de problema inválido' });
    if (!PRIORIDADES.includes(prioridade)) return res.status(400).json({ error: 'Prioridade inválida' });
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descreva o problema' });

    const equipamentosRaw = await getSheet('Equipamentos!A2:O3000');
    const idxEquip = equipamentosRaw.findIndex(r => r[0] === idEquipamento.trim());
    if (idxEquip < 0) return res.status(404).json({ error: 'Equipamento não encontrado' });
    const equipRow = equipamentosRaw[idxEquip];
    const nomeEquip = equipRow[2] || '';
    const statusAnterior = equipRow[5] || 'Operacional';
    const linhaEquip = idxEquip + 2;

    const chamadosRaw = await getSheet('Chamados!A2:L2000');
    const id = proximoChamadoId(chamadosRaw);
    const agora = fmtTimestamp(getBRT());
    const linha = await proximaLinhaLivre('Chamados');
    await inserirLinhas('Chamados', 'L', [[
      id, idEquipamento.trim(), nomeEquip, tipoProblema, prioridade, descricao.trim(),
      'Aberto', session.nome, agora, '', agora, ''
    ]], linha);

    await setSheet(`Equipamentos!F${linhaEquip}:H${linhaEquip}`, [['Em manutenção', equipRow[6]||'', agora]]);
    await registrarMovimentacaoEquipamento({
      id: idEquipamento.trim(), equipamento: nomeEquip, de: statusAnterior, para: 'Em manutenção',
      responsavel: session.nome, observacao: `Chamado ${id} aberto: ${tipoProblema} — ${descricao.trim()}`, tipo: 'status'
    });

    return res.status(200).json({ ok: true, id, msg: `Chamado ${id} aberto para ${nomeEquip}` });
  }

  if (action === 'atualizar') {
    if (!isGestor) return res.status(403).json({ error: 'Apenas gestores podem gerenciar chamados' });
    const { id, novoStatus, responsavel, solucao } = req.body || {};
    if (!STATUS_CHAMADO.includes(novoStatus)) return res.status(400).json({ error: 'Status inválido' });

    const chamadosRaw = await getSheet('Chamados!A2:L2000');
    const idx = chamadosRaw.findIndex(r => r[0] === id);
    if (idx < 0) return res.status(404).json({ error: 'Chamado não encontrado' });
    const row = chamadosRaw[idx];
    const linha = idx + 2;
    const agora = fmtTimestamp(getBRT());

    await setSheet(`Chamados!G${linha}:L${linha}`, [[
      novoStatus, row[7]||'', row[8]||'', responsavel||row[9]||'', agora, solucao||row[11]||''
    ]]);

    if (STATUS_FECHADO.includes(novoStatus)) {
      const equipamentosRaw = await getSheet('Equipamentos!A2:O3000');
      const idxEquip = equipamentosRaw.findIndex(r => r[0] === row[1]);
      if (idxEquip >= 0) {
        const equipRow = equipamentosRaw[idxEquip];
        const linhaEquip = idxEquip + 2;
        if (equipRow[5] === 'Em manutenção') {
          await setSheet(`Equipamentos!F${linhaEquip}:H${linhaEquip}`, [['Operacional', equipRow[6]||'', agora]]);
          await registrarMovimentacaoEquipamento({
            id: row[1], equipamento: row[2], de: 'Em manutenção', para: 'Operacional',
            responsavel: session.nome, observacao: `Chamado ${id} ${novoStatus.toLowerCase()}`, tipo: 'status'
          });
        }
      }
    }

    return res.status(200).json({ ok: true, msg: `Chamado ${id} atualizado` });
  }

  return res.status(400).json({ error: 'Ação desconhecida' });
}

// ── Renderização ──────────────────────────────────────────────────────────

function shellCSS() {
  return `
:root{
  --bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;
  --text:#1a1a1a;--text2:#555;--text3:#888;--text4:#bbb;
  --header:#161920;--blue:#1d4ed8;
  --blue-m-bg:#eff6ff;--blue-m-v:#1d4ed8;
  --badge-green-bg:#dcfce7;--badge-green-c:#166534;
  --badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
  --badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
  --badge-gray-bg:#eef0f2;--badge-gray-c:#555;
  --shadow-sm:0 1px 2px rgba(20,20,20,.05);
  --shadow:0 1px 2px rgba(20,20,20,.04), 0 6px 16px -8px rgba(20,20,20,.10);
}
html.dark{
  --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
  --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
  --header:#0f1117;--blue:#63b3ed;
  --blue-m-bg:#1a2744;--blue-m-v:#63b3ed;
  --badge-green-bg:#0d2010;--badge-green-c:#68d391;
  --badge-red-bg:#1f1010;--badge-red-c:#fc8181;
  --badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
  --badge-gray-bg:#2d3140;--badge-gray-c:#a0aec0;
  --shadow-sm:0 1px 2px rgba(0,0,0,.35);
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 6px 18px -8px rgba(0,0,0,.5);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.ht{font-size:14px;font-weight:700;color:#fff}
.hs{font-size:11px;color:#666}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer;text-decoration:none}
.btn-sm:hover{border-color:#6b7280;color:#e2e8f0}
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:var(--text);text-decoration:none;white-space:nowrap}
.menu-item:hover{background:var(--bg3)}
.wrap{max-width:1300px;margin:0 auto;padding:16px 20px}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600;white-space:nowrap}
.badge.green{background:var(--badge-green-bg);color:var(--badge-green-c)}
.badge.red{background:var(--badge-red-bg);color:var(--badge-red-c)}
.badge.amber{background:var(--badge-amber-bg);color:var(--badge-amber-c)}
.badge.blue{background:var(--blue-m-bg);color:var(--blue-m-v)}
.badge.gray{background:var(--badge-gray-bg);color:var(--badge-gray-c)}
.badge.urgente{animation:pulsar 1.2s ease-in-out infinite}
@keyframes pulsar{0%,100%{opacity:1}50%{opacity:.55}}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:12px}
.stat .ic{font-size:20px;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--bg3)}
.stat .n{font-size:24px;font-weight:800;line-height:1}
.stat .l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:3px;font-weight:600}
.toolbar{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;box-shadow:var(--shadow-sm)}
.toolbar input,.toolbar select{border:1px solid var(--border);border-radius:7px;padding:8px 11px;font-size:12px;background:var(--bg2);color:var(--text);outline:none}
.btn{border:1px solid var(--border);border-radius:7px;padding:8px 13px;font-size:12px;background:var(--card);color:var(--text);cursor:pointer;transition:background .15s}
.btn:hover{background:var(--bg3)}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}
.tbl-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-x:auto;box-shadow:var(--shadow-sm)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:11px 12px;color:var(--text3);text-transform:uppercase;font-size:10px;letter-spacing:.04em;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--bg2)}
td{padding:10px 12px;border-bottom:1px solid var(--border2);vertical-align:middle}
tbody tr:hover{background:var(--bg2)}
tr:last-child td{border-bottom:none}
.desc-cell{max-width:220px;white-space:normal}
.acoes button{border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;background:var(--bg2);color:var(--text);cursor:pointer}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border-radius:14px;padding:22px;width:420px;max-width:calc(100vw - 32px);max-height:85vh;overflow-y:auto;box-shadow:var(--shadow)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px}
.field{margin-bottom:10px}
.field label{display:block;font-size:11px;font-weight:600;color:var(--text3);margin-bottom:4px;text-transform:uppercase}
.field input,.field select,.field textarea{width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;background:var(--bg2);color:var(--text);outline:none}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
`;
}

function menuHTML(isGestor) {
  const itensGestor = isGestor ? `
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausências</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
        <a href="/api/equipamentos" class="menu-item">&#128230; Equipamentos</a>
  ` : '';
  return `
    <button id="tt" class="btn-sm" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Início</a>${itensGestor}
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/chamados" class="menu-item">&#127915; Chamados</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>`;
}

function headerHTML(nome, isGestor, sub) {
  return `
<div class="header">
  <div class="logo">P</div>
  <div>
    <div class="ht">Chamados</div>
    <div class="hs">${esc(sub)}</div>
  </div>
  <div class="hr">${menuHTML(isGestor)}</div>
</div>`;
}

function baseHTML(titulo, conteudo, scriptExtra = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - ${esc(titulo)}</title>
<style>${shellCSS()}</style>
</head>
<body>
${conteudo}
<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
${scriptExtra}
</script>
</body>
</html>`;
}

function renderChamados(res, session, isGestor, chamadosRaw, equipamentosRaw) {
  const chamados = chamadosRaw.filter(r => r[0]).map(r => ({
    id: r[0], idEquipamento: r[1]||'', equipamento: r[2]||'', tipoProblema: r[3]||'', prioridade: r[4]||'Baixa',
    descricao: r[5]||'', status: r[6]||'Aberto', abertoPor: r[7]||'', dataAbertura: r[8]||'',
    responsavel: r[9]||'', dataAtualizacao: r[10]||'', solucao: r[11]||''
  })).reverse();

  const equipamentosOpcoes = equipamentosRaw.filter(r => r[0]).map(r => ({ id: r[0], nome: r[2]||'', alocacao: r[6]||'' }));

  const abertos = chamados.filter(c => c.status === 'Aberto').length;
  const andamento = chamados.filter(c => c.status === 'Em andamento' || c.status === 'Aguardando peça').length;
  const urgentes = chamados.filter(c => c.prioridade === 'Urgente' && !STATUS_FECHADO.includes(c.status)).length;
  const resolvidos = chamados.filter(c => c.status === 'Resolvido').length;

  const kpiHTML = [
    `<div class="stat"><div class="ic" style="background:var(--blue-m-bg)">🎫</div><div><div class="n">${abertos}</div><div class="l">Abertos</div></div></div>`,
    `<div class="stat"><div class="ic" style="background:var(--badge-amber-bg)">🔧</div><div><div class="n" style="color:var(--badge-amber-c)">${andamento}</div><div class="l">Em andamento</div></div></div>`,
    `<div class="stat"><div class="ic" style="background:var(--badge-red-bg)">🔥</div><div><div class="n" style="color:var(--badge-red-c)">${urgentes}</div><div class="l">Urgentes em aberto</div></div></div>`,
    `<div class="stat"><div class="ic" style="background:var(--badge-green-bg)">✅</div><div><div class="n" style="color:var(--badge-green-c)">${resolvidos}</div><div class="l">Resolvidos</div></div></div>`,
  ].join('');

  const conteudo = `
${headerHTML(session.nome, isGestor, `${chamados.length} chamados registrados`)}
<div class="wrap">
  <div class="summary">${kpiHTML}</div>

  <div class="toolbar">
    <input id="busca" placeholder="🔍 Buscar por equipamento, tipo ou descrição..." style="flex:1;min-width:220px" oninput="filtrar()">
    <select id="f-status" onchange="filtrar()"><option value="">Todo status</option>${STATUS_CHAMADO.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
    <select id="f-prioridade" onchange="filtrar()"><option value="">Toda prioridade</option>${PRIORIDADES.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
    <button class="btn primary" onclick="abrirNovoChamado()">+ Abrir chamado</button>
  </div>

  <div class="tbl-wrap">
    <table id="tabela">
      <thead><tr>
        <th>ID</th><th>Equipamento</th><th>Tipo</th><th>Prioridade</th><th>Status</th>
        <th>Descrição</th><th>Aberto por</th><th>Quando</th><th>Responsável</th>${isGestor?'<th>Ações</th>':''}
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</div>

<div class="modal-bg" id="modal-abrir"><div class="modal">
  <h3>Abrir chamado</h3>
  <div class="field"><label>Equipamento</label><input id="c-equip-busca" list="lista-equip" placeholder="Digite o ID ou nome..." oninput="selecionarEquip()"></div>
  <datalist id="lista-equip">${equipamentosOpcoes.map(e=>`<option value="${esc(e.id)} — ${esc(e.nome)} (${esc(e.alocacao)})">`).join('')}</datalist>
  <div class="field"><label>Tipo de problema</label><select id="c-tipo">${TIPOS_PROBLEMA.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
  <div class="field"><label>Prioridade</label><select id="c-prioridade">${PRIORIDADES.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
  <div class="field"><label>Descrição do problema</label><textarea id="c-descricao" rows="3"></textarea></div>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarAbrir()">Abrir chamado</button></div>
</div></div>

<div class="modal-bg" id="modal-gerenciar"><div class="modal">
  <h3>Gerenciar chamado</h3>
  <div class="field"><label>Status</label><select id="g-status">${STATUS_CHAMADO.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
  <div class="field"><label>Responsável pelo reparo</label><input id="g-responsavel"></div>
  <div class="field"><label>Solução / observação</label><textarea id="g-solucao" rows="3"></textarea></div>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarGerenciar()">Salvar</button></div>
</div></div>
`;

  const script = `
const CHAMADOS = ${JSON.stringify(chamados)};
const EQUIP_MAP = ${JSON.stringify(Object.fromEntries(equipamentosOpcoes.map(e => [e.id, e.nome])))};
const IS_GESTOR = ${isGestor ? 'true' : 'false'};
let idAtual = null;
let equipSelecionado = '';

function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function prioCls(p){ return p==='Baixa'?'blue':p==='Média'?'amber':'red'; }
function statusCls(s){ return s==='Aberto'?'blue':s==='Resolvido'?'green':s==='Cancelado'?'gray':'amber'; }

function linhaHTML(c){
  var prioBadge = '<span class="badge '+prioCls(c.prioridade)+(c.prioridade==='Urgente'?' urgente':'')+'">'+escHtml(c.prioridade)+'</span>';
  var acoes = IS_GESTOR ? ('<td class="acoes"><button onclick="abrirGerenciar(\\''+c.id+'\\')">Gerenciar</button></td>') : '';
  return '<tr>'
    + '<td>'+escHtml(c.id)+'</td>'
    + '<td>'+escHtml(c.equipamento)+' <span style="color:var(--text3);font-size:10px">'+escHtml(c.idEquipamento)+'</span></td>'
    + '<td>'+escHtml(c.tipoProblema)+'</td>'
    + '<td>'+prioBadge+'</td>'
    + '<td><span class="badge '+statusCls(c.status)+'">'+escHtml(c.status)+'</span></td>'
    + '<td class="desc-cell">'+escHtml(c.descricao)+'</td>'
    + '<td>'+escHtml(c.abertoPor)+'</td>'
    + '<td>'+escHtml(c.dataAbertura)+'</td>'
    + '<td>'+escHtml(c.responsavel||'—')+'</td>'
    + acoes
    + '</tr>';
}

function filtrar(){
  var busca = document.getElementById('busca').value.toLowerCase();
  var fs = document.getElementById('f-status').value;
  var fp = document.getElementById('f-prioridade').value;
  var filtrados = CHAMADOS.filter(function(c){
    if (fs && c.status !== fs) return false;
    if (fp && c.prioridade !== fp) return false;
    if (busca && !(c.equipamento+' '+c.tipoProblema+' '+c.descricao+' '+c.idEquipamento).toLowerCase().includes(busca)) return false;
    return true;
  });
  var colspan = IS_GESTOR ? 10 : 9;
  document.getElementById('tbody').innerHTML = filtrados.map(linhaHTML).join('') || ('<tr><td colspan="'+colspan+'" style="text-align:center;color:var(--text3);padding:20px">Nenhum chamado encontrado</td></tr>');
}

function fecharModais(){ document.querySelectorAll('.modal-bg').forEach(function(m){ m.classList.remove('open'); }); idAtual = null; }

function abrirNovoChamado(){
  document.getElementById('c-equip-busca').value = '';
  equipSelecionado = '';
  document.getElementById('c-descricao').value = '';
  document.getElementById('modal-abrir').classList.add('open');
}
function selecionarEquip(){
  var v = document.getElementById('c-equip-busca').value;
  var m = v.match(/^(EQP-\\d+)/);
  equipSelecionado = m ? m[1] : '';
}
async function salvarAbrir(){
  if (!equipSelecionado || !EQUIP_MAP[equipSelecionado]) return alert('Selecione um equipamento válido da lista');
  var body = {
    action: 'abrir',
    idEquipamento: equipSelecionado,
    tipoProblema: document.getElementById('c-tipo').value,
    prioridade: document.getElementById('c-prioridade').value,
    descricao: document.getElementById('c-descricao').value,
  };
  var r = await fetch('/api/chamados', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao abrir chamado');
  location.reload();
}

function abrirGerenciar(id){
  idAtual = id;
  var c = CHAMADOS.find(function(x){ return x.id === id; });
  if (!c) return;
  document.getElementById('g-status').value = c.status;
  document.getElementById('g-responsavel').value = c.responsavel;
  document.getElementById('g-solucao').value = c.solucao;
  document.getElementById('modal-gerenciar').classList.add('open');
}
async function salvarGerenciar(){
  var body = {
    action: 'atualizar', id: idAtual,
    novoStatus: document.getElementById('g-status').value,
    responsavel: document.getElementById('g-responsavel').value,
    solucao: document.getElementById('g-solucao').value,
  };
  var r = await fetch('/api/chamados', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao atualizar chamado');
  location.reload();
}

filtrar();
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(baseHTML('Chamados', conteudo, script));
}
