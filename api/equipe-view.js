// api/equipe-view.js — Gestão de equipe com aprovação de pendentes
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function iniciais(n) { return (n||'?').split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c => {
    const cookieParts = c.trim().split('=');
    const k = cookieParts.shift();
    cookies[k] = cookieParts.join('=');
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
    if (h !== hash(data + ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch {
    return null;
  }
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [equipeRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:M200'),
    getSheet('Ausências!A2:F500'),
  ]);
  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  // ── POST: ações ───────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { acao, linha, nome, cargo, nucleo, perfil, email, cpf, rg, nascimento, endereco, telefone, tipoContrato } = req.body || {};
    const idx = parseInt(linha);

    if (acao === 'aprovar' && idx) {
      const row = equipeRaw[idx-2] || [];
      await setSheet(`Equipe!A${idx}:M${idx}`, [[
        row[0]||'', row[1]||'', row[2]||'', row[3]||'', row[4]||'',
        row[5]||'', row[6]||'', row[7]||'',
        perfil||'colaborador',
        row[9]||'', 'ativo', row[11]||'', row[12]||''
      ]]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'aprovar-ausencia') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID inválido' });
      const aus = await getSheet('Ausências!A2:F500');
      const aidx = aus.findIndex(r => r[0] === id);
      if (aidx < 0) return res.status(404).json({ error: 'Não encontrado' });
      await setSheet(`Ausências!A${aidx+2}:F${aidx+2}`, [['APROVADO-'+id, aus[aidx][1], aus[aidx][2], aus[aidx][3], aus[aidx][4], aus[aidx][5]]]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'recusar-ausencia') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID inválido' });
      const aus = await getSheet('Ausências!A2:F500');
      const aidx = aus.findIndex(r => r[0] === id);
      if (aidx < 0) return res.status(404).json({ error: 'Não encontrado' });
      await setSheet(`Ausências!A${aidx+2}`, [['RECUSADO']]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'rejeitar' && idx) {
      const row = equipeRaw[idx-2] || [];
      await setSheet(`Equipe!K${idx}`, [['rejeitado']]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'editar' && idx) {
      const row = equipeRaw[idx-2] || [];
      await setSheet(`Equipe!A${idx}:M${idx}`, [[
        nome||row[0]||'',
        cargo||row[1]||'',
        nucleo||row[2]||'',
        cpf||row[3]||'',
        rg||row[4]||'',
        nascimento||row[5]||'',
        endereco||row[6]||'',
        row[7]||'',
        perfil||row[8]||'colaborador',
        email||row[9]||'',
        row[10]||'ativo',
        telefone||row[11]||'',
        tipoContrato!==undefined ? tipoContrato : (row[12]||''),
      ]]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'remover' && idx) {
      await setSheet(`Equipe!A${idx}:M${idx}`, [['','','','','','','','','','','','','']]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  }

  // ── GET: renderizar ───────────────────────────────────────────────────────
  const solicitacoesPendentes = ausenciasRaw.filter(r => r[0] && r[0].startsWith('PLS-')).map((r,i) => ({
    idx: i+2,
    id: r[0],
    nome: r[1]||'',
    tipo: r[2]||'',
    motivo: r[3]||'',
    dataInicio: r[4]||'',
    dataFim: r[5]||'',
  }));

  const todos = equipeRaw.map((r,i) => ({
    linha: i+2,
    nome:       r[0]||'',
    cargo:      r[1]||'',
    nucleo:     r[2]||'',
    cpf:        r[3]||'',
    rg:         r[4]||'',
    nascimento: r[5]||'',
    endereco:   r[6]||'',
    perfil:     r[8]||'colaborador',
    email:      r[9]||'',
    status:     (r[10]||'ativo').toLowerCase(),
    telefone:   r[11]||'',
    tipoContrato: r[12]||'',
  })).filter(m => m.nome);

  const pendentes    = todos.filter(m => m.status === 'pendente');
  const ativos       = todos.filter(m => m.status === 'ativo');
  const gestores     = ativos.filter(m => m.perfil === 'gestor');
  const colaboradores= ativos.filter(m => m.perfil !== 'gestor');

  function cardPendente(m) {
    return `
    <div style="background:var(--card);border:2px solid #d97706;border-radius:10px;padding:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:#fef3c7;color:#92400e;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(m.nome)}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700">${esc(m.nome)}</div>
          <div style="font-size:11px;color:var(--text3)">✉ ${esc(m.email)}</div>
        </div>
        <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700">Pendente</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;font-size:11px;color:var(--text2)">
        <div><span style="color:var(--text3)">CPF:</span> ${esc(m.cpf)||'—'}</div>
        <div><span style="color:var(--text3)">RG:</span> ${esc(m.rg)||'—'}</div>
        <div><span style="color:var(--text3)">Nasc.:</span> ${esc(m.nascimento)||'—'}</div>
        <div><span style="color:var(--text3)">Tel.:</span> ${esc(m.telefone)||'—'}</div>
        <div style="grid-column:1/-1"><span style="color:var(--text3)">Endereço:</span> ${esc(m.endereco)||'—'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="font-size:11px;color:var(--text3);font-weight:600">Perfil:</label>
        <select id="perfil-${m.linha}" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;background:var(--bg2);color:var(--text)">
          <option value="colaborador">Colaborador</option>
          <option value="gestor">Gestor</option>
        </select>
        <button onclick="aprovar(${m.linha})" style="background:#16a34a;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;color:#fff;cursor:pointer">✓ Aprovar</button>
        <button onclick="rejeitar(${m.linha})" style="background:none;border:1px solid #dc2626;border-radius:6px;padding:6px 10px;font-size:12px;color:#dc2626;cursor:pointer">✕</button>
      </div>
    </div>`;
  }

  function cardAtivo(m) {
    const isGestor = m.perfil === 'gestor';
    const [cor, corT] = isGestor ? ['#fef3c7','#92400e'] : ['#eff6ff','#1d4ed8'];
    const badge = isGestor
      ? `<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">Gestor</span>`
      : `<span style="background:#eff6ff;color:#1d4ed8;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">Colaborador</span>`;
    const tipoCores = { 'CLT':['#dcfce7','#166534'], 'PJ':['#f3e8ff','#7c3aed'], 'Temporário':['#fef3c7','#92400e'] };
    const tipoLabels = { 'CLT':'LIVE MODE', 'Temporário':'LET', 'PJ':'PJ' };
    const [tbg,tc] = tipoCores[m.tipoContrato] || ['#f3f4f6','#6b7280'];
    const badgeTipoContrato = `<span style="background:${tbg};color:${tc};border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">${tipoLabels[m.tipoContrato] || m.tipoContrato || '—'}</span>`;
    return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px">
      <div style="width:44px;height:44px;border-radius:50%;background:${cor};color:${corT};font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(m.nome)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:var(--text)">${esc(m.nome)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(m.cargo)||'—'}${m.nucleo?' · '+esc(m.nucleo):''}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${m.email ? '✉ '+esc(m.email) : '<span style="color:#f6ad55">⚠ Sem email</span>'}</div>
        ${m.telefone ? `<div style="font-size:11px;color:var(--text3);margin-top:1px">📞 ${esc(m.telefone)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        ${badge}
        ${badgeTipoContrato}
        <button onclick="abrirEditorById(${m.linha})" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:11px;color:var(--text2);cursor:pointer">Editar</button>
      </div>
    </div>`;
  }

  const membrosData = {};
  todos.filter(m=>m.nome).forEach(m => { membrosData[m.linha] = m; });
  const membrosDataJson = JSON.stringify(membrosData);

  function renderSolicitacoes() {
    if (!solicitacoesPendentes.length) return '';
    const cores = {
      'Férias': ['#dbeafe','#1d4ed8','🏖️'],
      'Folga programada': ['#dcfce7','#166534','📅'],
      'Atestado médico': ['#fee2e2','#991b1b','🏥'],
      'Troca de horário': ['#f3e8ff','#7c3aed','🔄'],
    };
    const cards = solicitacoesPendentes.map(s => {
      const [bg,c,ic] = cores[s.tipo] || ['#f3f4f6','#374151','📋'];
      const hasAnexo = s.motivo && s.motivo.includes('Anexo:');
      const anexoUrl = hasAnexo ? s.motivo.split('Anexo:')[1].trim() : '';
      const motivoTexto = hasAnexo ? s.motivo.split('Anexo:')[0].trim() : s.motivo;
      const dataRange = esc(s.dataInicio) + (s.dataFim && s.dataFim !== s.dataInicio ? ' → '+esc(s.dataFim) : '');
      const motivoDiv = motivoTexto ? '<div style="font-size:11px;color:var(--text2);margin-top:2px">'+esc(motivoTexto)+'</div>' : '';
      const anexoDiv = hasAnexo ? '<a href="'+esc(anexoUrl)+'" target="_blank" style="font-size:11px;color:#1d4ed8;margin-top:2px;display:inline-block">📎 Ver atestado</a>' : '';
      return '<div style="background:var(--card);border:1px solid '+c+';border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px">'
        +'<div style="font-size:20px">'+ic+'</div>'
        +'<div style="flex:1;min-width:0">'
          +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">'
            +'<span style="font-size:13px;font-weight:700">'+esc(s.nome)+'</span>'
            +'<span style="background:'+bg+';color:'+c+';border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600">'+esc(s.tipo)+'</span>'
          +'</div>'
          +'<div style="font-size:11px;color:var(--text3)">'+dataRange+'</div>'
          +motivoDiv+anexoDiv
          +'<div style="font-size:10px;color:var(--text3);margin-top:2px">ID: '+esc(s.id)+'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">'
          +'<button onclick="aprovarAusencia(&quot;'+esc(s.id)+'&quot;)" style="background:#16a34a;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;color:#fff;cursor:pointer">✓ OK</button>'
          +'<button onclick="recusarAusencia(&quot;'+esc(s.id)+'&quot;)" style="background:none;border:1px solid #dc2626;border-radius:6px;padding:5px 8px;font-size:11px;color:#dc2626;cursor:pointer">✕</button>'
        +'</div>'
      +'</div>';
    }).join('');
    return `<div class="section-title" style="margin-top:0">
      <span style="background:#7c3aed;color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px">${solicitacoesPendentes.length}</span>
      Solicitações de ausência
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">${cards}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Equipe</title>
<style>
:root{--bg:#f5f5f5;--bg2:#fafafa;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;--text:#1a1a1a;--text2:#555;--text3:#888;--header:#161920;}
html.dark{--bg:#1c1f26;--bg2:#242836;--card:#242836;--border:#2d3748;--border2:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--header:#0f1117;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:11px;color:#666}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:20px}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:20px 0 10px;display:flex;align-items:center;gap:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px;transition:all .2s}
.grid.list-view{grid-template-columns:1fr!important}
.eq-card{display:contents}
.list-view .eq-card>div{border-radius:8px!important}
@media(max-width:600px){.grid{grid-template-columns:1fr!important}}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border-radius:14px;padding:24px;width:460px;max-width:calc(100vw - 32px);max-height:90vh;overflow-y:auto}
.modal h3{font-size:16px;font-weight:700;margin-bottom:18px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.field{margin-bottom:12px}
.field label{display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.field input,.field select{width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none}
.modal-btns{display:flex;gap:8px;margin-top:18px}
.btn-cancel{flex:1;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;background:none;color:var(--text2);cursor:pointer}
.btn-primary{flex:2;border:none;border-radius:6px;padding:9px;font-size:13px;font-weight:600;background:#1d4ed8;color:#fff;cursor:pointer}
.btn-danger{border:none;border-radius:6px;padding:9px 14px;font-size:13px;font-weight:600;background:#dc2626;color:#fff;cursor:pointer}
.toast{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:300}
</style>
</head>
<body>
<div class="header">
  <div style="width:32px;height:32px;border-radius:8px;background:#e53e3e;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0">P</div>
  <div><div class="ht">Pulse <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:4px">Equipe</span></div><div class="hs">${ativos.length} ativos${pendentes.length ? ` · ${pendentes.length} pendente${pendentes.length>1?'s':''}` : ''}</div></div>
  <div class="hr">
    <a href="/api/banco-horas" class="btn-sm" style="background:#1a2744;border-color:#2a4080;color:#63b3ed">📊 Banco de horas</a>
    <a href="/api/app" class="btn-sm">← Voltar</a>
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" style="font-size:14px;padding:3px 8px">🌙</button>
  </div>
</div>

<div class="wrap">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 20px;margin-bottom:20px;display:flex;gap:24px;flex-wrap:wrap">
    <div style="text-align:center"><div style="font-size:26px;font-weight:700">${ativos.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Ativos</div></div>
    <div style="width:1px;background:var(--border)"></div>
    <div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#92400e">${gestores.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Gestores</div></div>
    <div style="width:1px;background:var(--border)"></div>
    <div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#1d4ed8">${colaboradores.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Colaboradores</div></div>
    <div style="width:1px;background:var(--border)"></div>
    <div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#d97706">${pendentes.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Pendentes</div></div>
  </div>

  ${renderSolicitacoes()}

  <!-- Barra de filtros e busca -->
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    <input id="eq-busca" oninput="filtrarEquipe()" placeholder="🔍 Buscar por nome, cargo ou e-mail..." style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
    <select id="eq-ord" onchange="filtrarEquipe()" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--bg2);color:var(--text);outline:none;cursor:pointer">
      <option value="nome">A → Z</option>
      <option value="cargo">Por cargo</option>
      <option value="tipo">Por contrato</option>
    </select>
    <div style="display:flex;gap:4px">
      <button id="btn-grid-view" onclick="setView('grid')" title="Grade" style="border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:var(--text);color:var(--bg);cursor:pointer;font-size:13px;line-height:1">⊞</button>
      <button id="btn-list-view" onclick="setView('list')" title="Lista" style="border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:none;color:var(--text2);cursor:pointer;font-size:13px;line-height:1">☰</button>
    </div>
  </div>

  ${pendentes.length ? `
  <div class="section-title">
    <span style="background:#d97706;color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px">${pendentes.length}</span>
    Aguardando aprovação de acesso
  </div>
  <div class="grid">${pendentes.map(cardPendente).join('')}</div>` : ''}

  <div class="section-title" id="sec-gestores" style="${gestores.length ? '' : 'display:none'}">Gestores (<span id="cnt-gestores">${gestores.length}</span>)</div>
  <div class="grid" id="grid-gestores">
    ${gestores.map(m => `<div class="eq-card" data-nome="${esc(m.nome.toLowerCase())}" data-cargo="${esc((m.cargo||'').toLowerCase())}" data-email="${esc((m.email||'').toLowerCase())}" data-tipo="${esc(m.tipoContrato||'')}" data-perfil="gestor">${cardAtivo(m)}</div>`).join('')}
  </div>

  <div class="section-title" id="sec-colab">Colaboradores (<span id="cnt-colab">${colaboradores.length}</span>)</div>
  <div class="grid" id="grid-colab">
    ${colaboradores.length ? colaboradores.map(m => `<div class="eq-card" data-nome="${esc(m.nome.toLowerCase())}" data-cargo="${esc((m.cargo||'').toLowerCase())}" data-email="${esc((m.email||'').toLowerCase())}" data-tipo="${esc(m.tipoContrato||'')}" data-perfil="colaborador">${cardAtivo(m)}</div>`).join('') : '<div style="color:var(--text3);font-size:13px;padding:10px">Nenhum colaborador ativo.</div>'}
  </div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h3>Editar colaborador</h3>
    <input type="hidden" id="ed-linha">
    <div class="grid2">
      <div class="field" style="grid-column:1/-1"><label>Nome</label><input type="text" id="ed-nome"></div>
      <div class="field"><label>Cargo</label><input type="text" id="ed-cargo" placeholder="Ex: Operador"></div>
      <div class="field"><label>Núcleo</label><input type="text" id="ed-nucleo" placeholder="Ex: Central"></div>
      <div class="field"><label>Email</label><input type="email" id="ed-email"></div>
      <div class="field"><label>Telefone</label><input type="tel" id="ed-telefone"></div>
      <div class="field"><label>CPF</label><input type="text" id="ed-cpf"></div>
      <div class="field"><label>RG</label><input type="text" id="ed-rg"></div>
      <div class="field"><label>Data de nascimento</label><input type="text" id="ed-nascimento" placeholder="DD/MM/AAAA"></div>
      <div class="field" style="grid-column:1/-1"><label>Endereço</label><input type="text" id="ed-endereco"></div>
      <div class="field"><label>Tipo de contrato</label>
        <select id="ed-tipo-contrato">
          <option value="">Não definido</option>
          <option value="CLT">LIVE MODE (CLT)</option>
          <option value="PJ">PJ</option>
          <option value="Temporário">LET (Temporário)</option>
        </select>
      </div>
      <div class="field"><label>Perfil de acesso</label>
        <select id="ed-perfil"><option value="colaborador">Colaborador</option><option value="gestor">Gestor</option></select>
      </div>
    </div>
    <div class="modal-btns">
      <button class="btn-cancel" onclick="fecharModal()">Cancelar</button>
      <button class="btn-danger" onclick="removerMembro()">Remover</button>
      <button class="btn-primary" onclick="salvarEdicao()">Salvar</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
var _membrosData = ${membrosDataJson};
function abrirEditorById(linha){
  var m=_membrosData[linha];
  if(!m)return;
  document.getElementById('ed-linha').value=m.linha;
  document.getElementById('ed-nome').value=m.nome||'';
  document.getElementById('ed-cargo').value=m.cargo||'';
  document.getElementById('ed-nucleo').value=m.nucleo||'';
  document.getElementById('ed-perfil').value=m.perfil||'colaborador';
  document.getElementById('ed-email').value=m.email||'';
  document.getElementById('ed-cpf').value=m.cpf||'';
  document.getElementById('ed-rg').value=m.rg||'';
  document.getElementById('ed-nascimento').value=m.nascimento||'';
  document.getElementById('ed-endereco').value=m.endereco||'';
  document.getElementById('ed-telefone').value=m.telefone||'';
  document.getElementById('ed-tipo-contrato').value=m.tipoContrato||'';
  document.getElementById('modal').classList.add('open');
}
function fecharModal(){document.getElementById('modal').classList.remove('open');}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)fecharModal();});

async function post(body){
  const r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}
async function aprovar(linha){
  const perfil=document.getElementById('perfil-'+linha).value;
  const d=await post({acao:'aprovar',linha,perfil});
  if(d.ok){toast('Aprovado!');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}
async function rejeitar(linha){
  if(!confirm('Rejeitar este cadastro?'))return;
  const d=await post({acao:'rejeitar',linha});
  if(d.ok){toast('Rejeitado.');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}
async function salvarEdicao(){
  const d=await post({
    acao:'editar',
    linha:document.getElementById('ed-linha').value,
    nome:document.getElementById('ed-nome').value,
    cargo:document.getElementById('ed-cargo').value,
    nucleo:document.getElementById('ed-nucleo').value,
    perfil:document.getElementById('ed-perfil').value,
    email:document.getElementById('ed-email').value,
    cpf:document.getElementById('ed-cpf').value,
    rg:document.getElementById('ed-rg').value,
    nascimento:document.getElementById('ed-nascimento').value,
    endereco:document.getElementById('ed-endereco').value,
    telefone:document.getElementById('ed-telefone').value,
    tipoContrato:document.getElementById('ed-tipo-contrato').value,
  });
  if(d.ok){fecharModal();toast('Salvo!');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}
async function removerMembro(){
  if(!confirm('Remover este colaborador?'))return;
  const d=await post({acao:'remover',linha:document.getElementById('ed-linha').value});
  if(d.ok){fecharModal();toast('Removido!');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}
async function aprovarAusencia(id){
  const d=await post({acao:'aprovar-ausencia',id});
  if(d.ok){toast('Solicitação aprovada!');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}
async function recusarAusencia(id){
  if(!confirm('Recusar esta solicitação?'))return;
  const d=await post({acao:'recusar-ausencia',id});
  if(d.ok){toast('Solicitação recusada.');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}
function toast(msg,bg='#166534'){
  const t=document.getElementById('toast');t.textContent=msg;t.style.background=bg;t.style.display='block';
  setTimeout(()=>t.style.display='none',2500);
}

// ── Filtro, ordenação e toggle de visualização ───────────────────────────────
var _viewMode = localStorage.getItem('eq-view') || 'grid';
function setView(mode) {
  _viewMode = mode;
  localStorage.setItem('eq-view', mode);
  ['grid-gestores','grid-colab'].forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.classList.toggle('list-view', mode === 'list');
  });
  var bg = document.getElementById('btn-grid-view'), bl = document.getElementById('btn-list-view');
  if(bg) { bg.style.background = mode==='grid' ? 'var(--text)' : 'none'; bg.style.color = mode==='grid' ? 'var(--bg)' : 'var(--text2)'; }
  if(bl) { bl.style.background = mode==='list' ? 'var(--text)' : 'none'; bl.style.color = mode==='list' ? 'var(--bg)' : 'var(--text2)'; }
}
function filtrarEquipe() {
  var q = (document.getElementById('eq-busca').value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  var ord = document.getElementById('eq-ord').value;
  ['grid-gestores','grid-colab'].forEach(function(gridId) {
    var grid = document.getElementById(gridId);
    if(!grid) return;
    var cards = Array.from(grid.querySelectorAll('.eq-card'));
    var visivel = 0;
    cards.forEach(function(c) {
      var nome = c.getAttribute('data-nome')||'';
      var cargo = c.getAttribute('data-cargo')||'';
      var email = c.getAttribute('data-email')||'';
      var norm = function(s){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,''); };
      var match = !q || norm(nome).includes(q) || norm(cargo).includes(q) || norm(email).includes(q);
      c.style.display = match ? '' : 'none';
      if(match) visivel++;
    });
    // Ordenação
    var sortedCards = cards.filter(function(c){ return c.style.display !== 'none'; });
    sortedCards.sort(function(a,b){
      var va = a.getAttribute('data-'+ord)||'';
      var vb = b.getAttribute('data-'+ord)||'';
      return va.localeCompare(vb, 'pt-BR');
    });
    sortedCards.forEach(function(c){ grid.appendChild(c); });
    // Atualizar contador
    var cntId = gridId === 'grid-gestores' ? 'cnt-gestores' : 'cnt-colab';
    var secId = gridId === 'grid-gestores' ? 'sec-gestores' : 'sec-colab';
    var cnt = document.getElementById(cntId);
    var sec = document.getElementById(secId);
    if(cnt) cnt.textContent = visivel;
    if(sec) sec.style.display = visivel === 0 ? 'none' : '';
  });
}
// Inicializa estado
(function(){ setView(_viewMode); })();
</script>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
