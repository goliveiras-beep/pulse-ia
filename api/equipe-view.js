// api/equipe-view.js
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + process.env.PULSE_SECRET || 'pulse2026').digest('hex').slice(0,32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const[k,...v]=c.trim().split('=');cookies[k.trim()]=v.join('=');});
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const [nome,h,ts] = d.split('|');
    if (Date.now()-parseInt(ts) > 7*24*3600*1000) return null;
    if (h !== hash(nome+ts)) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}

function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const equipeRaw = await getSheet('Equipe!A2:I50');
  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  const ativos = equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo');
  const inativos = equipeRaw.filter(r=>r[0]&&r[6]==='Inativo');
  const atualizado = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

  function cardPessoa(r, idx) {
    const linha = idx+2;
    const nome=r[0]||'', cargo=r[1]||'', nucleo=r[2]||'', email=r[3]||'';
    const regime=r[5]||'', status=r[6]||'Ativo', temSenha=!!r[7], perfil=r[8]||'';
    const isGestor = perfil==='gestor';
    const inativo = status==='Inativo';
    return `
    <div data-nome-busca="${esc(nome)}" data-ordem="${idx}" style="background:#fff;border:1px solid ${inativo?'#e5e7eb':isGestor?'#dbeafe':'#e5e5e5'};border-radius:10px;padding:14px 16px;opacity:${inativo?'.6':'1'}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:36px;height:36px;border-radius:50%;background:${isGestor?'#dbeafe':inativo?'#f3f4f6':'#f0fdf4'};color:${isGestor?'#1d4ed8':inativo?'#9ca3af':'#16a34a'};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nome)}</div>
          <div style="font-size:11px;color:#888">${esc(cargo)||'&mdash;'} &middot; ${esc(nucleo)||'&mdash;'}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${isGestor?'<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">Gestor</span>':''}
          ${inativo?'<span style="background:#f3f4f6;color:#9ca3af;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">Inativo</span>':''}
          ${!temSenha?'<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">Sem senha</span>':''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;color:#888;margin-bottom:10px">
        ${email?`<div>Email: ${esc(email)}</div>`:''}
        ${regime?`<div>Regime: ${esc(regime)}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-editar" data-linha="${linha}" data-nome="${esc(nome)}" data-cargo="${esc(cargo)}" data-nucleo="${esc(nucleo)}" data-email="${esc(email)}" data-regime="${esc(regime)}" data-status="${esc(status)}" data-perfil="${esc(perfil)}" style="flex:1;background:none;border:1px solid #e5e5e5;border-radius:6px;padding:5px 0;font-size:11px;cursor:pointer;color:#555">Editar</button>
        ${temSenha?`<button class="btn-resetar" data-linha="${linha}" data-nome="${esc(nome)}" style="flex:1;background:none;border:1px solid #fcd34d;border-radius:6px;padding:5px 0;font-size:11px;cursor:pointer;color:#92400e">Resetar senha</button>`:''}
        ${inativo
          ?`<button class="btn-reativar" data-linha="${linha}" data-nome="${esc(nome)}" style="flex:1;background:none;border:1px solid #86efac;border-radius:6px;padding:5px 0;font-size:11px;cursor:pointer;color:#16a34a">Reativar</button>
            <button class="btn-remover" data-linha="${linha}" data-nome="${esc(nome)}" data-definitivo="true" style="flex:1;background:none;border:1px solid #fca5a5;border-radius:6px;padding:5px 0;font-size:11px;cursor:pointer;color:#dc2626">Excluir</button>`
          :`<button class="btn-remover" data-linha="${linha}" data-nome="${esc(nome)}" data-definitivo="false" style="flex:1;background:none;border:1px solid #fca5a5;border-radius:6px;padding:5px 0;font-size:11px;cursor:pointer;color:#dc2626">Desativar</button>`
        }
      </div>
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Equipe</title>
<style>
:root{
--bg:#f5f5f5;--bg2:#fff;--bg3:#fafafa;--border:#e5e5e5;--border2:#f0f0f0;
--text:#1a1a1a;--text2:#555;--text3:#888;--text4:#aaa;
--header:#1a1a1a;--logo-bg:#fff;--logo-c:#1a1a1a;
--card:#fff;--input:#fff;--modal:#fff;
--th:#fafafa;--th-c:#888;--th-border:#f0f0f0;--td-border:#f5f5f5;
--btn-border:#444;--btn-c:#ccc;
--blue-m-bg:#eff6ff;--blue-m-border:#dbeafe;--blue-m-v:#1d4ed8;
--red-m-bg:#fef2f2;--red-m-border:#fca5a5;--red-m-v:#dc2626;
--amber-m-bg:#fffbeb;--amber-m-border:#fcd34d;--amber-m-v:#d97706;
--badge-blue-bg:#dbeafe;--badge-blue-c:#1d4ed8;
--badge-green-bg:#dcfce7;--badge-green-c:#166534;
--badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
--badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
--badge-gray-bg:#f3f4f6;--badge-gray-c:#6b7280;
--today-bg:#eff6ff;--today-border:#3b82f6;--today-c:#1d4ed8;
}
html.dark{
--bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--border:#2d3748;--border2:#2d3748;
--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
--header:#161920;--logo-bg:#2d3748;--logo-c:#e2e8f0;
--card:#242836;--input:#2d3140;--modal:#242836;
--th:#1e2230;--th-c:#718096;--th-border:#2d3748;--td-border:#252a38;
--btn-border:#3d4660;--btn-c:#a0aec0;
--blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;
--red-m-bg:#1f1010;--red-m-border:#3d2020;--red-m-v:#fc8181;
--amber-m-bg:#1f1a0d;--amber-m-border:#3d3010;--amber-m-v:#f6ad55;
--badge-blue-bg:#1a2744;--badge-blue-c:#63b3ed;
--badge-green-bg:#0d2010;--badge-green-c:#68d391;
--badge-red-bg:#1f1010;--badge-red-c:#fc8181;
--badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
--badge-gray-bg:#2d3140;--badge-gray-c:#a0aec0;
--today-bg:#1a2744;--today-border:#2a4080;--today-c:#63b3ed;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
.field{margin-bottom:12px}
.field label{display:block;font-size:11px;color:var(--text2);font-weight:600;margin-bottom:4px}
.field input,.field select{width:100%;border:1px solid var(--border);border-radius:7px;padding:8px 10px;font-size:13px;outline:none;background:var(--input);color:var(--text)}
.field input:focus,.field select:focus{border-color:#3b82f6;box-shadow:0 0 0 2px #dbeafe}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:flex-start;justify-content:center;padding-top:40px;overflow-y:auto}
.modal-bg.open{display:flex}
.modal{background:var(--modal);border-radius:12px;padding:22px;width:100%;max-width:460px;margin:0 16px 40px;color:var(--text)}
.modal h3{font-size:15px;font-weight:600;margin-bottom:16px}
.btn-primary{background:#1d4ed8;color:#fff;border:none;border-radius:7px;padding:8px 18px;font-size:13px;cursor:pointer;font-weight:600}
.btn-cancel{background:none;border:1px solid var(--border);border-radius:7px;padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text2)}
.toast{position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;z-index:300;display:none;max-width:300px;color:#fff}
.secao-titulo{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 10px;display:flex;align-items:center;gap:8px}
</style>
</head><body>

<div style="background:#1a1a1a;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100">
  <a href="/api/app" style="width:28px;height:28px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;font-size:12px;font-weight:700;flex-shrink:0;text-decoration:none">P</a>
  <div>
    <div style="font-size:14px;font-weight:600;color:#fff">Pulse - Equipe</div>
    <div style="font-size:11px;color:#666">${ativos.length} ativos &middot; ${inativos.length} inativos &middot; ${atualizado}</div>
  </div>
  <div style="margin-left:auto;display:flex;gap:8px">
    <button id="btn-adicionar" style="background:#fff;color:#1a1a1a;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600">+ Adicionar</button>
    <a href="/api/app" style="background:none;border:1px solid #444;border-radius:5px;padding:5px 10px;font-size:11px;color:#ccc;text-decoration:none">&#127968; Home</a>
    <button id="tt" class="btn-sm" onclick="toggleTheme()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <a href="/api/app" style="background:none;border:1px solid var(--btn-border);border-radius:5px;padding:5px 10px;font-size:11px;color:var(--btn-c);text-decoration:none">&#8592; Voltar</a>
  </div>
</div>

<div style="max-width:1100px;margin:0 auto;padding:16px 20px">

  <!-- Barra de filtros -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <div style="display:flex;gap:4px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:3px">
      <button id="view-grid" title="Quadradinhos" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer">⊞</button>
      <button id="view-list" title="Lista" style="background:none;color:#888;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer">☰</button>
    </div>
    <div style="display:flex;gap:4px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:3px">
      <button id="sort-default" title="Ordem original" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600">Padrão</button>
      <button id="sort-alpha" title="Ordem alfabética" style="background:none;color:#888;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600">A→Z</button>
    </div>
    <input id="busca" placeholder="Buscar colaborador..." style="flex:1;min-width:160px;border:1px solid #e5e5e5;border-radius:8px;padding:7px 12px;font-size:12px;outline:none">
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Total ativo</div>
      <div style="font-size:26px;font-weight:700">${ativos.length}</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">colaboradores</div>
    </div>
    <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#1d4ed8;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Gestores</div>
      <div style="font-size:26px;font-weight:700;color:#1d4ed8">${ativos.filter(r=>r[8]==='gestor').length}</div>
      <div style="font-size:10px;color:#93c5fd;margin-top:2px">com acesso gestor</div>
    </div>
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Sem senha</div>
      <div style="font-size:26px;font-weight:700;color:#d97706">${equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo'&&!r[7]).length}</div>
      <div style="font-size:10px;color:#fbbf24;margin-top:2px">primeiro acesso pendente</div>
    </div>
    <div style="background:${inativos.length>0?'#f9fafb':'#fff'};border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Inativos</div>
      <div style="font-size:26px;font-weight:700;color:#9ca3af">${inativos.length}</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">desativados</div>
    </div>
  </div>

  <div class="secao-titulo">
    <span>Equipe ativa</span>
    <span id="count-ativos" style="background:#f0fdf4;color:#16a34a;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600">${ativos.length}</span>
  </div>
  <div id="grid-ativos" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
    ${ativos.map(r=>cardPessoa(r, equipeRaw.indexOf(r))).join('')}
  </div>

  ${inativos.length>0?`
  <div class="secao-titulo">
    <span>Inativos</span>
    <span style="background:#f3f4f6;color:#6b7280;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600">${inativos.length}</span>
  </div>
  <div id="grid-inativos" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
    ${inativos.map(r=>cardPessoa(r, equipeRaw.indexOf(r))).join('')}
  </div>`:''}
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h3 id="modal-titulo">Adicionar colaborador</h3>
    <input type="hidden" id="f-linha">
    <input type="hidden" id="f-action" value="adicionar">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field" style="grid-column:1/-1"><label>Nome completo *</label><input id="f-nome" placeholder="Ex: Joao Silva"></div>
      <div class="field"><label>Cargo</label><input id="f-cargo" placeholder="Ex: Operador"></div>
      <div class="field"><label>Nucleo</label><input id="f-nucleo" placeholder="Ex: Operacoes" value="Operacoes"></div>
      <div class="field" style="grid-column:1/-1"><label>E-mail</label><input id="f-email" type="email" placeholder="nome@livemode.com"></div>
      <div class="field"><label>Regime</label>
        <select id="f-regime">
          <option value="">--</option>
          <option value="CLT">CLT</option>
          <option value="PJ">PJ</option>
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select id="f-status">
          <option value="Ativo">Ativo</option>
          <option value="Inativo">Inativo</option>
        </select>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Perfil de acesso</label>
        <select id="f-perfil">
          <option value="">Colaborador (visao propria)</option>
          <option value="gestor">Gestor (visao completa + edicao)</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn-cancel" id="btn-cancelar">Cancelar</button>
      <button class="btn-primary" id="btn-salvar">Salvar</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function abrirAdicionar(){
  document.getElementById('modal-titulo').textContent='Adicionar colaborador';
  document.getElementById('f-action').value='adicionar';
  document.getElementById('f-linha').value='';
  document.getElementById('f-nome').value='';
  document.getElementById('f-cargo').value='';
  document.getElementById('f-nucleo').value='Operacoes';
  document.getElementById('f-email').value='';
  document.getElementById('f-regime').value='';
  document.getElementById('f-status').value='Ativo';
  document.getElementById('f-perfil').value='';
  document.getElementById('modal').classList.add('open');
}

function abrirEditar(d){
  document.getElementById('modal-titulo').textContent='Editar colaborador';
  document.getElementById('f-action').value='editar';
  document.getElementById('f-linha').value=d.linha;
  document.getElementById('f-nome').value=d.nome;
  document.getElementById('f-cargo').value=d.cargo;
  document.getElementById('f-nucleo').value=d.nucleo;
  document.getElementById('f-email').value=d.email;
  document.getElementById('f-regime').value=d.regime;
  document.getElementById('f-status').value=d.status;
  document.getElementById('f-perfil').value=d.perfil;
  document.getElementById('modal').classList.add('open');
}

function fecharModal(){ document.getElementById('modal').classList.remove('open'); }

async function salvar(){
  const action=document.getElementById('f-action').value;
  const body={
    action,
    linha:document.getElementById('f-linha').value,
    nome:document.getElementById('f-nome').value.trim(),
    cargo:document.getElementById('f-cargo').value.trim(),
    nucleo:document.getElementById('f-nucleo').value.trim(),
    email:document.getElementById('f-email').value.trim(),
    regime:document.getElementById('f-regime').value,
    status:document.getElementById('f-status').value,
    perfil:document.getElementById('f-perfil').value,
  };
  if(!body.nome){toast('Nome e obrigatorio','#dc2626');return;}
  const r=await fetch('/api/equipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.ok){fecharModal();toast(d.msg);setTimeout(function(){location.reload();},1000);}
  else toast(d.error,'#dc2626');
}

async function remover(linha,nome,definitivo){
  const msg=definitivo?('Excluir '+nome+' permanentemente?'):('Desativar '+nome+'?');
  if(!confirm(msg)) return;
  const r=await fetch('/api/equipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remover',linha:linha,nome:nome,definitivo:definitivo})});
  const d=await r.json();
  if(d.ok){toast(d.msg);setTimeout(function(){location.reload();},1000);}
  else toast(d.error,'#dc2626');
}

async function reativar(linha,nome){
  const r=await fetch('/api/equipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reativar',linha:linha,nome:nome})});
  const d=await r.json();
  if(d.ok){toast(d.msg);setTimeout(function(){location.reload();},1000);}
  else toast(d.error,'#dc2626');
}

async function resetarSenha(linha,nome){
  if(!confirm('Resetar a senha de '+nome+'?')) return;
  const r=await fetch('/api/equipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resetar-senha',linha:linha,nome:nome})});
  const d=await r.json();
  if(d.ok){toast(d.msg);setTimeout(function(){location.reload();},800);}
  else toast(d.error,'#dc2626');
}

function toast(msg,bg){
  bg=bg||'#1a1a1a';
  var t=document.getElementById('toast');
  t.textContent=msg;t.style.background=bg;t.style.display='block';
  setTimeout(function(){t.style.display='none';},2800);
}

// Filtros
var viewAtual = 'grid';
var sortAtual = 'default';

function aplicarFiltros(){
  var busca = document.getElementById('busca').value.toLowerCase();
  var grids = ['grid-ativos','grid-inativos'];
  grids.forEach(function(gid){
    var grid = document.getElementById(gid);
    if(!grid) return;
    var cards = Array.from(grid.querySelectorAll('[data-nome-busca]'));

    // Filtrar por busca
    cards.forEach(function(c){
      var nome = c.getAttribute('data-nome-busca').toLowerCase();
      c.style.display = nome.includes(busca) ? '' : 'none';
    });

    // Ordenar
    var visiveis = cards.filter(function(c){ return c.style.display !== 'none'; });
    if(sortAtual === 'alpha'){
      visiveis.sort(function(a,b){
        return a.getAttribute('data-nome-busca').localeCompare(b.getAttribute('data-nome-busca'),'pt-BR');
      });
      visiveis.forEach(function(c){ grid.appendChild(c); });
    } else {
      visiveis.sort(function(a,b){
        return parseInt(a.getAttribute('data-ordem')) - parseInt(b.getAttribute('data-ordem'));
      });
      visiveis.forEach(function(c){ grid.appendChild(c); });
    }

    // Aplicar modo de exibição
    if(viewAtual === 'grid'){
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(260px,1fr))';
      grid.style.gap = '12px';
      cards.forEach(function(c){ c.style.width=''; });
    } else {
      grid.style.display = 'flex';
      grid.style.flexDirection = 'column';
      grid.style.gap = '6px';
      cards.forEach(function(c){ c.style.width='100%'; });
    }
  });
}

document.getElementById('view-grid').addEventListener('click',function(){
  viewAtual='grid';
  this.style.background='#1a1a1a';this.style.color='#fff';
  document.getElementById('view-list').style.background='none';document.getElementById('view-list').style.color='#888';
  aplicarFiltros();
});
document.getElementById('view-list').addEventListener('click',function(){
  viewAtual='list';
  this.style.background='#1a1a1a';this.style.color='#fff';
  document.getElementById('view-grid').style.background='none';document.getElementById('view-grid').style.color='#888';
  aplicarFiltros();
});
document.getElementById('sort-alpha').addEventListener('click',function(){
  sortAtual='alpha';
  this.style.background='#1a1a1a';this.style.color='#fff';
  document.getElementById('sort-default').style.background='none';document.getElementById('sort-default').style.color='#888';
  aplicarFiltros();
});
document.getElementById('sort-default').addEventListener('click',function(){
  sortAtual='default';
  this.style.background='#1a1a1a';this.style.color='#fff';
  document.getElementById('sort-alpha').style.background='none';document.getElementById('sort-alpha').style.color='#888';
  aplicarFiltros();
});
document.getElementById('busca').addEventListener('input',aplicarFiltros);

document.getElementById('btn-adicionar').addEventListener('click',abrirAdicionar);
document.getElementById('btn-cancelar').addEventListener('click',fecharModal);
document.getElementById('btn-salvar').addEventListener('click',salvar);
document.getElementById('modal').addEventListener('click',function(e){if(e.target===e.currentTarget)fecharModal();});

document.querySelectorAll('.btn-editar').forEach(function(btn){
  btn.addEventListener('click',function(){
    abrirEditar({
      linha:this.dataset.linha,
      nome:this.dataset.nome,
      cargo:this.dataset.cargo,
      nucleo:this.dataset.nucleo,
      email:this.dataset.email,
      regime:this.dataset.regime,
      status:this.dataset.status,
      perfil:this.dataset.perfil
    });
  });
});

document.querySelectorAll('.btn-remover').forEach(function(btn){
  btn.addEventListener('click',function(){
    remover(this.dataset.linha, this.dataset.nome, this.dataset.definitivo==='true');
  });
});

document.querySelectorAll('.btn-reativar').forEach(function(btn){
  btn.addEventListener('click',function(){
    reativar(this.dataset.linha, this.dataset.nome);
  });
});

document.querySelectorAll('.btn-resetar').forEach(function(btn){
  btn.addEventListener('click',function(){
    resetarSenha(this.dataset.linha, this.dataset.nome);
  });
});
</script>
<script>
function toggleTheme(){
  var dk=document.documentElement.classList.toggle('dark');
  localStorage.setItem('pulse-theme',dk?'dark':'light');
  var btn=document.getElementById('tt');
  if(btn) btn.textContent=dk?'\u2600\uFE0F':'\uD83C\uDF19';
}
</script>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
