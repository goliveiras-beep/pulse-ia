// api/repositorio.js – Central de Conhecimento — Gestão completa de documentos
export const config = { maxDuration: 30 };
import { createSign, createHash } from 'crypto';
import { sheetsRequest } from '../google-auth.js';

const COOKIE_NAME  = 'pulse_session';
const COOKIE_MAX   = 60 * 60 * 24 * 7;
const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const REPO_ROOT    = process.env.PULSE_REPOSITORY_FOLDER_ID || '1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f';
const CFG_RANGE    = 'RepositorioConfig!A2:B50';

// Pastas raiz da Central de Conhecimento
const PASTA_DEFS = [
  { id: REPO_ROOT,                            label: 'Raiz',                       slack: '#docs-geral'       },
  { id: '1I7hi9lszj4q6lfIz3pdy0VOSbD7IXt26', label: 'Diagramacao',                slack: '#docs-diagramacao' },
  { id: '1UqTP1DBXLHjPM4xpuiQPLq1jwAaq6pBs', label: 'Comunicados',                slack: '#docs-comunicados' },
  { id: '18NyogisGSmy5f6pq_kfuWZukajRYWvdY', label: 'Fluxogramas Operacionais',   slack: '#docs-fluxogramas' },
  { id: '1-nlWVPSK2rgCCxGO0uah78yLSotdKh27', label: 'Politicas e Procedimentos',  slack: '#docs-politicas'   },
  { id: '1TY1NNqvs32pbwVgCn4yhMia0xXUv2JRs', label: 'Arquivo Geral',              slack: '#docs-geral'       },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function hash(s) { return createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function normalizar(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function fmtData(iso) { if(!iso)return''; try{return new Date(iso).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});}catch{return'';} }
function tipoArquivo(m) { m=m||''; if(m.includes('folder'))return'Pasta'; if(m.includes('document'))return'Documento'; if(m.includes('spreadsheet'))return'Planilha'; if(m.includes('presentation'))return'Apresentação'; if(m.includes('pdf'))return'PDF'; if(m.includes('image'))return'Imagem'; return'Arquivo'; }
function icone(tipo) { const map={'Pasta':'📁','Planilha':'📊','Apresentação':'📈','PDF':'📄','Imagem':'🖼️','Documento':'📝'}; return map[tipo]||'📄'; }
function base64url(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function parseCookies(h) { const c={}; (h||'').split(';').forEach(x=>{const p=x.trim().split('=');c[p.shift()]=p.join('=');}); return c; }

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if(!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const last=d.lastIndexOf('|'), sec=d.lastIndexOf('|',last-1);
    const data=d.slice(0,sec), h=d.slice(sec+1,last), ts=d.slice(last+1);
    if(Date.now()-parseInt(ts,10)>COOKIE_MAX*1000) return null;
    if(h!==hash(data+ts)) return null;
    if(data.startsWith('~~OAUTH~~')) return null;
    return { nome: data.split('~~')[0] };
  } catch { return null; }
}

// ── Google Drive Auth (scope completo para gestores) ──────────────────────────
async function getDriveToken(readOnly=false) {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now()/1000);
  const scope = readOnly ? 'https://www.googleapis.com/auth/drive.readonly' : 'https://www.googleapis.com/auth/drive';
  const hdr = base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const pay = base64url(JSON.stringify({iss:sa.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const { createSign } = await import('crypto');
  const s = createSign('RSA-SHA256'); s.update(hdr+'.'+pay);
  const sig = s.sign(sa.private_key,'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+hdr+'.'+pay+'.'+sig});
  const d = await r.json();
  if(!d.access_token) throw new Error('Drive token error: '+JSON.stringify(d));
  return d.access_token;
}

// ── Operações Drive ────────────────────────────────────────────────────────────
async function driveList(parentId, token) {
  const params = new URLSearchParams({q:`'${parentId}' in parents and trashed = false`,pageSize:'200',orderBy:'folder,name',fields:'files(id,name,mimeType,webViewLink,modifiedTime,size,parents)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  const r = await fetch('https://www.googleapis.com/drive/v3/files?'+params,{headers:{Authorization:'Bearer '+token}});
  const d = await r.json();
  if(d.error) throw new Error(JSON.stringify(d.error));
  return (d.files||[]).map(f=>({id:f.id,nome:f.name,tipo:tipoArquivo(f.mimeType),mimeType:f.mimeType,link:f.webViewLink||`https://drive.google.com/file/d/${f.id}/view`,atualizadoEm:f.modifiedTime||'',tamanho:f.size||''}));
}

async function driveGetMeta(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,parents&supportsAllDrives=true`,{headers:{Authorization:'Bearer '+token}});
  return r.json();
}

async function driveCreateFolder(parentId, nome, token) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:nome,mimeType:'application/vnd.google-apps.folder',parents:[parentId]})});
  const d = await r.json();
  if(d.error) throw new Error(JSON.stringify(d.error));
  return d;
}

async function driveRename(fileId, novoNome, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:novoNome})});
  const d = await r.json();
  if(d.error) throw new Error(JSON.stringify(d.error));
  return d;
}

async function driveDelete(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
  if(r.status!==204 && r.status!==200) { const t=await r.text(); throw new Error(t); }
  return true;
}

// ── Config de visibilidade ─────────────────────────────────────────────────────
async function lerOcultos() {
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(CFG_RANGE)}`);
    const s = new Set();
    (d.values||[]).forEach(r=>{ if(r[1]==='1') s.add(r[0]); });
    return s;
  } catch { return new Set(); }
}
async function salvarOculto(folderId, oculto) {
  const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(CFG_RANGE)}`);
  const rows = d.values||[];
  const idx = rows.findIndex(r=>r[0]===folderId);
  if(idx>=0) {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`RepositorioConfig!B${idx+2}`)}?valueInputOption=USER_ENTERED`,'PUT',{values:[[oculto?'1':'0']]});
  } else {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('RepositorioConfig!A:B')}:append?valueInputOption=USER_ENTERED`,'POST',{values:[[folderId,oculto?'1':'0']]});
  }
}

// ── Breadcrumb: monta caminho até a pasta ──────────────────────────────────────
async function buildBreadcrumb(folderId, token) {
  const crumbs = [];
  let cur = folderId;
  for(let i=0; i<8; i++) {
    if(!cur || cur===REPO_ROOT) { crumbs.unshift({id:REPO_ROOT,nome:'Central de Conhecimento'}); break; }
    const meta = await driveGetMeta(cur, token);
    if(meta.error) break;
    crumbs.unshift({id:meta.id,nome:meta.name});
    cur = (meta.parents||[])[0];
  }
  return crumbs;
}

// ── HTML ───────────────────────────────────────────────────────────────────────
function renderPage({ session, arquivos, breadcrumb, currentId, isGestor, pastaDefs, ocultos, q }) {
  const raizChips = [{id:'todos',label:'Todos'}].concat(
    pastaDefs.filter(p=>isGestor||!ocultos.has(p.id)).map(f=>({id:f.id,label:f.label}))
  );

  const isBrowsing = currentId && currentId !== 'todos' && currentId !== 'busca';
  const isSearch   = currentId === 'busca' && q;

  // Bloco de gerenciamento (só gestor, só ao navegar dentro de uma pasta)
  const gestaoBtns = (isGestor && isBrowsing) ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button onclick="openNovaPassta()" style="border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;background:#1d4ed8;color:#fff;cursor:pointer">📁 Nova pasta</button>
      <a href="https://drive.google.com/drive/folders/${esc(currentId)}" target="_blank" style="border:1px solid var(--border);border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;color:var(--text);text-decoration:none;display:inline-flex;align-items:center;gap:4px">🔗 Abrir no Drive</a>
    </div>` : '';

  // Lista de arquivos / pastas
  const rows = arquivos.length ? arquivos.map(a => {
    const isFolder = a.tipo === 'Pasta';
    const atuDiv = `<div class="doc-date">${esc(fmtData(a.atualizadoEm))}</div>`;
    const gestoAcoes = isGestor ? `
      <div class="acoes-col">
        <button onclick="renomearItem('${esc(a.id)}','${esc(a.nome).replace(/'/g,"\\'")}',${isFolder})" title="Renomear" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 7px;font-size:11px;color:var(--muted);cursor:pointer">✏️</button>
        <button onclick="excluirItem('${esc(a.id)}','${esc(a.nome).replace(/'/g,"\\'")}',${isFolder})" title="Excluir" style="background:none;border:1px solid #dc2626;border-radius:5px;padding:3px 7px;font-size:11px;color:#dc2626;cursor:pointer">🗑️</button>
      </div>` : '';
    const href = isFolder ? `/api/repositorio?fid=${encodeURIComponent(a.id)}` : esc(a.link);
    const target = isFolder ? '_self' : '_blank';
    return `
      <div class="doc-row">
        <a class="doc-link" href="${href}" ${isFolder?'':'rel="noopener"'} target="${target}">
          <div class="doc-ic">${icone(a.tipo)}</div>
          <div class="doc-main">
            <div class="doc-title">${esc(a.nome)}</div>
            <div class="doc-meta">${esc(a.tipo)}${a.tamanho?' · '+Math.round(a.tamanho/1024)+'KB':''}</div>
          </div>
          ${atuDiv}
        </a>
        ${gestoAcoes}
      </div>`;
  }).join('') : `<div class="empty">Nenhum item encontrado${isSearch?' para "'+esc(q)+'"':''}.</div>`;

  // Painel de visibilidade (só gestor, só na raiz/busca geral)
  const painelVisib = (isGestor && !isBrowsing) ? `
    <div class="card-bloco" style="margin-bottom:14px">
      <div class="bloco-header" onclick="toggleVisib()" style="cursor:pointer;user-select:none">
        <span>🔒 Visibilidade das pastas</span>
        <span style="font-size:11px;color:var(--muted);font-weight:400">Só gestores veem · clique para expandir</span>
        <span id="visib-chevron" style="margin-left:auto">▼</span>
      </div>
      <div id="visib-panel" style="display:none;margin-top:12px;display:flex;flex-direction:column;gap:6px">
        ${PASTA_DEFS.map(p=>{
          const oculta = ocultos.has(p.id);
          return `<div class="visib-row ${oculta?'row-oculta':'row-visivel'}">
            <span class="visib-ic">${oculta?'🔒':'👁️'}</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${esc(p.label)}</div>
              <div style="font-size:10px;color:var(--muted)">${esc(p.slack)}</div>
            </div>
            <span class="badge-estado" style="color:${oculta?'#dc2626':'#16a34a'}">${oculta?'Oculta para a equipe':'Visível para a equipe'}</span>
            <button onclick="togglePasta('${esc(p.id)}',${oculta?0:1})" class="btn-toggle ${oculta?'btn-mostrar':'btn-ocultar'}">${oculta?'Mostrar':'Ocultar'}</button>
          </div>`;
        }).join('')}
        <div id="config-msg" style="display:none;font-size:12px;text-align:center;padding:6px 10px;border-radius:6px;margin-top:4px"></div>
      </div>
    </div>` : '';

  const breadcrumbHtml = (isBrowsing && breadcrumb.length) ? `
    <nav style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:12px;font-size:12px">
      ${breadcrumb.map((b,i)=>{
        const isLast = i===breadcrumb.length-1;
        return isLast
          ? `<span style="font-weight:700;color:var(--text)">${esc(b.nome)}</span>`
          : `<a href="/api/repositorio?fid=${encodeURIComponent(b.id)}" style="color:var(--blue);text-decoration:none">${esc(b.nome)}</a><span style="color:var(--muted)"> / </span>`;
      }).join('')}
    </nav>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central de Conhecimento — Pulse</title>
<style>
:root{--bg:#f5f5f5;--bg2:#fff;--card:#fff;--text:#1a1a1a;--muted:#777;--border:#e5e5e5;--header:#161920;--blue:#1d4ed8;--chip-bg:#fff;--chip-c:#555;--chip-border:#e5e5e5;--doc-hover:#f8fafc;--input-bg:#fff;--input-border:#e0e0e0;}
html.dark{--bg:#1c1f26;--bg2:#242836;--card:#242836;--text:#e2e8f0;--muted:#718096;--border:#2d3748;--header:#0f1117;--blue:#63b3ed;--chip-bg:#242836;--chip-c:#a0aec0;--chip-border:#2d3748;--doc-hover:#2d3140;--input-bg:#2d3140;--input-border:#3d4660;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,.06)}
.logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:10px;color:#778}
.hr{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn-header{border:1px solid #3d4660;border-radius:6px;padding:5px 10px;font-size:11px;color:#cbd5e1;background:none;cursor:pointer;text-decoration:none}
.wrap{max-width:1100px;margin:0 auto;padding:20px}
.top-bar{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.top-info .title{font-size:22px;font-weight:800;color:var(--text)}
.top-info .sub{font-size:12px;color:var(--muted);margin-top:4px}
.search-form{margin-left:auto;display:flex;gap:8px;min-width:300px}
.search-form input{flex:1;border:1px solid var(--input-border);border-radius:8px;padding:9px 12px;font-size:13px;background:var(--input-bg);color:var(--text);outline:none;transition:border .15s}
.search-form input:focus{border-color:var(--blue)}
.search-form button{border:none;border-radius:8px;background:var(--blue);color:#fff;padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.chip{border:1px solid var(--chip-border);border-radius:999px;padding:5px 12px;background:var(--chip-bg);font-size:12px;color:var(--chip-c);transition:all .15s;cursor:pointer}
.chip:hover{border-color:var(--blue);color:var(--blue)}
.chip.active{background:var(--text);color:var(--bg);border-color:var(--text)}
.card-bloco{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.bloco-header{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700}
.visib-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg2)}
.row-oculta{border-color:#fca5a5;background:rgba(220,38,38,.04)}
.visib-ic{font-size:18px;flex-shrink:0}
.badge-estado{font-size:11px;font-weight:600;flex-shrink:0}
.btn-toggle{border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0}
.btn-ocultar{background:#dc2626;color:#fff}
.btn-mostrar{background:#16a34a;color:#fff}
.grid{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.doc-row{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.doc-row:last-child{border-bottom:none}
.doc-link{display:grid;grid-template-columns:36px 1fr 90px;gap:10px;align-items:center;padding:10px 14px;flex:1;transition:background .1s}
.doc-link:hover{background:var(--doc-hover)}
.doc-ic{width:32px;height:32px;border-radius:7px;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.doc-title{font-size:13px;font-weight:600;color:var(--text)}
.doc-meta{font-size:11px;color:var(--muted);margin-top:2px}
.doc-date{font-size:11px;color:var(--muted);text-align:right;padding-right:4px}
.acoes-col{display:flex;gap:6px;padding-right:12px;flex-shrink:0}
.empty{padding:28px;text-align:center;color:var(--muted);font-size:13px}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 24px;width:380px;max-width:calc(100vw - 32px)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:12px}
.modal input{width:100%;border:1px solid var(--input-border);border-radius:8px;padding:9px 12px;font-size:13px;background:var(--input-bg);color:var(--text);outline:none;margin-bottom:12px}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
.modal-btns button{border:none;border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer}
.btn-cancel-m{background:var(--bg2);color:var(--text);border:1px solid var(--border)!important}
.btn-ok{background:var(--blue);color:#fff}
.btn-danger{background:#dc2626;color:#fff}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:300;display:none}
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:var(--text);text-decoration:none;white-space:nowrap}
.menu-item:hover{background:var(--bg2)}
@media(max-width:700px){.search-form{min-width:100%;margin-left:0}.doc-date{display:none}.wrap{padding:14px 12px}.top-bar{flex-direction:column}#repo-tempo-widget{display:none!important}}
</style>
</head>
<body>
<div class="header">
  <a class="logo" href="/api/app">P</a>
  <div><div class="ht">Central de Conhecimento</div><div class="hs">Documentos · Fluxos · Procedimentos</div></div>
  <div class="hr">
    <span class="hs" style="color:#aaa">Olá, ${esc(session.nome.split(' ')[0])}</span>
    ${isGestor ? `<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">Gestor</span>` : ''}
    <div id="repo-tempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="repo-tempo-icone">&#9203;</span>
      <span id="repo-tempo-temp" style="font-weight:700">--&deg;C</span>
      <span id="repo-tempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:#718096">BRT</span>
        <span id="repo-relogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <span id="repo-relogio-gmt" style="font-size:10px;font-weight:600;color:#4a5568;font-variant-numeric:tabular-nums"></span>
    </div>
    <button id="tt" class="btn-header" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'☀️':'🌙';})()" title="Tema">🌙</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-header" style="font-size:15px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Inicio</a>
        ${isGestor ? `
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausencias</a>
        ` : ''}
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        ${isGestor ? `<a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>` : ''}
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>
  </div>
</div>

<div class="wrap">
  <div class="top-bar">
    <div class="top-info">
      <div class="title">Central de Conhecimento</div>
      <div class="sub">Documentos oficiais, fluxos operacionais e procedimentos da equipe.</div>
    </div>
    <form class="search-form" method="GET" action="/api/repositorio">
      <input name="q" value="${esc(q)}" placeholder="Buscar documentos, fluxos, políticas...">
      <button>Buscar</button>
    </form>
  </div>

  <div class="chips">
    ${raizChips.map(c=>{
      const href = c.id==='todos' ? '/api/repositorio' : `/api/repositorio?fid=${encodeURIComponent(c.id)}`;
      const active = (!isBrowsing && !isSearch && c.id==='todos') || (currentId===c.id);
      return `<a class="chip ${active?'active':''}" href="${href}">${esc(c.label)}</a>`;
    }).join('')}
  </div>

  ${painelVisib}
  ${breadcrumbHtml}
  ${gestaoBtns}

  <div class="grid">${rows}</div>
  <div style="margin-top:10px;font-size:11px;color:var(--muted)">A IA usa esta base como fonte de consulta. Não altera nada diretamente — retorna documento, categoria e link.</div>
</div>

<!-- Modal nova pasta -->
<div class="modal-bg" id="modal-pasta">
  <div class="modal">
    <h3>📁 Nova pasta</h3>
    <input id="nova-pasta-nome" placeholder="Nome da pasta" maxlength="100">
    <div class="modal-btns">
      <button class="btn-cancel-m" onclick="closeModal('modal-pasta')">Cancelar</button>
      <button class="btn-ok" onclick="criarPasta()">Criar</button>
    </div>
  </div>
</div>

<!-- Modal renomear -->
<div class="modal-bg" id="modal-rename">
  <div class="modal">
    <h3>✏️ Renomear</h3>
    <input id="rename-input" placeholder="Novo nome" maxlength="200">
    <input type="hidden" id="rename-id">
    <div class="modal-btns">
      <button class="btn-cancel-m" onclick="closeModal('modal-rename')">Cancelar</button>
      <button class="btn-ok" onclick="confirmarRename()">Salvar</button>
    </div>
  </div>
</div>

<!-- Modal excluir -->
<div class="modal-bg" id="modal-excluir">
  <div class="modal">
    <h3>🗑️ Excluir</h3>
    <p id="excluir-msg" style="font-size:13px;color:var(--muted);margin-bottom:16px"></p>
    <input type="hidden" id="excluir-id">
    <div class="modal-btns">
      <button class="btn-cancel-m" onclick="closeModal('modal-excluir')">Cancelar</button>
      <button class="btn-danger" onclick="confirmarExcluir()">Excluir</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
function atualizarRelogio(){
  var now=new Date();
  var p=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now);
  var bh=p.find(function(x){return x.type==='hour';}).value,bm=p.find(function(x){return x.type==='minute';}).value,bs=p.find(function(x){return x.type==='second';}).value;
  var elBrt=document.getElementById('repo-relogio-brt');if(elBrt)elBrt.textContent=bh+':'+bm+':'+bs;
  var elGmt=document.getElementById('repo-relogio-gmt');if(elGmt)elGmt.textContent=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0');
}
async function carregarTempo(){
  try{
    var loc=null;
    try{var r1=await fetch('https://ipapi.co/json/');var j1=await r1.json();if(j1.latitude)loc={lat:j1.latitude,lon:j1.longitude,city:j1.city};}catch(e){}
    if(!loc)loc={lat:-22.9068,lon:-43.1729,city:'Rio de Janeiro'};
    var wd=await(await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')).json();
    var temp=wd.current&&wd.current.temperature_2m!==undefined?Math.round(wd.current.temperature_2m):'--';
    var icons={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',99:'⛈️'};
    document.getElementById('repo-tempo-icone').textContent=icons[wd.current&&wd.current.weathercode||0]||'🌡️';
    document.getElementById('repo-tempo-temp').textContent=temp+'°C';
    document.getElementById('repo-tempo-cidade').textContent=loc.city||'';
  }catch(e){document.getElementById('repo-tempo-temp').textContent='--°C';}
}
atualizarRelogio();carregarTempo();setInterval(atualizarRelogio,1000);
var currentFid = '${esc(currentId||'')}';

// ── Modais ───────────────────────────────────────────────────────────────────
function closeModal(id){document.getElementById(id).classList.remove('open');}
function openModal(id){document.getElementById(id).classList.add('open');}
document.querySelectorAll('.modal-bg').forEach(function(m){m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('open');});});

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg,ok){var t=document.getElementById('toast');t.textContent=msg;t.style.background=ok?'#0d2010':' #1f1010';t.style.color=ok?'#68d391':'#fc8181';t.style.display='block';setTimeout(function(){t.style.display='none';},2800);}

// ── Nova pasta ───────────────────────────────────────────────────────────────
function openNovaPassta(){document.getElementById('nova-pasta-nome').value='';openModal('modal-pasta');setTimeout(function(){document.getElementById('nova-pasta-nome').focus();},80);}
document.getElementById('nova-pasta-nome').addEventListener('keydown',function(e){if(e.key==='Enter')criarPasta();});
async function criarPasta(){
  var nome=document.getElementById('nova-pasta-nome').value.trim();
  if(!nome)return;
  closeModal('modal-pasta');
  try{
    var r=await fetch('/api/repositorio?action=createFolder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parentId:currentFid,nome})});
    var d=await r.json();
    if(d.ok){showToast('📁 Pasta criada!',true);setTimeout(function(){location.reload();},1000);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

// ── Renomear ─────────────────────────────────────────────────────────────────
function renomearItem(id,nome){
  document.getElementById('rename-id').value=id;
  document.getElementById('rename-input').value=nome;
  openModal('modal-rename');
  setTimeout(function(){document.getElementById('rename-input').focus();document.getElementById('rename-input').select();},80);
}
document.getElementById('rename-input').addEventListener('keydown',function(e){if(e.key==='Enter')confirmarRename();});
async function confirmarRename(){
  var id=document.getElementById('rename-id').value;
  var nome=document.getElementById('rename-input').value.trim();
  if(!nome)return;
  closeModal('modal-rename');
  try{
    var r=await fetch('/api/repositorio?action=rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId:id,nome})});
    var d=await r.json();
    if(d.ok){showToast('✏️ Renomeado!',true);setTimeout(function(){location.reload();},1000);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

// ── Excluir ──────────────────────────────────────────────────────────────────
function excluirItem(id,nome,isFolder){
  document.getElementById('excluir-id').value=id;
  document.getElementById('excluir-msg').textContent='Tem certeza que deseja excluir "'+nome+'"?'+(isFolder?' Isso remove a pasta e TODO o seu conteúdo.':'');
  openModal('modal-excluir');
}
async function confirmarExcluir(){
  var id=document.getElementById('excluir-id').value;
  closeModal('modal-excluir');
  try{
    var r=await fetch('/api/repositorio?action=delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId:id})});
    var d=await r.json();
    if(d.ok){showToast('🗑️ Excluído.',true);setTimeout(function(){location.reload();},1000);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

// ── Visibilidade ─────────────────────────────────────────────────────────────
function toggleVisib(){
  var p=document.getElementById('visib-panel');
  var c=document.getElementById('visib-chevron');
  if(p){p.style.display=p.style.display==='none'?'flex':'none';if(c)c.textContent=p.style.display==='none'?'▼':'▲';}
}
async function togglePasta(folderId,novoEstado){
  var msg=document.getElementById('config-msg');
  try{
    var r=await fetch('/api/repositorio?action=config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folderId,oculto:novoEstado===1})});
    var d=await r.json();
    if(d.ok){showToast(novoEstado===1?'🔒 Pasta ocultada!':'👁️ Pasta visível!',true);setTimeout(function(){location.reload();},900);}
    else showToast('Erro: '+(d.error||'?'),false);
  }catch(e){showToast('Erro de conexão',false);}
}

// ── Tema ─────────────────────────────────────────────────────────────────────
(function(){var dk=document.documentElement.classList.contains('dark');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'☀️':'🌙';})();
</script>
</body></html>`;
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const session = getSession(req);
  if(!session) return res.redirect(302, '/api/app');

  // Verificar perfil
  let isGestor = false;
  try {
    const eq = await sheetsRequest(SHEET_ID,'/values/Equipe!A2:I200').then(d=>d.values||[]);
    const u = eq.find(r=>r[0]===session.nome);
    isGestor = u?.[8]==='gestor' && (u?.[10]||'ativo')==='ativo';
  } catch {}

  const ocultos = await lerOcultos();

  // ── POST actions ──────────────────────────────────────────────────────────
  if(req.method==='POST') {
    if(!isGestor) return res.status(403).json({error:'Acesso negado'});
    const action = req.query.action;
    const body   = req.body||{};

    if(action==='config') {
      if(!body.folderId) return res.status(400).json({error:'folderId obrigatório'});
      await salvarOculto(body.folderId, !!body.oculto);
      return res.status(200).json({ok:true});
    }

    const token = await getDriveToken(false); // scope completo para write

    if(action==='createFolder') {
      if(!body.parentId||!body.nome) return res.status(400).json({error:'Campos obrigatórios'});
      const f = await driveCreateFolder(body.parentId, body.nome, token);
      return res.status(200).json({ok:true,id:f.id,nome:f.name});
    }
    if(action==='rename') {
      if(!body.fileId||!body.nome) return res.status(400).json({error:'Campos obrigatórios'});
      await driveRename(body.fileId, body.nome, token);
      return res.status(200).json({ok:true});
    }
    if(action==='delete') {
      if(!body.fileId) return res.status(400).json({error:'fileId obrigatório'});
      await driveDelete(body.fileId, token);
      return res.status(200).json({ok:true});
    }
    return res.status(400).json({error:'Ação inválida'});
  }

  if(req.method!=='GET') return res.status(405).end();

  // ── GET ───────────────────────────────────────────────────────────────────
  try {
    const q      = String(req.query.q||'').trim();
    const fid    = String(req.query.fid||'');

    const pastasVisiveis = PASTA_DEFS.filter(p=>isGestor||!ocultos.has(p.id));

    let arquivos=[], breadcrumb=[], currentId='todos';
    const token = await getDriveToken(true);

    if(q) {
      // Busca em todas as pastas visíveis
      currentId = 'busca';
      const termo = normalizar(q);
      for(const p of pastasVisiveis) {
        const items = await driveList(p.id, token);
        items.forEach(a=>{ if(normalizar(a.nome).includes(termo)) arquivos.push({...a,_cat:p.label}); });
      }
    } else if(fid) {
      // Navegar dentro de uma pasta específica
      const perm = isGestor || pastasVisiveis.some(p=>p.id===fid) || pastasVisiveis.some(p=>fid.startsWith(p.id));
      if(perm) {
        currentId = fid;
        arquivos   = await driveList(fid, token);
        breadcrumb = await buildBreadcrumb(fid, token);
      }
    } else {
      // Listagem raiz: mostrar pastas visíveis da raiz
      currentId = 'todos';
      arquivos   = await driveList(REPO_ROOT, token);
      // Se pasta da raiz está oculta para colaborador, filtrar
      if(!isGestor) {
        arquivos = arquivos.filter(a => {
          if(a.tipo!=='Pasta') return true;
          const found = PASTA_DEFS.find(p=>p.id===fid||p.label.toLowerCase()===normalizar(a.nome));
          return !found || !ocultos.has(found.id);
        });
      }
    }

    if(req.query.format==='json') return res.status(200).json({ok:true,total:arquivos.length,docs:arquivos});

    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-cache');
    return res.status(200).send(renderPage({session,arquivos,breadcrumb,currentId,isGestor,pastaDefs:pastasVisiveis,ocultos,q}));
  } catch(err) {
    console.error('repositorio ERRO:',err.message);
    return res.status(500).json({error:'Erro ao carregar',detail:err.message});
  }
}
