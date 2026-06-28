// api/equipe-view.js — Gestão de equipe (gestor)
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function iniciais(n) { return (n||'?').split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const equipeRaw = await getSheet('Equipe!A2:J200');
  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  // ── POST: salvar edição ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { acao, linha, nome, cargo, nucleo, perfil, email } = req.body || {};

    if (acao === 'editar' && linha) {
      const idx = parseInt(linha);
      const row = equipeRaw[idx - 2] || [];
      await setSheet(`Equipe!A${idx}:J${idx}`, [[
        nome  || row[0] || '',
        cargo || row[1] || '',
        nucleo|| row[2] || '',
        row[3]||'', row[4]||'', row[5]||'', row[6]||'', row[7]||'',
        perfil|| row[8] || 'colaborador',
        email || row[9] || '',
      ]]);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'remover' && linha) {
      const idx = parseInt(linha);
      await setSheet(`Equipe!A${idx}:J${idx}`, [['','','','','','','','','','']]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  }

  // ── GET: renderizar página ────────────────────────────────────────────────
  const membros = equipeRaw.map((r, i) => ({
    linha: i + 2,
    nome:   r[0]||'',
    cargo:  r[1]||'',
    nucleo: r[2]||'',
    perfil: r[8]||'colaborador',
    email:  r[9]||'',
  })).filter(m => m.nome);

  const gestores    = membros.filter(m => m.perfil === 'gestor');
  const colaboradores = membros.filter(m => m.perfil !== 'gestor');

  function cardMembro(m) {
    const isGestor = m.perfil === 'gestor';
    const cor = isGestor ? '#fef3c7' : '#eff6ff';
    const corT = isGestor ? '#92400e' : '#1d4ed8';
    const badge = isGestor
      ? `<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">Gestor</span>`
      : `<span style="background:#eff6ff;color:#1d4ed8;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">Colaborador</span>`;
    return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:50%;background:${cor};color:${corT};font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(m.nome)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(m.nome)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(m.cargo)||'—'}${m.nucleo ? ' · '+esc(m.nucleo) : ''}</div>
        ${m.email ? `<div style="font-size:10px;color:var(--text3);margin-top:1px">✉ ${esc(m.email)}</div>` : '<div style="font-size:10px;color:#f6ad55;margin-top:1px">⚠ Sem email cadastrado</div>'}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        ${badge}
        <button onclick="abrirEditor(${m.linha},'${esc(m.nome)}','${esc(m.cargo)}','${esc(m.nucleo)}','${m.perfil}','${esc(m.email)}')" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:11px;color:var(--text2);cursor:pointer">Editar</button>
      </div>
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Equipe</title>
<style>
:root{--bg:#f5f5f5;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;--text:#1a1a1a;--text2:#555;--text3:#888;--header:#161920;}
html.dark{--bg:#1c1f26;--card:#242836;--border:#2d3748;--border2:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--header:#0f1117;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:11px;color:#666}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer;text-decoration:none}
.btn-sm:hover{border-color:#6b7280;color:#e2e8f0}
.wrap{max-width:900px;margin:0 auto;padding:20px}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:20px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border-radius:14px;padding:24px;width:400px;max-width:calc(100vw - 32px)}
.modal h3{font-size:16px;font-weight:700;margin-bottom:18px}
.field{margin-bottom:12px}
.field label{display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.field input,.field select{width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none}
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
  <div><div class="ht">Pulse <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:4px">Equipe</span></div><div class="hs">${membros.length} membros</div></div>
  <div class="hr">
    <a href="/api/app" class="btn-sm">← Voltar</a>
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" style="font-size:14px;padding:3px 8px">🌙</button>
  </div>
</div>

<div class="wrap">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:16px">
    <div style="text-align:center;min-width:60px"><div style="font-size:28px;font-weight:700">${membros.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Total</div></div>
    <div style="width:1px;height:40px;background:var(--border)"></div>
    <div style="text-align:center;min-width:60px"><div style="font-size:28px;font-weight:700;color:#92400e">${gestores.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Gestores</div></div>
    <div style="width:1px;height:40px;background:var(--border)"></div>
    <div style="text-align:center;min-width:60px"><div style="font-size:28px;font-weight:700;color:#1d4ed8">${colaboradores.length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Colaboradores</div></div>
    <div style="width:1px;height:40px;background:var(--border)"></div>
    <div style="text-align:center;min-width:60px"><div style="font-size:28px;font-weight:700;color:#f6ad55">${membros.filter(m=>!m.email).length}</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase">Sem email</div></div>
  </div>

  ${gestores.length ? `<div class="section-title">Gestores (${gestores.length})</div><div class="grid">${gestores.map(cardMembro).join('')}</div>` : ''}
  <div class="section-title">Colaboradores (${colaboradores.length})</div>
  <div class="grid">${colaboradores.map(cardMembro).join('')}</div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h3>Editar colaborador</h3>
    <input type="hidden" id="ed-linha">
    <div class="field"><label>Nome</label><input type="text" id="ed-nome"></div>
    <div class="field"><label>Cargo</label><input type="text" id="ed-cargo" placeholder="Ex: Operador, Analista..."></div>
    <div class="field"><label>Núcleo</label><input type="text" id="ed-nucleo" placeholder="Ex: Central, Coord, Engenharia..."></div>
    <div class="field"><label>Email</label><input type="email" id="ed-email" placeholder="nome@gmail.com"></div>
    <div class="field"><label>Perfil de acesso</label>
      <select id="ed-perfil">
        <option value="colaborador">Colaborador</option>
        <option value="gestor">Gestor</option>
      </select>
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
function abrirEditor(linha,nome,cargo,nucleo,perfil,email){
  document.getElementById('ed-linha').value=linha;
  document.getElementById('ed-nome').value=nome;
  document.getElementById('ed-cargo').value=cargo;
  document.getElementById('ed-nucleo').value=nucleo;
  document.getElementById('ed-perfil').value=perfil;
  document.getElementById('ed-email').value=email;
  document.getElementById('modal').classList.add('open');
}
function fecharModal(){document.getElementById('modal').classList.remove('open');}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)fecharModal();});

async function salvarEdicao(){
  const body={
    acao:'editar',
    linha:document.getElementById('ed-linha').value,
    nome:document.getElementById('ed-nome').value,
    cargo:document.getElementById('ed-cargo').value,
    nucleo:document.getElementById('ed-nucleo').value,
    perfil:document.getElementById('ed-perfil').value,
    email:document.getElementById('ed-email').value,
  };
  const r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.ok){fecharModal();toast('Salvo!');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}

async function removerMembro(){
  if(!confirm('Remover este colaborador da equipe?'))return;
  const body={acao:'remover',linha:document.getElementById('ed-linha').value};
  const r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.ok){fecharModal();toast('Removido!');setTimeout(()=>location.reload(),1000);}
  else toast('Erro: '+d.error,'#dc2626');
}

function toast(msg,bg='#1a1a1a'){
  const t=document.getElementById('toast');t.textContent=msg;t.style.background=bg;t.style.display='block';
  setTimeout(()=>t.style.display='none',2500);
}
</script>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
