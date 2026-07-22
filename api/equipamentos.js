// api/equipamentos.js — Catálogo e alocação de equipamentos (parque das 6 PDs)
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
// Escreve na próxima linha vazia via leitura + PUT explícito (não usa values.append: ver
// Changelog 2026-07-11 do CLAUDE.md — values.append pode contaminar o alinhamento de colunas
// de appends futuros quando há qualquer linha desalinhada perto do fim da aba).
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

const LOCAIS = ['Estoque','PD 1','PD 2','PD 3','PD 4','PD 5','PD 6','Switcher A (SWA)','Switcher B (SWB)','Estúdio 1','Estúdio 2'];
const STATUSES = ['Operacional','Em manutenção','Reserva','Baixado'];
const TIPOS_PARQUE = ['Interno','Externo'];
const PDS_SEED = ['PD 1','PD 2','PD 3','PD 4','PD 5','PD 6'];

const CATALOGO_PADRAO = [
  { categoria: 'Vídeo/Monitoração', equipamento: 'Monitor 50"', qtdPorPd: 5 },
  { categoria: 'Vídeo/Monitoração', equipamento: 'Monitor 32"', qtdPorPd: 1 },
  { categoria: 'Vídeo/Monitoração', equipamento: 'Monitor (genérico)', qtdPorPd: 4 },
  { categoria: 'Vídeo/Monitoração', equipamento: 'Painel de LED', qtdPorPd: 4 },
  { categoria: 'Captação', equipamento: 'Câmera AIDA', qtdPorPd: 1 },
  { categoria: 'Switching/Produção', equipamento: 'Vmix', qtdPorPd: 2 },
  { categoria: 'Periféricos/TI', equipamento: 'Teclado', qtdPorPd: 2 },
  { categoria: 'Periféricos/TI', equipamento: 'Mouse', qtdPorPd: 2 },
  { categoria: 'Áudio', equipamento: 'Mesa de áudio Yamaha DM3', qtdPorPd: 1 },
  { categoria: 'Áudio', equipamento: 'Caixa de monitoramento Genelec', qtdPorPd: 2 },
  { categoria: 'Áudio', equipamento: 'AEQ Olímpia 3', qtdPorPd: 1 },
  { categoria: 'Áudio', equipamento: 'Microfone e835s', qtdPorPd: 3 },
  { categoria: 'Comunicação/Intercom', equipamento: 'Painel de comunicação', qtdPorPd: 1 },
  { categoria: 'Comunicação/Intercom', equipamento: 'Fone de comunicação', qtdPorPd: 1 },
  { categoria: 'Comunicação/Intercom', equipamento: 'Fone concha', qtdPorPd: 3 },
];
const CATEGORIAS = [...new Set(CATALOGO_PADRAO.map(i => i.categoria))];

// Garante que uma coluna nova exista na aba Equipamentos: expande a grade antes de escrever
// (padrão igual ao setup-auth.js — a API rejeita escrita fora dos limites atuais da grade) e
// escreve o cabeçalho se estiver faltando. Nunca deixa a migração derrubar a página inteira.
async function garantirColuna(sheets, letra, indiceColuna, nomeCabecalho) {
  try {
    const atual = await getSheet(`Equipamentos!${letra}1:${letra}1`);
    if (atual[0]?.[0]) return;
    const eqSheetMeta = sheets.find(s => s.properties.title === 'Equipamentos');
    const colAtual = eqSheetMeta?.properties.gridProperties?.columnCount || 10;
    if (colAtual < indiceColuna) {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: eqSheetMeta.properties.sheetId, gridProperties: { columnCount: indiceColuna } },
            fields: 'gridProperties.columnCount'
          }
        }]
      });
    }
    await setSheet(`Equipamentos!${letra}1`, [[nomeCabecalho]]);
  } catch {
    // linhas sem essa coluna continuam com o campo tratado como vazio/padrão na leitura
  }
}

async function garantirAbas() {
  const spreadsheet = await sheetsRequest(SHEET_ID, '');
  const sheets = spreadsheet.sheets || [];
  const temEquipamentos = sheets.some(s => s.properties.title === 'Equipamentos');
  const temMovimentacoes = sheets.some(s => s.properties.title === 'MovimentacoesEquipamento');

  if (!temEquipamentos) {
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: 'Equipamentos', gridProperties: { rowCount: 2000, columnCount: 15 } } } }]
    });
    await setSheet('Equipamentos!A1:O1', [[
      'ID','Categoria','Equipamento','Patrimônio','Série','Status','Alocação atual','Data última movimentação','Observação','Data cadastro','Tipo de Parque',
      'Anatel','IMEI eSIM','IMEI Físico','Chip/Telefone'
    ]]);
  } else {
    // Migração: abas criadas antes de campos novos não têm essas colunas — adiciona uma por
    // uma se faltar (linhas existentes ficam com o campo vazio, tratado como padrão na leitura).
    await garantirColuna(sheets, 'K', 11, 'Tipo de Parque');
    await garantirColuna(sheets, 'L', 12, 'Anatel');
    await garantirColuna(sheets, 'M', 13, 'IMEI eSIM');
    await garantirColuna(sheets, 'N', 14, 'IMEI Físico');
    await garantirColuna(sheets, 'O', 15, 'Chip/Telefone');
  }
  if (!temMovimentacoes) {
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: 'MovimentacoesEquipamento', gridProperties: { rowCount: 2000, columnCount: 8 } } } }]
    });
    await setSheet('MovimentacoesEquipamento!A1:H1', [[
      'Timestamp','ID Equipamento','Equipamento','De','Para','Responsável','Observação','Tipo'
    ]]);
  }
  return { criouEquipamentos: !temEquipamentos };
}

async function semearCatalogoPadrao() {
  const agora = fmtTimestamp(getBRT());
  const linhas = [];
  let seq = 1;
  for (const pd of PDS_SEED) {
    for (const item of CATALOGO_PADRAO) {
      for (let u = 0; u < item.qtdPorPd; u++) {
        const id = 'EQP-' + String(seq).padStart(4,'0');
        linhas.push([id, item.categoria, item.equipamento, '', '', 'Operacional', pd, agora, '', agora, 'Interno', '', '', '', '']);
        seq++;
      }
    }
  }
  await inserirLinhas('Equipamentos', 'O', linhas, 2);
  await inserirLinhas('MovimentacoesEquipamento', 'H', [[
    agora, '—', '—', '—', 'Carga inicial', 'Sistema', `Seed automático — ${linhas.length} unidades`, 'cadastro'
  ]], 2);
}

async function registrarMovimentacao({ id, equipamento, de, para, responsavel, observacao, tipo }) {
  const linha = await proximaLinhaLivre('MovimentacoesEquipamento');
  await inserirLinhas('MovimentacoesEquipamento', 'H', [[
    fmtTimestamp(getBRT()), id, equipamento, de || '—', para || '—', responsavel, observacao || '', tipo
  ]], linha);
}

function proximoId(equipamentosRaw) {
  let max = 0;
  for (const r of equipamentosRaw) {
    const m = String(r[0]||'').match(/^EQP-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'EQP-' + String(max + 1).padStart(4, '0');
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.method === 'GET') return res.redirect(302, '/api/app');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const equipeRaw = await getSheet('Equipe!A2:L200');
  const usuario = equipeRaw.find(r => r[0] === session.nome);
  const isGestor = usuario?.[8] === 'gestor' && (usuario?.[10]||'ativo') === 'ativo';
  if (!isGestor) {
    if (req.method === 'GET') return res.redirect(302, '/api/app');
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { criouEquipamentos } = await garantirAbas();
  if (criouEquipamentos) await semearCatalogoPadrao();

  if (req.method === 'GET') {
    if (req.query.v === 'historico') {
      const movRaw = await getSheet('MovimentacoesEquipamento!A2:H5000');
      return renderHistorico(res, session, movRaw);
    }
    const [equipamentosRaw, movRaw] = await Promise.all([
      getSheet('Equipamentos!A2:O3000'),
      getSheet('MovimentacoesEquipamento!A2:H5000'),
    ]);
    return renderInventario(res, session, equipamentosRaw, movRaw);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { action } = req.body || {};
  const equipamentosRaw = await getSheet('Equipamentos!A2:O3000');

  if (action === 'cadastrar') {
    const { categoria, equipamento, patrimonio, serie, alocacao, observacao, tipoParque, anatel, imeiEsim, imeiFisico, chip } = req.body || {};
    if (!categoria?.trim() || !equipamento?.trim()) return res.status(400).json({ error: 'Categoria e equipamento são obrigatórios' });
    const tipo = TIPOS_PARQUE.includes(tipoParque) ? tipoParque : 'Interno';
    const local = tipo === 'Externo'
      ? ((alocacao||'').trim() || 'A definir')
      : (LOCAIS.includes(alocacao) ? alocacao : 'Estoque');
    const id = proximoId(equipamentosRaw);
    const agora = fmtTimestamp(getBRT());
    const linha = await proximaLinhaLivre('Equipamentos');
    await inserirLinhas('Equipamentos', 'O', [[
      id, categoria.trim(), equipamento.trim(), patrimonio||'', serie||'', 'Operacional', local, agora, observacao||'', agora, tipo,
      anatel||'', imeiEsim||'', imeiFisico||'', chip||''
    ]], linha);
    await registrarMovimentacao({ id, equipamento: equipamento.trim(), de: '—', para: `${local} (${tipo})`, responsavel: session.nome, observacao, tipo: 'cadastro' });
    return res.status(200).json({ ok: true, id, msg: `${equipamento.trim()} cadastrado em ${local}` });
  }

  const idx = equipamentosRaw.findIndex(r => r[0] === (req.body||{}).id);
  if (idx < 0 && ['mover','status','editar','remover'].includes(action)) {
    return res.status(404).json({ error: 'Equipamento não encontrado' });
  }
  const row = equipamentosRaw[idx];
  const linha = idx + 2;

  if (action === 'mover') {
    const { novaAlocacao } = req.body || {};
    const tipoAtual = TIPOS_PARQUE.includes(row[10]) ? row[10] : 'Interno';
    const novaAlocacaoValida = tipoAtual === 'Externo'
      ? (novaAlocacao||'').trim()
      : (LOCAIS.includes(novaAlocacao) ? novaAlocacao : null);
    if (!novaAlocacaoValida) return res.status(400).json({ error: 'Alocação inválida' });
    const de = row[6] || 'Estoque';
    const agora = fmtTimestamp(getBRT());
    await setSheet(`Equipamentos!G${linha}:H${linha}`, [[novaAlocacaoValida, agora]]);
    await registrarMovimentacao({ id: row[0], equipamento: row[2], de, para: novaAlocacaoValida, responsavel: session.nome, tipo: 'mover' });
    return res.status(200).json({ ok: true, msg: `${row[2]} movido para ${novaAlocacaoValida}` });
  }

  if (action === 'status') {
    const { novoStatus } = req.body || {};
    if (!STATUSES.includes(novoStatus)) return res.status(400).json({ error: 'Status inválido' });
    const de = row[5] || 'Operacional';
    const agora = fmtTimestamp(getBRT());
    await setSheet(`Equipamentos!F${linha}:H${linha}`, [[novoStatus, row[6]||'', agora]]);
    await registrarMovimentacao({ id: row[0], equipamento: row[2], de, para: novoStatus, responsavel: session.nome, tipo: 'status' });
    return res.status(200).json({ ok: true, msg: `${row[2]} agora está ${novoStatus}` });
  }

  if (action === 'editar') {
    const { categoria, equipamento, patrimonio, serie, observacao, anatel, imeiEsim, imeiFisico, chip } = req.body || {};
    if (!categoria?.trim() || !equipamento?.trim()) return res.status(400).json({ error: 'Categoria e equipamento são obrigatórios' });
    await setSheet(`Equipamentos!B${linha}:E${linha}`, [[categoria.trim(), equipamento.trim(), patrimonio||'', serie||'']]);
    await setSheet(`Equipamentos!I${linha}`, [[observacao||'']]);
    await setSheet(`Equipamentos!L${linha}:O${linha}`, [[anatel||'', imeiEsim||'', imeiFisico||'', chip||'']]);
    await registrarMovimentacao({ id: row[0], equipamento: equipamento.trim(), de: '—', para: '—', responsavel: session.nome, observacao: 'Dados editados', tipo: 'edicao' });
    return res.status(200).json({ ok: true, msg: 'Dados atualizados' });
  }

  if (action === 'remover') {
    const { motivo } = req.body || {};
    await registrarMovimentacao({ id: row[0], equipamento: row[2], de: row[6]||'', para: '—', responsavel: session.nome, observacao: `Removido: ${motivo||'sem motivo informado'}`, tipo: 'baixa' });
    const spreadsheet = await sheetsRequest(SHEET_ID, '');
    const eqSheet = spreadsheet.sheets?.find(s => s.properties.title === 'Equipamentos');
    if (!eqSheet) return res.status(500).json({ error: 'Aba Equipamentos não encontrada' });
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ deleteDimension: { range: { sheetId: eqSheet.properties.sheetId, dimension: 'ROWS', startIndex: linha-1, endIndex: linha } } }]
    });
    return res.status(200).json({ ok: true, msg: `${row[2]} removido do parque` });
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
  --blue-m-bg:#eff6ff;--blue-m-border:#dbeafe;--blue-m-v:#1d4ed8;
  --badge-green-bg:#dcfce7;--badge-green-c:#166534;
  --badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
  --badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
  --cat-video:#3b6fa0;--cat-captacao:#6e5aa3;--cat-producao:#1e7f8c;
  --cat-perifericos:#6b7686;--cat-audio:#c97a2b;--cat-comunicacao:#a3436b;--cat-mobile:#2f9e58;
  --shadow:0 1px 2px rgba(20,20,20,.04), 0 6px 16px -8px rgba(20,20,20,.10);
  --shadow-sm:0 1px 2px rgba(20,20,20,.05);
}
html.dark{
  --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
  --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
  --header:#0f1117;--blue:#63b3ed;
  --cat-video:#6f9bcf;--cat-captacao:#a692d6;--cat-producao:#4bb8c4;
  --cat-perifericos:#98a3ad;--cat-audio:#e4a35c;--cat-comunicacao:#d17ea1;--cat-mobile:#5cc588;
  --blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;
  --badge-green-bg:#0d2010;--badge-green-c:#68d391;
  --badge-red-bg:#1f1010;--badge-red-c:#fc8181;
  --badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 6px 18px -8px rgba(0,0,0,.5);
  --shadow-sm:0 1px 2px rgba(0,0,0,.35);
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
.macro-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}
@media (max-width:900px){.macro-grid{grid-template-columns:1fr}}
.macro-card{display:flex;align-items:center;gap:14px;text-align:left;border:1px solid var(--border);border-radius:14px;padding:18px 20px;background:var(--card);cursor:pointer;box-shadow:var(--shadow-sm);transition:transform .15s,box-shadow .15s;font-family:inherit;border-top:3px solid var(--border)}
.macro-card:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
.macro-card.interno{border-top-color:var(--cat-video)}
.macro-card.externo{border-top-color:var(--cat-comunicacao)}
.macro-card.todos{border-top-color:var(--blue)}
.macro-ic{font-size:26px;width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--bg3)}
.macro-n{font-size:28px;font-weight:800;line-height:1;color:var(--text)}
.macro-l{font-size:12px;font-weight:700;color:var(--text2);margin-top:3px}
.macro-s{font-size:10.5px;color:var(--text3);margin-top:2px}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600;white-space:nowrap}
.badge.green{background:var(--badge-green-bg);color:var(--badge-green-c)}
.badge.red{background:var(--badge-red-bg);color:var(--badge-red-c)}
.badge.amber{background:var(--badge-amber-bg);color:var(--badge-amber-c)}
.badge.blue{background:var(--blue-m-bg);color:var(--blue-m-v)}
.section-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);font-weight:700;margin:0 0 8px 2px;display:flex;align-items:center;gap:6px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:12px;transition:transform .15s,box-shadow .15s}
.stat:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.stat .ic{font-size:20px;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--bg3)}
.stat.blue-m .ic{background:var(--blue-m-bg)}
.stat.green-m .ic{background:var(--badge-green-bg)}
.stat.amber-m .ic{background:var(--badge-amber-bg)}
.stat.red-m .ic{background:var(--badge-red-bg)}
.stat .n{font-size:24px;font-weight:800;line-height:1}
.stat .l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:3px;font-weight:600}
.quick-nav{margin-bottom:22px}
.quick-nav-row{display:flex;flex-wrap:wrap;gap:8px}
.pill{border:1px solid var(--border);border-radius:999px;padding:7px 15px;font-size:12px;background:var(--card);color:var(--text);cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:all .15s;font-family:inherit;box-shadow:var(--shadow-sm)}
.pill:hover{background:var(--bg3);transform:translateY(-1px)}
.pill.active{background:var(--blue);border-color:var(--blue);color:#fff;box-shadow:var(--shadow)}
.pill .c{font-weight:800;background:rgba(127,127,127,.15);border-radius:999px;padding:1px 7px;font-size:11px}
.pill.active .c{background:rgba(255,255,255,.22)}
.dash-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
@media (max-width:900px){.dash-grid{grid-template-columns:1fr}}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow-sm)}
.chart-card h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:14px;font-weight:700;display:flex;align-items:center;gap:6px}
.donut-wrap{display:flex;align-items:center;gap:18px}
.donut-legend{display:flex;flex-direction:column;gap:8px;font-size:12px}
.donut-legend .row{display:flex;align-items:center;gap:8px}
.donut-legend i{width:10px;height:10px;border-radius:3px;flex:none}
.donut-legend .v{margin-left:auto;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
.atividade{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:6px 18px;margin-bottom:20px;box-shadow:var(--shadow-sm)}
.atividade-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border2);font-size:12px}
.atividade-item:last-child{border-bottom:none}
.atividade-item .tipo-ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px;background:var(--bg3)}
.atividade-item .quando{color:var(--text3);font-size:11px;white-space:nowrap;min-width:110px;font-variant-numeric:tabular-nums}
.atividade-item .desc{flex:1;color:var(--text)}
.atividade-item .desc b{font-weight:700}
.toolbar{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;box-shadow:var(--shadow-sm)}
.toolbar input,.toolbar select{border:1px solid var(--border);border-radius:7px;padding:8px 11px;font-size:12px;background:var(--bg2);color:var(--text);outline:none}
.toolbar input:focus,.toolbar select:focus{border-color:var(--blue)}
.btn{border:1px solid var(--border);border-radius:7px;padding:8px 13px;font-size:12px;background:var(--card);color:var(--text);cursor:pointer;transition:background .15s}
.btn:hover{background:var(--bg3)}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}
.tbl-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-x:auto;box-shadow:var(--shadow-sm)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:11px 12px;color:var(--text3);text-transform:uppercase;font-size:10px;letter-spacing:.04em;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--bg2)}
td{padding:10px 12px;border-bottom:1px solid var(--border2);vertical-align:middle}
tbody tr:hover{background:var(--bg2)}
tr:last-child td{border-bottom:none}
.acoes{display:flex;gap:4px}
.acoes button{border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;background:var(--bg2);color:var(--text);cursor:pointer;transition:background .15s}
.acoes button:hover{background:var(--bg3)}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border-radius:14px;padding:22px;width:380px;max-width:calc(100vw - 32px);max-height:85vh;overflow-y:auto;box-shadow:var(--shadow)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px}
.field{margin-bottom:10px}
.field label{display:block;font-size:11px;font-weight:600;color:var(--text3);margin-bottom:4px;text-transform:uppercase}
.field input,.field select,.field textarea{width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;background:var(--bg2);color:var(--text);outline:none}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.tel-details{margin:4px 0 10px;border:1px solid var(--border);border-radius:8px;padding:2px 10px}
.tel-details summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--text2);padding:8px 0;list-style:none}
.tel-details summary::-webkit-details-marker{display:none}
.tel-details[open] summary{border-bottom:1px solid var(--border2);margin-bottom:8px}
.tel-details .field{margin-bottom:8px}
.info-ic{cursor:help;font-size:11px;color:var(--text3);margin-left:4px}
`;
}

function menuHTML() {
  return `
    <button id="tt" class="btn-sm" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Início</a>
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausências</a>
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
        <a href="/api/equipamentos" class="menu-item">&#128230; Equipamentos</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>`;
}

function headerHTML(nome, sub) {
  return `
<div class="header">
  <div class="logo">P</div>
  <div>
    <div class="ht">Equipamentos</div>
    <div class="hs">${esc(sub)}</div>
  </div>
  <div class="hr">${menuHTML()}</div>
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

const CAT_COR = {
  'Vídeo/Monitoração': 'var(--cat-video)',
  'Captação': 'var(--cat-captacao)',
  'Switching/Produção': 'var(--cat-producao)',
  'Periféricos/TI': 'var(--cat-perifericos)',
  'Áudio': 'var(--cat-audio)',
  'Comunicação/Intercom': 'var(--cat-comunicacao)',
  'Mobile/MoJo': 'var(--cat-mobile)',
};
const CAT_COR_PADRAO = 'var(--text3)'; // fallback pra categoria nova cadastrada sem cor definida acima
const STATUS_COR = {
  'Operacional': 'var(--badge-green-c)',
  'Em manutenção': 'var(--badge-amber-c)',
  'Reserva': 'var(--blue-m-v)',
  'Baixado': 'var(--badge-red-c)',
};

function barChartSVG(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  const barH = 20, gap = 8, labelW = 140, chartW = 130;
  const rowH = barH + gap;
  const height = items.length * rowH - gap;
  const rows = items.map((it, i) => {
    const y = i * rowH;
    const w = Math.max(2, Math.round((it.value / max) * chartW));
    return `<text x="0" y="${y + barH*0.72}" font-size="10" style="fill:var(--text2)">${esc(it.label)}</text>
      <rect x="${labelW}" y="${y}" width="${chartW}" height="${barH}" rx="4" style="fill:var(--bg3)"></rect>
      <rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="4" style="fill:${it.color}"></rect>
      <text x="${labelW + chartW + 8}" y="${y + barH*0.72}" font-size="11" font-weight="700" style="fill:var(--text)">${it.value}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${labelW + chartW + 32} ${Math.max(height,1)}" width="100%" height="${Math.max(height,1)}">${rows}</svg>`;
}

function donutSVG(items) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = 44, cx = 54, cy = 54, sw = 15;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcos = items.filter(i => i.value > 0).map(it => {
    const dash = (it.value / total) * circ;
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${it.color}" stroke-width="${sw}" stroke-dasharray="${dash} ${circ-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
    return el;
  }).join('');
  return `<svg viewBox="0 0 108 108" width="108" height="108">${arcos}<circle cx="${cx}" cy="${cy}" r="${r-sw/2-2}" style="fill:var(--card)"/><text x="${cx}" y="${cy+6}" text-anchor="middle" font-size="20" font-weight="800" style="fill:var(--text)">${total}</text></svg>`;
}

function renderInventario(res, session, equipamentosRaw, movRaw) {
  const unidades = equipamentosRaw.filter(r => r[0]).map(r => ({
    id: r[0], categoria: r[1]||'', equipamento: r[2]||'', patrimonio: r[3]||'', serie: r[4]||'',
    status: r[5]||'Operacional', alocacao: r[6]||'Estoque', dataMov: r[7]||'', observacao: r[8]||'', dataCadastro: r[9]||'',
    tipoParque: TIPOS_PARQUE.includes(r[10]) ? r[10] : 'Interno',
    anatel: r[11]||'', imeiEsim: r[12]||'', imeiFisico: r[13]||'', chip: r[14]||''
  }));

  const porCategoria = {};
  const porLocal = {};
  const porStatus = {};
  const porTipo = { Interno: 0, Externo: 0 };
  for (const u of unidades) {
    porCategoria[u.categoria] = (porCategoria[u.categoria]||0) + 1;
    porLocal[u.alocacao] = (porLocal[u.alocacao]||0) + 1;
    porStatus[u.status] = (porStatus[u.status]||0) + 1;
    porTipo[u.tipoParque] = (porTipo[u.tipoParque]||0) + 1;
  }
  // Categorias reais (catálogo padrão + qualquer categoria nova cadastrada, ex: Mobile/MoJo do parque externo)
  const categoriasTodas = [...new Set([...CATEGORIAS, ...unidades.map(u => u.categoria)])].filter(Boolean).sort((a,b) => a.localeCompare(b, 'pt'));
  // Locais reais (lista fixa da base + qualquer alocação nova, ex: locais de texto livre do parque externo)
  const locaisExtras = [...new Set(unidades.map(u => u.alocacao))].filter(l => l && !LOCAIS.includes(l)).sort((a,b) => a.localeCompare(b, 'pt'));
  const locaisTodos = [...LOCAIS, ...locaisExtras];

  const macroHTML = `
    <button type="button" class="macro-card interno" onclick="irParaTipo('Interno')">
      <div class="macro-ic">🏠</div>
      <div><div class="macro-n">${porTipo.Interno}</div><div class="macro-l">Parque Interno</div><div class="macro-s">PDs, Switchers, Estúdios e Estoque</div></div>
    </button>
    <button type="button" class="macro-card externo" onclick="irParaTipo('Externo')">
      <div class="macro-ic">🌐</div>
      <div><div class="macro-n">${porTipo.Externo}</div><div class="macro-l">Parque Externo</div><div class="macro-s">Locado de terceiros ou próprio fora da base</div></div>
    </button>
    <button type="button" class="macro-card todos" onclick="irParaTipo('')">
      <div class="macro-ic">📦</div>
      <div><div class="macro-n">${unidades.length}</div><div class="macro-l">Visão Geral</div><div class="macro-s">Interno + Externo combinados</div></div>
    </button>`;

  const kpiHTML = [
    `<div class="stat blue-m"><div class="ic">📦</div><div><div class="n">${unidades.length}</div><div class="l">Total no parque</div></div></div>`,
    `<div class="stat green-m"><div class="ic">✅</div><div><div class="n" style="color:var(--badge-green-c)">${porStatus['Operacional']||0}</div><div class="l">Operacional</div></div></div>`,
    `<div class="stat amber-m"><div class="ic">🔧</div><div><div class="n" style="color:var(--badge-amber-c)">${porStatus['Em manutenção']||0}</div><div class="l">Em manutenção</div></div></div>`,
    `<div class="stat red-m"><div class="ic">⛔</div><div><div class="n" style="color:var(--badge-red-c)">${porStatus['Baixado']||0}</div><div class="l">Baixados</div></div></div>`,
  ].join('');

  function iconeLocal(l) {
    if (l === 'Estoque') return '📦';
    if (l.startsWith('PD')) return '🎬';
    if (l.startsWith('Switcher')) return '🎛️';
    if (l.startsWith('Estúdio')) return '🎥';
    if (/KIT\s*MOJO/i.test(l)) return '🎒';
    return '📍';
  }
  const quickNavHTML = `<span class="section-label">📍 Acesso rápido por local</span><div class="quick-nav-row">`
    + `<button type="button" class="pill active" data-local="" onclick="irParaLocal('')">Todos <span class="c">${unidades.length}</span></button>`
    + locaisTodos.map(l => `<button type="button" class="pill" data-local="${esc(l)}" onclick="irParaLocal('${esc(l)}')">${iconeLocal(l)} ${esc(l)} <span class="c">${porLocal[l]||0}</span></button>`).join('')
    + `</div>`;

  const chartCategoria = barChartSVG(categoriasTodas.filter(c => porCategoria[c]).map(c => ({ label: c, value: porCategoria[c]||0, color: CAT_COR[c] || CAT_COR_PADRAO })));
  const chartLocal = barChartSVG(locaisTodos.map(l => ({ label: l, value: porLocal[l]||0, color: 'var(--blue)' })));
  const statusItems = STATUSES.map(s => ({ label: s, value: porStatus[s]||0, color: STATUS_COR[s] }));
  const chartStatus = donutSVG(statusItems);
  const legendStatus = statusItems.map(it => `<div class="row"><i style="background:${it.color}"></i>${esc(it.label)}<span class="v">${it.value}</span></div>`).join('');

  const eventosRecentes = movRaw.filter(r => r[0]).map(r => ({
    timestamp: r[0]||'', equipamento: r[2]||'', de: r[3]||'', para: r[4]||'', responsavel: r[5]||'', tipo: r[7]||''
  })).slice(-6).reverse();
  const TIPO_TXT = { cadastro: 'cadastrado', mover: 'movido', status: 'status alterado', edicao: 'editado', baixa: 'removido' };
  const TIPO_IC = { cadastro: '🆕', mover: '🔀', status: '🔧', edicao: '✏️', baixa: '🗑️' };
  const atividadeHTML = eventosRecentes.length ? eventosRecentes.map(e => `
    <div class="atividade-item">
      <span class="tipo-ic">${TIPO_IC[e.tipo]||'•'}</span>
      <span class="quando">${esc(e.timestamp)}</span>
      <span class="desc"><b>${esc(e.equipamento)}</b> ${TIPO_TXT[e.tipo]||esc(e.tipo)}${e.tipo==='mover'?` — ${esc(e.de)} &rarr; ${esc(e.para)}`:e.tipo==='status'?` — ${esc(e.de)} &rarr; ${esc(e.para)}`:''} <span style="color:var(--text3)">por ${esc(e.responsavel)}</span></span>
    </div>`).join('') : `<div class="atividade-item" style="color:var(--text3)">Nenhuma movimentação ainda</div>`;

  const conteudo = `
${headerHTML(session.nome, `${unidades.length} unidades cadastradas no parque`)}
<div class="wrap">
  <span class="section-label">🗺️ Visão macro do parque</span>
  <div class="macro-grid">${macroHTML}</div>

  <div class="summary">${kpiHTML}</div>

  <div class="quick-nav" id="quick-nav">${quickNavHTML}</div>

  <div class="dash-grid">
    <div class="chart-card"><h4>📊 Por categoria</h4>${chartCategoria}</div>
    <div class="chart-card"><h4>📍 Por alocação</h4>${chartLocal}</div>
    <div class="chart-card"><h4>🩺 Status</h4><div class="donut-wrap">${chartStatus}<div class="donut-legend">${legendStatus}</div></div></div>
  </div>

  <div class="atividade">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0 4px">
      <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:700;display:flex;align-items:center;gap:6px">🕓 Atividade recente</h4>
      <a href="/api/equipamentos?v=historico" style="font-size:11px;color:var(--blue);font-weight:600">Ver histórico completo &rarr;</a>
    </div>
    ${atividadeHTML}
  </div>

  <div class="toolbar">
    <input id="busca" placeholder="🔍 Buscar por ID, equipamento, patrimônio ou série..." style="flex:1;min-width:220px" oninput="filtrar()">
    <select id="f-tipo" onchange="filtrar()"><option value="">Interno + Externo</option>${TIPOS_PARQUE.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
    <select id="f-categoria" onchange="filtrar()"><option value="">Todas categorias</option>${categoriasTodas.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
    <select id="f-local" onchange="filtrar()"><option value="">Toda alocação</option>${locaisTodos.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select>
    <select id="f-status" onchange="filtrar()"><option value="">Todo status</option>${STATUSES.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
    <button class="btn primary" onclick="abrirCadastro()">+ Cadastrar equipamento</button>
    <a href="/api/equipamentos?v=historico" class="btn">Histórico de movimentações</a>
  </div>

  <div class="tbl-wrap">
    <table id="tabela">
      <thead><tr>
        <th>ID</th><th>Categoria</th><th>Equipamento</th><th>Patrimônio</th><th>Série</th>
        <th>Status</th><th>Alocação</th><th>Última movimentação</th><th>Observação</th><th>Ações</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</div>

<div class="modal-bg" id="modal-cadastro"><div class="modal">
  <h3>Cadastrar equipamento</h3>
  <div class="field"><label>Categoria</label><input id="c-categoria" list="lista-categorias"></div>
  <datalist id="lista-categorias">${categoriasTodas.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
  <div class="field"><label>Equipamento</label><input id="c-equipamento"></div>
  <div class="field"><label>Nº Patrimônio</label><input id="c-patrimonio"></div>
  <div class="field"><label>Nº Série</label><input id="c-serie"></div>
  <div class="field"><label>Tipo de Parque</label><select id="c-tipo" onchange="toggleTipoCadastro()">${TIPOS_PARQUE.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
  <div class="field" id="c-alocacao-interno-wrap"><label>Alocação inicial</label><select id="c-alocacao-interno">${LOCAIS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select></div>
  <div class="field" id="c-alocacao-externo-wrap" style="display:none"><label>Local / cliente (parque externo)</label><input id="c-alocacao-externo" placeholder="Ex: Cliente X - Evento Y"></div>
  <div class="field"><label>Observação</label><textarea id="c-observacao" rows="2"></textarea></div>
  <details class="tel-details">
    <summary>📱 Dados do telefone (opcional)</summary>
    <div class="field"><label>Anatel</label><input id="c-anatel"></div>
    <div class="field"><label>IMEI eSIM</label><input id="c-imei-esim"></div>
    <div class="field"><label>IMEI Físico</label><input id="c-imei-fisico"></div>
    <div class="field"><label>Chip/Telefone</label><input id="c-chip"></div>
  </details>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarCadastro()">Cadastrar</button></div>
</div></div>

<div class="modal-bg" id="modal-mover"><div class="modal">
  <h3>Mover equipamento</h3>
  <div class="field" id="m-local-interno-wrap"><label>Novo local</label><select id="m-local-interno">${LOCAIS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select></div>
  <div class="field" id="m-local-externo-wrap" style="display:none"><label>Novo local (parque externo)</label><input id="m-local-externo" placeholder="Ex: Cliente X - Evento Y"></div>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarMover()">Mover</button></div>
</div></div>

<div class="modal-bg" id="modal-status"><div class="modal">
  <h3>Alterar status</h3>
  <div class="field"><label>Novo status</label><select id="s-status">${STATUSES.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarStatus()">Salvar</button></div>
</div></div>

<div class="modal-bg" id="modal-editar"><div class="modal">
  <h3>Editar equipamento</h3>
  <div class="field"><label>Categoria</label><input id="e-categoria"></div>
  <div class="field"><label>Equipamento</label><input id="e-equipamento"></div>
  <div class="field"><label>Nº Patrimônio</label><input id="e-patrimonio"></div>
  <div class="field"><label>Nº Série</label><input id="e-serie"></div>
  <div class="field"><label>Observação</label><textarea id="e-observacao" rows="2"></textarea></div>
  <details class="tel-details">
    <summary>📱 Dados do telefone (opcional)</summary>
    <div class="field"><label>Anatel</label><input id="e-anatel"></div>
    <div class="field"><label>IMEI eSIM</label><input id="e-imei-esim"></div>
    <div class="field"><label>IMEI Físico</label><input id="e-imei-fisico"></div>
    <div class="field"><label>Chip/Telefone</label><input id="e-chip"></div>
  </details>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarEditar()">Salvar</button></div>
</div></div>
`;

  const script = `
const UNIDADES = ${JSON.stringify(unidades)};
let idAtual = null;

function badgeCls(s){ return s==='Operacional'?'green':s==='Em manutenção'?'amber':s==='Baixado'?'red':'blue'; }
function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function telInfo(u){
  var partes = [];
  if (u.anatel) partes.push('Anatel: '+u.anatel);
  if (u.imeiEsim) partes.push('IMEI eSIM: '+u.imeiEsim);
  if (u.imeiFisico) partes.push('IMEI Físico: '+u.imeiFisico);
  if (u.chip) partes.push('Chip: '+u.chip);
  return partes.join(' | ');
}

function linhaHTML(u){
  var tel = telInfo(u);
  return '<tr>'
    + '<td>'+escHtml(u.id)+'</td>'
    + '<td>'+escHtml(u.categoria)+'</td>'
    + '<td>'+escHtml(u.equipamento)+'</td>'
    + '<td>'+escHtml(u.patrimonio||'—')+'</td>'
    + '<td>'+escHtml(u.serie||'—')+'</td>'
    + '<td><span class="badge '+badgeCls(u.status)+'">'+escHtml(u.status)+'</span></td>'
    + '<td>'+(u.tipoParque==='Externo'?'🌐 ':'🏠 ')+escHtml(u.alocacao)+'</td>'
    + '<td>'+escHtml(u.dataMov||'—')+'</td>'
    + '<td>'+escHtml(u.observacao||'—')+(tel?' <span class="info-ic" title="'+escHtml(tel)+'">📱</span>':'')+'</td>'
    + '<td class="acoes">'
    +   '<button onclick="abrirMover(\\''+u.id+'\\')">Mover</button>'
    +   '<button onclick="abrirStatus(\\''+u.id+'\\')">Status</button>'
    +   '<button onclick="abrirEditar(\\''+u.id+'\\')">Editar</button>'
    +   '<button onclick="removerUnidade(\\''+u.id+'\\')">Remover</button>'
    + '</td></tr>';
}

function filtrar(){
  const busca = document.getElementById('busca').value.toLowerCase();
  const ft = document.getElementById('f-tipo').value;
  const fc = document.getElementById('f-categoria').value;
  const fl = document.getElementById('f-local').value;
  const fs = document.getElementById('f-status').value;
  const filtradas = UNIDADES.filter(function(u){
    if (ft && u.tipoParque !== ft) return false;
    if (fc && u.categoria !== fc) return false;
    if (fl && u.alocacao !== fl) return false;
    if (fs && u.status !== fs) return false;
    if (busca && !(u.id+u.equipamento+u.patrimonio+u.serie).toLowerCase().includes(busca)) return false;
    return true;
  });
  document.getElementById('tbody').innerHTML = filtradas.map(linhaHTML).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:20px">Nenhum equipamento encontrado</td></tr>';
  atualizarPills(fl);
  atualizarMacroCards(ft);
}

function atualizarMacroCards(tipo){
  document.querySelectorAll('.macro-card').forEach(function(c){ c.style.outline = 'none'; });
  const alvo = tipo === 'Interno' ? '.macro-card.interno' : tipo === 'Externo' ? '.macro-card.externo' : '.macro-card.todos';
  const el = document.querySelector(alvo);
  if (el) el.style.outline = '2px solid var(--blue)';
}

function irParaTipo(tipo){
  document.getElementById('f-tipo').value = tipo;
  filtrar();
  document.getElementById('tabela').scrollIntoView({behavior:'smooth', block:'start'});
}

function toggleTipoCadastro(){
  const ext = document.getElementById('c-tipo').value === 'Externo';
  document.getElementById('c-alocacao-interno-wrap').style.display = ext ? 'none' : '';
  document.getElementById('c-alocacao-externo-wrap').style.display = ext ? '' : 'none';
}

function atualizarPills(local){
  document.querySelectorAll('#quick-nav .pill').forEach(function(p){
    p.classList.toggle('active', p.getAttribute('data-local') === local);
  });
}

function irParaLocal(local){
  document.getElementById('f-local').value = local;
  filtrar();
  document.getElementById('tabela').scrollIntoView({behavior:'smooth', block:'start'});
}

function fecharModais(){ document.querySelectorAll('.modal-bg').forEach(function(m){ m.classList.remove('open'); }); idAtual = null; }

function abrirCadastro(){ toggleTipoCadastro(); document.getElementById('modal-cadastro').classList.add('open'); }
async function salvarCadastro(){
  const tipo = document.getElementById('c-tipo').value;
  const alocacao = tipo === 'Externo'
    ? document.getElementById('c-alocacao-externo').value
    : document.getElementById('c-alocacao-interno').value;
  const body = {
    action: 'cadastrar',
    categoria: document.getElementById('c-categoria').value,
    equipamento: document.getElementById('c-equipamento').value,
    patrimonio: document.getElementById('c-patrimonio').value,
    serie: document.getElementById('c-serie').value,
    tipoParque: tipo,
    alocacao: alocacao,
    observacao: document.getElementById('c-observacao').value,
    anatel: document.getElementById('c-anatel').value,
    imeiEsim: document.getElementById('c-imei-esim').value,
    imeiFisico: document.getElementById('c-imei-fisico').value,
    chip: document.getElementById('c-chip').value,
  };
  const r = await fetch('/api/equipamentos', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao cadastrar');
  location.reload();
}

function abrirMover(id){
  idAtual = id;
  const u = UNIDADES.find(function(x){ return x.id === id; });
  const ext = u && u.tipoParque === 'Externo';
  document.getElementById('m-local-interno-wrap').style.display = ext ? 'none' : '';
  document.getElementById('m-local-externo-wrap').style.display = ext ? '' : 'none';
  if (ext) document.getElementById('m-local-externo').value = u.alocacao || '';
  else if (u) document.getElementById('m-local-interno').value = u.alocacao;
  document.getElementById('modal-mover').classList.add('open');
}
async function salvarMover(){
  const u = UNIDADES.find(function(x){ return x.id === idAtual; });
  const ext = u && u.tipoParque === 'Externo';
  const novaAlocacao = ext ? document.getElementById('m-local-externo').value : document.getElementById('m-local-interno').value;
  const r = await fetch('/api/equipamentos', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mover',id:idAtual,novaAlocacao:novaAlocacao})});
  const d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao mover');
  location.reload();
}

function abrirStatus(id){ idAtual = id; document.getElementById('modal-status').classList.add('open'); }
async function salvarStatus(){
  const r = await fetch('/api/equipamentos', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status',id:idAtual,novoStatus:document.getElementById('s-status').value})});
  const d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao alterar status');
  location.reload();
}

function abrirEditar(id){
  idAtual = id;
  const u = UNIDADES.find(function(x){ return x.id === id; });
  if (!u) return;
  document.getElementById('e-categoria').value = u.categoria;
  document.getElementById('e-equipamento').value = u.equipamento;
  document.getElementById('e-patrimonio').value = u.patrimonio;
  document.getElementById('e-serie').value = u.serie;
  document.getElementById('e-observacao').value = u.observacao;
  document.getElementById('e-anatel').value = u.anatel||'';
  document.getElementById('e-imei-esim').value = u.imeiEsim||'';
  document.getElementById('e-imei-fisico').value = u.imeiFisico||'';
  document.getElementById('e-chip').value = u.chip||'';
  document.getElementById('modal-editar').classList.add('open');
}
async function salvarEditar(){
  const body = {
    action: 'editar', id: idAtual,
    categoria: document.getElementById('e-categoria').value,
    equipamento: document.getElementById('e-equipamento').value,
    patrimonio: document.getElementById('e-patrimonio').value,
    serie: document.getElementById('e-serie').value,
    observacao: document.getElementById('e-observacao').value,
    anatel: document.getElementById('e-anatel').value,
    imeiEsim: document.getElementById('e-imei-esim').value,
    imeiFisico: document.getElementById('e-imei-fisico').value,
    chip: document.getElementById('e-chip').value,
  };
  const r = await fetch('/api/equipamentos', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao editar');
  location.reload();
}

async function removerUnidade(id){
  const motivo = prompt('Motivo da remoção (exclusão definitiva do parque):');
  if (motivo === null) return;
  const r = await fetch('/api/equipamentos', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remover',id:id,motivo:motivo})});
  const d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao remover');
  location.reload();
}

filtrar();
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(baseHTML('Equipamentos', conteudo, script));
}

function renderHistorico(res, session, movRaw) {
  const eventos = movRaw.filter(r => r[0]).map(r => ({
    timestamp: r[0]||'', id: r[1]||'', equipamento: r[2]||'', de: r[3]||'', para: r[4]||'',
    responsavel: r[5]||'', observacao: r[6]||'', tipo: r[7]||''
  })).reverse();

  const linhas = eventos.map(e => `<tr>
    <td>${esc(e.timestamp)}</td><td>${esc(e.id)}</td><td>${esc(e.equipamento)}</td>
    <td><span class="badge blue">${esc(e.tipo)}</span></td>
    <td>${esc(e.de)}</td><td>${esc(e.para)}</td><td>${esc(e.responsavel)}</td><td>${esc(e.observacao)}</td>
  </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:20px">Nenhuma movimentação registrada</td></tr>';

  const conteudo = `
${headerHTML(session.nome, `${eventos.length} eventos registrados`)}
<div class="wrap">
  <div class="toolbar"><a href="/api/equipamentos" class="btn">&larr; Voltar ao inventário</a></div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Quando</th><th>ID</th><th>Equipamento</th><th>Tipo</th><th>De</th><th>Para</th><th>Responsável</th><th>Observação</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </div>
</div>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(baseHTML('Histórico de equipamentos', conteudo));
}
