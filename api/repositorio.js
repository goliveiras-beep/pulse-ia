// api/repositorio.js - Aba de repositorio de documentos do Pulse
export const config = { maxDuration: 30 };
import { createHash, createSign } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
const REPOSITORY_ROOT_FOLDER_ID = process.env.PULSE_REPOSITORY_FOLDER_ID || '1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f';

const REPOSITORY_FOLDERS = [
  { id: REPOSITORY_ROOT_FOLDER_ID, label: 'Raiz', slack: '#docs-geral' },
  { id: '1I7hi9lszj4q6lfIz3pdy0VOSbD7IXt26', label: 'Diagramacao', slack: '#docs-diagramacao' },
  { id: '1UqTP1DBXLHjPM4xpuiQPLq1jwAaq6pBs', label: 'Comunicados', slack: '#docs-comunicados' },
  { id: '18NyogisGSmy5f6pq_kfuWZukajRYWvdY', label: 'Fluxogramas Operacionais', slack: '#docs-fluxogramas' },
  { id: '1-nlWVPSK2rgCCxGO0uah78yLSotdKh27', label: 'Politicas e Procedimentos', slack: '#docs-politicas' },
  { id: '1TY1NNqvs32pbwVgCn4yhMia0xXUv2JRs', label: 'Arquivo Geral', slack: '#docs-geral' },
];

function hash(s) {
  return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const parts = c.trim().split('=');
    const k = parts.shift();
    cookies[k] = parts.join('=');
  });
  return cookies;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split('|');
    const nome = parts[0], h = parts[1], ts = parts[2];
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(nome + ts)) return null;
    return { nome };
  } catch { return null; }
}

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function getGoogleAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sigInput = header + '.' + payload;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const sig = sign.sign(sa.private_key, 'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + sigInput + '.' + sig });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Google token error: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

function normalizar(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function tipoArquivo(mimeType) {
  mimeType = mimeType || '';
  if (mimeType.includes('folder')) return 'Pasta';
  if (mimeType.includes('document')) return 'Documento';
  if (mimeType.includes('spreadsheet')) return 'Planilha';
  if (mimeType.includes('presentation')) return 'Apresentacao';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('image')) return 'Imagem';
  if (mimeType.includes('zip')) return 'ZIP';
  return 'Arquivo';
}

function icone(tipo) {
  if (tipo === 'Pasta') return '&#128193;';
  if (tipo === 'Planilha') return '&#128202;';
  if (tipo === 'Apresentacao') return '&#128200;';
  if (tipo === 'PDF') return '&#128213;';
  if (tipo === 'Imagem') return '&#128444;';
  return '&#128196;';
}

function fmtData(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return ''; }
}

function resolveFolders(folderId) {
  if (!folderId || folderId === 'todos') return REPOSITORY_FOLDERS;
  const found = REPOSITORY_FOLDERS.find(f => f.id === folderId);
  return found ? [found] : [{ id: folderId, label: 'Pasta', slack: '' }];
}

async function listarRepositorio({ q = '', folder = 'todos', limit = 100 } = {}) {
  const token = await getGoogleAccessToken();
  const termo = normalizar(q);
  const docs = [];
  for (const f of resolveFolders(folder)) {
    const params = new URLSearchParams({ q: `'${f.id}' in parents and trashed = false`, pageSize: String(Math.min(limit, 100)), orderBy: 'folder,name', fields: 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,size)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    const r = await fetch('https://www.googleapis.com/drive/v3/files?' + params.toString(), { headers: { Authorization: 'Bearer ' + token } });
    const data = await r.json();
    if (data.error) throw new Error('Drive list error: ' + JSON.stringify(data.error));
    (data.files || []).forEach(file => {
      const tipo = tipoArquivo(file.mimeType);
      docs.push({ id: file.id, nome: file.name, tipo, mimeType: file.mimeType, link: file.webViewLink || ('https://drive.google.com/file/d/' + file.id + '/view'), criadoEm: file.createdTime || '', atualizadoEm: file.modifiedTime || '', tamanho: file.size || '', categoria: f.label, canalSlack: f.slack });
    });
  }
  const filtrados = termo ? docs.filter(d => normalizar(d.nome + ' ' + d.tipo + ' ' + d.categoria + ' ' + d.canalSlack).includes(termo)) : docs;
  return filtrados.slice(0, limit);
}

function renderHTML({ session, docs, q, folder }) {
  const chips = [{ id: 'todos', label: 'Todos' }].concat(REPOSITORY_FOLDERS.map(f => ({ id: f.id, label: f.label })));
  const cards = docs.length ? docs.map(d => `
    <a class="doc" href="${esc(d.link)}" target="_blank" rel="noopener">
      <div class="doc-ic">${icone(d.tipo)}</div>
      <div class="doc-main"><div class="doc-title">${esc(d.nome)}</div><div class="doc-meta">${esc(d.categoria)} &middot; ${esc(d.tipo)}${d.canalSlack?' &middot; '+esc(d.canalSlack):''}</div></div>
      <div class="doc-date">${esc(fmtData(d.atualizadoEm))}</div>
    </a>`).join('') : '<div class="empty">Nenhum documento encontrado.</div>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Repositorio</title>
<style>
:root{--bg:#f5f5f5;--card:#fff;--text:#1a1a1a;--muted:#777;--border:#e5e5e5;--header:#161920;--blue:#1d4ed8;--blue-bg:#eff6ff;--chip-bg:#fff;--chip-c:#555;--chip-border:#e5e5e5;--doc-hover:#f8fafc;--doc-ic-bg:#eff6ff;--doc-ic-c:#1d4ed8;--input-bg:#fff;--input-border:#e5e5e5;}
html.dark{--bg:#1c1f26;--card:#242836;--text:#e2e8f0;--muted:#718096;--border:#2d3748;--header:#0f1117;--blue:#63b3ed;--blue-bg:#1a2744;--chip-bg:#242836;--chip-c:#a0aec0;--chip-border:#2d3748;--doc-hover:#2d3140;--doc-ic-bg:#1a2744;--doc-ic-c:#63b3ed;--input-bg:#2d3140;--input-border:#3d4660;}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10}.logo{width:28px;height:28px;border-radius:6px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:11px;color:#889}.hr{margin-left:auto;display:flex;gap:8px;align-items:center}.btn{border:1px solid #3d4660;border-radius:6px;padding:5px 10px;font-size:11px;color:#cbd5e1;background:none;cursor:pointer;text-decoration:none}.btn-theme{border:1px solid #3d4660;border-radius:6px;padding:4px 8px;font-size:14px;background:none;cursor:pointer}
.wrap{max-width:1080px;margin:0 auto;padding:18px 20px}.top{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:14px}.title{font-size:22px;font-weight:800}.sub{font-size:12px;color:var(--muted);margin-top:3px}.search{margin-left:auto;display:flex;gap:8px;min-width:320px}.search input{flex:1;border:1px solid var(--input-border);border-radius:8px;padding:9px 12px;font-size:13px;background:var(--input-bg);color:var(--text);outline:none}.search button{border:none;border-radius:8px;background:var(--blue);color:#fff;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.chip{border:1px solid var(--chip-border);border-radius:999px;padding:5px 10px;background:var(--chip-bg);font-size:12px;color:var(--chip-c)}.chip.active{background:var(--text);color:var(--bg);border-color:var(--text)}
.grid{background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}.doc{display:grid;grid-template-columns:38px 1fr 88px;gap:10px;align-items:center;padding:11px 14px;border-bottom:1px solid var(--border)}.doc:last-child{border-bottom:none}.doc:hover{background:var(--doc-hover)}.doc-ic{width:30px;height:30px;border-radius:7px;background:var(--doc-ic-bg);color:var(--doc-ic-c);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800}.doc-title{font-size:13px;font-weight:700}.doc-meta{font-size:11px;color:var(--muted);margin-top:2px}.doc-date{font-size:11px;color:var(--muted);text-align:right}.empty{padding:24px;text-align:center;color:var(--muted);font-size:13px}.hint{margin-top:12px;font-size:11px;color:var(--muted);line-height:1.5}
@media(max-width:700px){.search{min-width:100%;margin-left:0}.doc{grid-template-columns:34px 1fr}.doc-date{display:none}.wrap{padding:14px 12px}}
</style>
</head>
<body>
<div class="header">
  <a class="logo" href="/api/app">P</a>
  <div><div class="ht">Pulse - Repositorio</div><div class="hs">Documentos internos no Google Drive</div></div>
  <div class="hr">
    <span class="hs">Ola, ${esc(session.nome.split(' ')[0])}</span>
    <button id="tt" class="btn-theme" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'\u2600\uFE0F':'\uD83C\uDF19';})()" title="Tema">&#127769;</button>
    <a class="btn" href="/api/app">Home</a>
  </div>
</div>
<div class="wrap">
  <div class="top">
    <div><div class="title">Repositorio Pulse</div><div class="sub">Busca rapida nos documentos oficiais e nas pastas do Drive.</div></div>
    <form class="search" method="GET" action="/api/repositorio">
      <input name="q" value="${esc(q)}" placeholder="Buscar documentos, fluxos, politicas...">
      <input type="hidden" name="folder" value="${esc(folder || 'todos')}">
      <button>Buscar</button>
    </form>
  </div>
  <div class="chips">${chips.map(c => `<a class="chip ${String(folder||'todos')===c.id?'active':''}" href="/api/repositorio?folder=${encodeURIComponent(c.id)}${q?'&q='+encodeURIComponent(q):''}">${esc(c.label)}</a>`).join('')}</div>
  <div class="grid">${cards}</div>
  <div class="hint">A IA usa este repositorio como fonte de consulta. Nao altera nada; retorna documento, categoria e link.</div>
</div>
<script>(function(){var dk=document.documentElement.classList.contains('dark');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'\u2600\uFE0F':'\uD83C\uDF19';})()</script>
</body></html>`;
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo nao permitido' });
  try {
    const q = String(req.query.q || '').trim();
    const folder = String(req.query.folder || 'todos');
    const docs = await listarRepositorio({ q, folder, limit: 100 });
    if (req.query.format === 'json') return res.status(200).json({ ok: true, rootFolderId: REPOSITORY_ROOT_FOLDER_ID, total: docs.length, docs });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(renderHTML({ session, docs, q, folder }));
  } catch (err) {
    console.error('repositorio.js ERRO:', err.message, err.stack);
    return res.status(500).json({ error: 'Erro ao carregar repositorio', detail: err.message });
  }
}
