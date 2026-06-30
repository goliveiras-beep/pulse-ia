// api/repositorio.js – Central Técnica / Repositório de documentos Pulse
export const config = { maxDuration: 30 };
import { createSign, createHash } from 'crypto';
import { sheetsRequest } from '../lib/google-auth.js';

const COOKIE_NAME    = 'pulse_session';
const COOKIE_MAX     = 60 * 60 * 24 * 7;
const SHEET_ID       = process.env.GOOGLE_SHEET_ID;
const REPO_ROOT      = process.env.PULSE_REPOSITORY_FOLDER_ID || '1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f';
const CONFIG_RANGE   = 'RepositorioConfig!A2:B50';  // A=folderId, B=oculto(1/0)

const PASTA_DEFS = [
  { id: REPO_ROOT,                          label: 'Raiz',                    slack: '#docs-geral'      },
  { id: '1I7hi9lszj4q6lfIz3pdy0VOSbD7IXt26', label: 'Diagramacao',           slack: '#docs-diagramacao'},
  { id: '1UqTP1DBXLHjPM4xpuiQPLq1jwAaq6pBs', label: 'Comunicados',           slack: '#docs-comunicados'},
  { id: '18NyogisGSmy5f6pq_kfuWZukajRYWvdY', label: 'Fluxogramas Operacionais', slack: '#docs-fluxogramas'},
  { id: '1-nlWVPSK2rgCCxGO0uah78yLSotdKh27', label: 'Politicas e Procedimentos', slack: '#docs-politicas'},
  { id: '1TY1NNqvs32pbwVgCn4yhMia0xXUv2JRs', label: 'Arquivo Geral',         slack: '#docs-geral'      },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function hash(s) { return createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function normalizar(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function fmtData(iso) { if(!iso)return''; try{return new Date(iso).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});}catch{return'';} }
function tipoArquivo(m) { m=m||''; if(m.includes('folder'))return'Pasta'; if(m.includes('document'))return'Documento'; if(m.includes('spreadsheet'))return'Planilha'; if(m.includes('presentation'))return'Apresentacao'; if(m.includes('pdf'))return'PDF'; if(m.includes('image'))return'Imagem'; return'Arquivo'; }
function icone(tipo) { if(tipo==='Pasta')return'&#128193;'; if(tipo==='Planilha')return'&#128202;'; if(tipo==='Apresentacao')return'&#128200;'; if(tipo==='PDF')return'&#128213;'; if(tipo==='Imagem')return'&#128444;'; return'&#128196;'; }
function base64url(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

function parseCookies(h) {
  const c={}; (h||'').split(';').forEach(x=>{const p=x.trim().split('=');const k=p.shift();c[k]=p.join('=');}); return c;
}
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

async function getGoogleAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now()/1000);
  const hdr = base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const pay = base64url(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const { createSign } = await import('crypto');
  const s = createSign('RSA-SHA256'); s.update(hdr+'.'+pay);
  const sig = s.sign(sa.private_key,'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+hdr+'.'+pay+'.'+sig});
  const d = await r.json();
  if(!d.access_token) throw new Error('Google token error: '+JSON.stringify(d));
  return d.access_token;
}

// ── Config de visibilidade (Google Sheets) ────────────────────────────────────
async function lerConfig() {
  // Retorna Set de IDs de pastas OCULTAS
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(CONFIG_RANGE)}`);
    const ocultos = new Set();
    (d.values||[]).forEach(r => { if(r[1]==='1'||r[1]===1) ocultos.add(r[0]); });
    return ocultos;
  } catch { return new Set(); }
}

async function salvarConfig(folderId, oculto) {
  // Upsert: busca linha existente do folder, atualiza; se não existe, append
  const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(CONFIG_RANGE)}`);
  const rows = d.values||[];
  const idx = rows.findIndex(r => r[0]===folderId);
  if(idx>=0) {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`RepositorioConfig!B${idx+2}`)}?valueInputOption=USER_ENTERED`,'PUT',{values:[[oculto?'1':'0']]});
  } else {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('RepositorioConfig!A:B')}:append?valueInputOption=USER_ENTERED`,'POST',{values:[[folderId,oculto?'1':'0']]});
  }
}

// ── Drive listing ────────────────────────────────────────────────────────────
async function listar({ q='', folderIds, limit=100 } = {}) {
  const token = await getGoogleAccessToken();
  const termo = normalizar(q);
  const docs = [];
  for(const f of folderIds) {
    const params = new URLSearchParams({q:`'${f.id}' in parents and trashed = false`,pageSize:String(Math.min(limit,100)),orderBy:'folder,name',fields:'files(id,name,mimeType,webViewLink,createdTime,modifiedTime)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
    const r = await fetch('https://www.googleapis.com/drive/v3/files?'+params,{headers:{Authorization:'Bearer '+token}});
    const data = await r.json();
    (data.files||[]).forEach(file => {
      const tipo = tipoArquivo(file.mimeType);
      docs.push({id:file.id,nome:file.name,tipo,link:file.webViewLink||'https://drive.google.com/file/d/'+file.id+'/view',atualizadoEm:file.modifiedTime||'',categoria:f.label,canalSlack:f.slack,folderId:f.id});
    });
  }
  const filtrados = termo ? docs.filter(d=>normalizar(d.nome+' '+d.tipo+' '+d.categoria).includes(termo)) : docs;
  return filtrados.slice(0,limit);
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function renderHTML({ session, docs, q, folder, pastasVisiveis, pastasOcultas, isGestor }) {
  const chips = [{id:'todos',label:'Todos'}].concat(pastasVisiveis.map(f=>({id:f.id,label:f.label})));

  const cards = docs.length ? docs.map(d=>`
    <a class="doc" href="${esc(d.link)}" target="_blank" rel="noopener">
      <div class="doc-ic">${icone(d.tipo)}</div>
      <div class="doc-main">
        <div class="doc-title">${esc(d.nome)}</div>
        <div class="doc-meta">${esc(d.categoria)} &middot; ${esc(d.tipo)}${d.canalSlack?' &middot; '+esc(d.canalSlack):''}</div>
      </div>
      <div class="doc-date">${esc(fmtData(d.atualizadoEm))}</div>
    </a>`).join('') : '<div class="empty">Nenhum documento encontrado.</div>';

  const painelGestorHtml = isGestor ? `
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:14px;font-weight:700;color:var(--text)">🔒 Visibilidade das pastas</span>
      <span style="font-size:11px;color:var(--muted)">Só gestores veem esta seção e podem configurar</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${PASTA_DEFS.map(p=>{
        const oculta = pastasOcultas.has(p.id);
        return `<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;background:var(--bg2,var(--bg));border:1px solid ${oculta?'#dc2626':'var(--border)'};border-radius:8px">
          <span style="font-size:18px">${oculta?'🔒':'👁️'}</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(p.label)}</div>
            <div style="font-size:11px;color:var(--muted)">${esc(p.id.slice(0,18))}… &middot; ${esc(p.slack)}</div>
          </div>
          <span style="font-size:11px;font-weight:600;color:${oculta?'#dc2626':'#16a34a'};min-width:60px;text-align:right">${oculta?'Oculta':'Visível'}</span>
          <button onclick="togglePasta('${esc(p.id)}',${oculta?0:1})" style="border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;background:${oculta?'#16a34a':'#dc2626'};color:#fff">${oculta?'Mostrar':'Ocultar'}</button>
        </div>`;
      }).join('')}
    </div>
    <div id="config-msg" style="display:none;margin-top:8px;font-size:12px;text-align:center;padding:6px;border-radius:6px"></div>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Central Técnica</title>
<style>
:root{--bg:#f5f5f5;--bg2:#fff;--card:#fff;--text:#1a1a1a;--muted:#777;--border:#e5e5e5;--header:#161920;--blue:#1d4ed8;--chip-bg:#fff;--chip-c:#555;--chip-border:#e5e5e5;--doc-hover:#f8fafc;--doc-ic-bg:#eff6ff;--doc-ic-c:#1d4ed8;--input-bg:#fff;--input-border:#e5e5e5;}
html.dark{--bg:#1c1f26;--bg2:#242836;--card:#242836;--text:#e2e8f0;--muted:#718096;--border:#2d3748;--header:#0f1117;--blue:#63b3ed;--chip-bg:#242836;--chip-c:#a0aec0;--chip-border:#2d3748;--doc-hover:#2d3140;--doc-ic-bg:#1a2744;--doc-ic-c:#63b3ed;--input-bg:#2d3140;--input-border:#3d4660;}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}.logo{width:28px;height:28px;border-radius:6px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:11px;color:#889}.hr{margin-left:auto;display:flex;gap:8px;align-items:center}.btn{border:1px solid #3d4660;border-radius:6px;padding:5px 10px;font-size:11px;color:#cbd5e1;background:none;cursor:pointer;text-decoration:none}.btn-theme{border:1px solid #3d4660;border-radius:6px;padding:4px 8px;font-size:14px;background:none;cursor:pointer}
.wrap{max-width:1080px;margin:0 auto;padding:18px 20px}.top{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:14px}.title{font-size:22px;font-weight:800}.sub{font-size:12px;color:var(--muted);margin-top:3px}.search{margin-left:auto;display:flex;gap:8px;min-width:320px}.search input{flex:1;border:1px solid var(--input-border);border-radius:8px;padding:9px 12px;font-size:13px;background:var(--input-bg);color:var(--text);outline:none}.search button{border:none;border-radius:8px;background:var(--blue);color:#fff;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.chip{border:1px solid var(--chip-border);border-radius:999px;padding:5px 10px;background:var(--chip-bg);font-size:12px;color:var(--chip-c)}.chip.active{background:var(--text);color:var(--bg);border-color:var(--text)}
.grid{background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}.doc{display:grid;grid-template-columns:38px 1fr 88px;gap:10px;align-items:center;padding:11px 14px;border-bottom:1px solid var(--border)}.doc:last-child{border-bottom:none}.doc:hover{background:var(--doc-hover)}.doc-ic{width:30px;height:30px;border-radius:7px;background:var(--doc-ic-bg);color:var(--doc-ic-c);display:flex;align-items:center;justify-content:center;font-size:14px}.doc-title{font-size:13px;font-weight:700}.doc-meta{font-size:11px;color:var(--muted);margin-top:2px}.doc-date{font-size:11px;color:var(--muted);text-align:right}.empty{padding:24px;text-align:center;color:var(--muted);font-size:13px}.hint{margin-top:12px;font-size:11px;color:var(--muted);line-height:1.5}
@media(max-width:700px){.search{min-width:100%;margin-left:0}.doc{grid-template-columns:34px 1fr}.doc-date{display:none}.wrap{padding:14px 12px}}
</style>
</head>
<body>
<div class="header">
  <a class="logo" href="/api/app">P</a>
  <div><div class="ht">Pulse — Central Técnica</div><div class="hs">Documentos, fluxos e procedimentos internos</div></div>
  <div class="hr">
    <span class="hs">Olá, ${esc(session.nome.split(' ')[0])}</span>
    <button id="tt" class="btn-theme" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'☀️':'🌙';})()" title="Tema">🌙</button>
    <a class="btn" href="/api/app">Home</a>
  </div>
</div>
<div class="wrap">
  <div class="top">
    <div>
      <div class="title">Central Técnica</div>
      <div class="sub">Documentos oficiais, fluxos operacionais e procedimentos da equipe.</div>
    </div>
    <form class="search" method="GET" action="/api/repositorio">
      <input name="q" value="${esc(q)}" placeholder="Buscar documentos, fluxos, políticas...">
      <input type="hidden" name="folder" value="${esc(folder||'todos')}">
      <button>Buscar</button>
    </form>
  </div>
  <div class="chips">${chips.map(c=>`<a class="chip ${String(folder||'todos')===c.id?'active':''}" href="/api/repositorio?folder=${encodeURIComponent(c.id)}${q?'&q='+encodeURIComponent(q):''}">${esc(c.label)}</a>`).join('')}</div>
  ${painelGestorHtml}
  <div class="grid">${cards}</div>
  <div class="hint">A IA usa esta base como fonte de consulta. Não altera nada; retorna documento, categoria e link.</div>
</div>
<script>
async function togglePasta(folderId, novoEstado){
  var msg = document.getElementById('config-msg');
  msg.style.display='none';
  try {
    var r = await fetch('/api/repositorio?action=config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folderId,oculto:novoEstado===1})});
    var d = await r.json();
    if(d.ok){
      msg.textContent = novoEstado===1 ? '🔒 Pasta ocultada para a equipe.' : '👁️ Pasta visível para a equipe.';
      msg.style.display='block';
      msg.style.background = novoEstado===1 ? '#1f1010' : '#0d2010';
      msg.style.color = novoEstado===1 ? '#fc8181' : '#68d391';
      setTimeout(function(){ location.reload(); }, 1200);
    } else {
      msg.textContent = 'Erro: ' + (d.error||'desconhecido');
      msg.style.display='block';
      msg.style.background='#1f1010';msg.style.color='#fc8181';
    }
  } catch(e) {
    msg.textContent = 'Erro de conexão.';
    msg.style.display='block';
  }
}
(function(){var dk=document.documentElement.classList.contains('dark');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'☀️':'🌙';})()</script>
</body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const session = getSession(req);
  if(!session) return res.redirect(302, '/api/app');

  // Verificar se é gestor
  let isGestor = false;
  try {
    const equipeRaw = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:I200').then(d=>d.values||[]);
    const u = equipeRaw.find(r=>r[0]===session.nome);
    isGestor = u?.[8]==='gestor' && (u?.[10]||'ativo')==='ativo';
  } catch {}

  // POST: alterar visibilidade (só gestores)
  if(req.method==='POST' && req.query.action==='config') {
    if(!isGestor) return res.status(403).json({error:'Acesso negado'});
    const { folderId, oculto } = req.body||{};
    if(!folderId) return res.status(400).json({error:'folderId obrigatório'});
    await salvarConfig(folderId, !!oculto);
    return res.status(200).json({ok:true});
  }

  if(req.method!=='GET') return res.status(405).json({error:'Método não permitido'});

  try {
    const q = String(req.query.q||'').trim();
    const folder = String(req.query.folder||'todos');

    const ocultos = await lerConfig();
    // Pastas visíveis: gestores veem tudo, colaboradores só as não ocultas
    const pastasVisiveis = PASTA_DEFS.filter(p => isGestor || !ocultos.has(p.id));
    const pastasOcultas  = ocultos;

    // Montar lista de pastas para a query
    let folderIds;
    if(folder==='todos') {
      folderIds = pastasVisiveis;
    } else {
      const found = pastasVisiveis.find(f=>f.id===folder);
      folderIds = found ? [found] : [];
    }

    const docs = folderIds.length ? await listar({q, folderIds, limit:100}) : [];

    if(req.query.format==='json') return res.status(200).json({ok:true,total:docs.length,docs});

    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-cache');
    return res.status(200).send(renderHTML({session,docs,q,folder,pastasVisiveis,pastasOcultas,isGestor}));
  } catch(err) {
    console.error('repositorio.js ERRO:',err.message,err.stack);
    return res.status(500).json({error:'Erro ao carregar repositório',detail:err.message});
  }
}
