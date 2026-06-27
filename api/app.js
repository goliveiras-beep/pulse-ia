// api/app.js — Portal único com login, visão gestor e visão equipe
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const AIRTABLE_BASE = 'appwE9LmmTxynTGFY';
const AIRTABLE_TABLE = 'tblpibvwAIGBQXr0H';
const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function hash(s) { return createHash('sha256').update(s + (process.env.PULSE_SECRET || 'pulse2026')).digest('hex').slice(0,32); }
function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }
function estaDeServico(ent,sai,horaEv) {
  if(!ent||!sai||!horaEv) return false;
  const i=toMin(ent),f=toMin(sai),e=toMin(horaEv);
  return f>i?e>=i&&e<=f:e>=i||e<=f;
}
function statusTurno(ent,sai,horaEv) {
  if(!ent||!sai||!horaEv) return null;
  const ev=toMin(horaEv),i=toMin(ent),f=toMin(sai);
  if(Math.abs(i-ev)<=60) return 'entrando';
  if(Math.abs(f-ev)<=60) return 'saindo';
  return null;
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}
async function appendSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,'POST',{values});
}

async function getEventos(dataStr) {
  const filter=`OR(DATESTR({fldRnfbwPVzFiHMqs})='${dataStr}',DATESTR({fld8hthI7oI4MY5aP})='${dataStr}')`;
  try {
    const r=await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=30`,
      {headers:{Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`}});
    const d=await r.json();
    return (d.records||[]).map(r=>({
      nome:r.fields['Match ID']||'Evento',
      hora:r.fields['Horário KO']||r.fields['PGM (horário)']||'',
      tipo:r.fields['Tipo de Conteúdo']||'',
      local:(r.fields['Padrão de Produção aux']||r.fields['Name (from Padrão de Produção)']||(Array.isArray(r.fields['Padrão de Produção'])?r.fields['Padrão de Produção'][0]:''))||'',
    })).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  } catch { return []; }
}

function gerarFraseEncerrado(nomeEvento) {
  const frases = [
    'Esse aqui ja foi, e foi bonito!','Menos um, galera. Segue o baile!','Missao cumprida. Proximo!',
    'Entregue! Pode riscar da lista.','Foi de primeira, sem drama!','Producao entregue com louvor!',
    'Ja era. E foi sucesso!','Passou voando, como devia!','Check! Ta no saco.',
    'Era uma vez... e ja acabou.','Fechou bonito, equipe!','Evento no retrovisor!',
    'Tcharaaaan! Encerrado.','Foi, voltou, deu certo!','Mais um na conta da galera!',
    'Operacao realizada, pode fechar!','Esse a gente dominou!','Sem susto, sem drama. OK!',
    'Cumpriu o horario certinho!','Equipe nota 10 nesse aqui!',
  ];
  const idx = nomeEvento.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % frases.length;
  return frases[idx];
}

async function getFraseDoDia(dataStr) {
  try {
    try {
      const cache = await getSheet('Equipe!K1:L1');
      if (cache?.[0]?.[0] === dataStr && cache?.[0]?.[1]) return cache[0][1];
    } catch {}
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', max_tokens: 80,
        messages: [
          { role: 'system', content: 'Responda com APENAS UMA frase curta de até 6 palavras. Sem explicações, sem listas, sem sugestões. Só a frase. Exemplo: Café na veia, câmera no ar!' },
          { role: 'user', content: `Uma frase curta e animada para equipe de TV. Dia ${dataStr}.` }
        ]
      })
    });
    const d = await r.json();
    const frase = d.choices?.[0]?.message?.content?.trim() || 'Bora que hoje vai ser incrivel!';
    try { await setSheet('Equipe!K1:L1', [[dataStr, frase]]); } catch {}
    return frase;
  } catch { return 'Camera ligada, coração acelerado, vamos nessa!'; }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

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
    const nome = parts[0];
    const h = parts[1];
    const ts = parts[2];
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(nome + ts)) return null;
    return { nome };
  } catch {
    return null;
  }
}

function setSession(res, nome) {
  const ts = String(Date.now());
  const h = hash(nome + ts);
  const token = Buffer.from(`${nome}|${h}|${ts}`).toString('base64');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// ── HTML base ────────────────────────────────────────────────────────────────

const CHAT_IA = `
<div id="chat-ia-btn" onclick="toggleChat()" style="position:fixed;bottom:24px;right:24px;z-index:900;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);box-shadow:0 4px 20px rgba(99,102,241,.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;transition:transform .2s" title="Assistente IA">&#10024;</div>

<div id="chat-ia-box" style="display:none;position:fixed;bottom:88px;right:24px;z-index:900;width:360px;max-width:calc(100vw - 48px);background:#1e2230;border:1px solid #3d4660;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.6);overflow:hidden;flex-direction:column">
  <div style="background:#161920;padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #2d3748">
    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">&#10024;</div>
    <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#e2e8f0">Pulse IA</div><div style="font-size:10px;color:#718096">Assistente operacional</div></div>
    <button onclick="limparChat()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:14px;padding:4px" title="Limpar">&#128465;</button>
    <button onclick="toggleChat()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:20px;padding:4px;line-height:1">&times;</button>
  </div>
  <div id="chat-ia-msgs" style="height:320px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
    <div style="background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%">Oi! Sou o assistente do Pulse. Pode me perguntar sobre escalas, cobertura de eventos ou qualquer duvida da operacao. &#128075;</div>
  </div>
  <div style="padding:10px 12px;border-top:1px solid #2d3748;display:flex;gap:8px;align-items:flex-end">
    <textarea id="chat-ia-input" placeholder="Pergunte sobre a operacao..." rows="1" onkeydown="chatKeyDown(event)" oninput="autoResize(this)" style="flex:1;background:#2d3140;border:1px solid #3d4660;border-radius:8px;padding:8px 10px;font-size:12px;color:#e2e8f0;outline:none;resize:none;font-family:inherit;max-height:100px;line-height:1.4"></textarea>
    <button onclick="enviarMensagem()" id="chat-ia-send" style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);border:none;border-radius:8px;width:36px;height:36px;cursor:pointer;font-size:14px;flex-shrink:0;color:#fff">&#10148;</button>
  </div>
</div>

<style>
@keyframes chatpulse{0%,100%{opacity:1}50%{opacity:.3}}
#chat-ia-btn:hover{transform:scale(1.1)!important;box-shadow:0 6px 28px rgba(99,102,241,.7)!important}
</style>

<script>
var chatAberto=false,chatHistorico=[],chatPagina=window.location.pathname+window.location.search;
function toggleChat(){
  chatAberto=!chatAberto;
  var box=document.getElementById('chat-ia-box');
  box.style.display=chatAberto?'flex':'none';
  document.getElementById('chat-ia-btn').style.transform=chatAberto?'scale(0.9)':'scale(1)';
  if(chatAberto){setTimeout(function(){document.getElementById('chat-ia-input').focus();},100);var m=document.getElementById('chat-ia-msgs');m.scrollTop=m.scrollHeight;}
}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px';}
function chatKeyDown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enviarMensagem();}}
function limparChat(){
  chatHistorico=[];
  document.getElementById('chat-ia-msgs').innerHTML='<div style="background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%">Conversa limpa! Como posso ajudar? &#128075;</div>';
}
function renderMd(txt){
  return txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/^#{1,3} (.+)$/gm,'<div style="font-weight:700;margin:4px 0 2px">$1</div>')
    .replace(/^[-*] (.+)$/gm,'<div style="padding-left:10px">• $1</div>')
    .replace(/\n/g,'<br>');
}
function addMsg(texto,tipo){
  var msgs=document.getElementById('chat-ia-msgs');
  var div=document.createElement('div');
  if(tipo==='user'){div.style.cssText='background:#1a2744;border-radius:10px 10px 2px 10px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%;align-self:flex-end';div.textContent=texto;}
  else if(tipo==='load'){div.id='chat-load';div.style.cssText='background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#718096;max-width:90%';div.innerHTML='<span style="animation:chatpulse 1s infinite">&#10024; Pensando...</span>';}
  else{div.style.cssText='background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.6;max-width:92%';div.innerHTML=renderMd(texto);}
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;
}
async function enviarMensagem(){
  var input=document.getElementById('chat-ia-input');
  var texto=input.value.trim();if(!texto)return;
  input.value='';input.style.height='auto';
  addMsg(texto,'user');
  chatHistorico.push({role:'user',content:texto});
  var load=addMsg('','load');
  var btn=document.getElementById('chat-ia-send');btn.disabled=true;btn.style.opacity='.5';
  try{
    var r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:chatHistorico,pagina:chatPagina})});
    var d=await r.json();
    load.remove();
    var resp=d.resposta||'Nao consegui responder agora.';
    addMsg(resp,'ia');
    chatHistorico.push({role:'assistant',content:resp});
    if(d.acaoRealizada&&d.acaoRealizada.status==='success'&&['add_shift','remove_shift','swap_employee','update_shift','set_dayoff','set_vacation','set_medical_leave'].includes(d.acaoRealizada.action)){
      setTimeout(function(){location.reload();},1200);
    }
  }catch(e){load.remove();addMsg('Erro de conexao. Tenta de novo!','ia');}
  btn.disabled=false;btn.style.opacity='1';
}
</script>`;

function baseHTML(titulo, conteudo, script = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse${titulo ? ' - ' + titulo : ''}</title>
<style>
:root{
  --bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;
  --text:#1a1a1a;--text2:#555;--text3:#888;--text4:#bbb;
  --header:#161920;--blue:#1d4ed8;
  --blue-m-bg:#eff6ff;--blue-m-border:#dbeafe;--blue-m-v:#1d4ed8;
  --red-m-bg:#fef2f2;--red-m-border:#fca5a5;--red-m-v:#dc2626;
  --amber-m-bg:#fffbeb;--amber-m-border:#fcd34d;--amber-m-v:#d97706;
  --badge-green-bg:#dcfce7;--badge-green-c:#166534;
  --badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
  --badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
  --today-bg:#eff6ff;--today-border:#3b82f6;--today-c:#1d4ed8;
}
html.dark{
  --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
  --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
  --header:#0f1117;--blue:#63b3ed;
  --blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;
  --red-m-bg:#1f1010;--red-m-border:#3d2020;--red-m-v:#fc8181;
  --amber-m-bg:#1f1a0d;--amber-m-border:#3d3010;--amber-m-v:#f6ad55;
  --badge-green-bg:#0d2010;--badge-green-c:#68d391;
  --badge-red-bg:#1f1010;--badge-red-c:#fc8181;
  --badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
  --today-bg:#1a2744;--today-border:#2a4080;--today-c:#63b3ed;
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
.wrap{max-width:1200px;margin:0 auto;padding:16px 20px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.metric{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.metric.blue-m{background:var(--blue-m-bg);border-color:var(--blue-m-border)}
.metric.red-m{background:var(--red-m-bg);border-color:var(--red-m-border)}
.metric.amber-m{background:var(--amber-m-bg);border-color:var(--amber-m-border)}
.ml{font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.mv{font-size:24px;font-weight:700}
.ms{font-size:10px;color:var(--text3);margin-top:2px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.card-header{padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border2)}
.card-title{font-size:13px;font-weight:700}
.card-body{padding:12px}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600}
.badge.green{background:var(--badge-green-bg);color:var(--badge-green-c)}
.badge.red{background:var(--badge-red-bg);color:var(--badge-red-c)}
.badge.amber{background:var(--badge-amber-bg);color:var(--badge-amber-c)}
.badge.blue{background:var(--blue-m-bg);color:var(--blue-m-v)}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border-radius:12px;padding:24px;width:360px;max-width:calc(100vw - 32px)}
.modal h3{font-size:16px;font-weight:700;margin-bottom:16px}
.field{margin-bottom:12px}
.field label{display:block;font-size:11px;font-weight:600;color:var(--text3);margin-bottom:4px;text-transform:uppercase}
.field input,.field select{width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none}
.modal-btns{display:flex;gap:8px;margin-top:16px}
.btn-cancel{flex:1;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:13px;background:none;color:var(--text2);cursor:pointer}
.btn-primary{flex:2;border:none;border-radius:6px;padding:9px;font-size:13px;font-weight:600;background:#1d4ed8;color:#fff;cursor:pointer}
.toast{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:300}
.semana-titulo{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.grid7{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
@keyframes pulsar{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes pulse-heart{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
.pulse-heart-anim{animation:pulse-heart 1.5s ease-in-out infinite}
@media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.metrics{grid-template-columns:1fr}.wrap{padding:12px}}
</style>
</head>
<body>
${conteudo}
${script}
</body>
</html>`;
}

// ── Login page ───────────────────────────────────────────────────────────────

function loginPage(erro = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:40px 36px;width:360px;max-width:calc(100vw - 32px)}
.logo{width:48px;height:48px;border-radius:12px;background:#e53e3e;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:20px;font-weight:800;color:#fff}
h1{text-align:center;font-size:22px;font-weight:700;color:#e2e8f0;margin-bottom:6px}
.sub{text-align:center;font-size:13px;color:#718096;margin-bottom:28px}
label{display:block;font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px}
input{width:100%;background:#1e2230;border:1px solid #2d3748;border-radius:8px;padding:11px 14px;font-size:14px;color:#e2e8f0;outline:none;margin-bottom:14px}
input:focus{border-color:#4a90d9}
button{width:100%;background:#e53e3e;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;margin-top:4px}
button:hover{background:#c53030}
.erro{background:#1f1010;border:1px solid #3d2020;border-radius:6px;padding:10px 14px;font-size:12px;color:#fc8181;margin-bottom:16px}
</style>
</head>
<body>
<div class="box">
  <div class="logo">P</div>
  <h1>Pulse</h1>
  <p class="sub">Portal operacional</p>
  ${erro ? `<div class="erro">${erro}</div>` : ''}
  <form method="POST" action="/api/app?action=login">
    <label>Nome</label>
    <input type="text" name="nome" placeholder="Seu nome completo" required autofocus>
    <label>Senha</label>
    <input type="password" name="senha" placeholder="••••••••" required>
    <button type="submit">Entrar</button>
  </form>
</div>
</body>
</html>`;
}

// ── Cruzar eventos com escala ────────────────────────────────────────────────

function cruzarEventos(eventos, escHoje, dataStr) {
  return eventos.map(ev => {
    const disp = escHoje.filter(r => r[3] && r[4] && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente' && estaDeServico(r[3], r[4], ev.hora));
    const atenc = escHoje.filter(r => r[3] && r[4] && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente' && statusTurno(r[3], r[4], ev.hora) !== null && !disp.find(d => d[2] === r[2]));
    const aus = escHoje.filter(r => !disp.find(d => d[2] === r[2]) && !atenc.find(a => a[2] === r[2]));
    const semCob = disp.length === 0;
    const semAntecedencia = atenc.length > 0 && disp.length === 0;
    return {
      ...ev,
      disp: disp.map(r => ({ nome: r[2], ent: r[3], sai: r[4] })),
      atenc: atenc.map(r => ({ nome: r[2], ent: r[3], sai: r[4] })),
      aus: aus.map(r => ({ nome: r[2] })),
      semCob,
      semAntecedencia,
    };
  });
}

// ── Handler principal ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = req.query.action || '';

  // Logout
  if (req.method === 'POST' && action === 'logout') {
    clearSession(res);
    return res.redirect(302, '/api/app');
  }

  // Login POST
  if (req.method === 'POST' && action === 'login') {
    const body = req.body || {};
    const nome = String(body.nome || '').trim();
    const senha = String(body.senha || '').trim();
    if (!nome || !senha) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(loginPage('Preencha nome e senha.'));
    }
    const equipeRaw = await getSheet('Equipe!A2:I50');
    const usuario = equipeRaw.find(r => r[0] === nome);
    if (!usuario) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(loginPage('Usuário não encontrado.'));
    }
    const senhaHash = hash(senha);
    const senhaCorreta = usuario[7] || '';
    if (senhaCorreta && senhaHash !== senhaCorreta && senha !== senhaCorreta) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(loginPage('Senha incorreta.'));
    }
    setSession(res, nome);
    return res.redirect(302, '/api/app');
  }

  // Sem sessão → login
  const session = getSession(req);
  if (!session) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(loginPage());
  }

  const { nome } = session;

  // Ajuste de escala (gestor)
  if (req.method === 'POST' && action === 'ajuste') {
    const equipeCheck = await getSheet('Equipe!A2:I50');
    const usuarioCheck = equipeCheck.find(r => r[0] === nome);
    if (usuarioCheck?.[8] !== 'gestor') return res.status(403).json({ error: 'Acesso negado' });
    const { acao, data, colaborador, entrada, saida, obs } = req.body || {};
    if (!data || !colaborador) return res.status(400).json({ error: 'Dados inválidos' });
    const escalaRaw2 = await getSheet('Escala!A2:F2000');
    const idx = escalaRaw2.findIndex(r => r[0] === data && r[2] === colaborador);
    let entVal = entrada || '', saiVal = saida || '', obsVal = obs || '';
    if (acao === 'folga') { entVal = ''; saiVal = ''; obsVal = 'Folga'; }
    if (acao === 'remover') {
      if (idx >= 0) await setSheet(`Escala!D${idx + 2}:F${idx + 2}`, [['', '', '']]);
      return res.status(200).json({ ok: true });
    }
    if (idx >= 0) {
      await setSheet(`Escala!D${idx + 2}:F${idx + 2}`, [[entVal, saiVal, obsVal]]);
    } else {
      await appendSheet('Escala!A:F', [[data, '', colaborador, entVal, saiVal, obsVal]]);
    }
    return res.status(200).json({ ok: true });
  }

  // GET — carregar dados
  const hoje = getBRT();
  const hojeStr = fmtData(hoje);
  const horaAtualMin = hoje.getHours() * 60 + hoje.getMinutes();
  const hojeAirtable = fmtAirtable(hoje);

  const d1 = new Date(hoje); d1.setDate(hoje.getDate() + 1);
  const d1Str = fmtData(d1);
  const d2 = new Date(hoje); d2.setDate(hoje.getDate() + 2);
  const d3 = new Date(hoje); d3.setDate(hoje.getDate() + 3);
  const d4 = new Date(hoje); d4.setDate(hoje.getDate() + 4);
  const d5 = new Date(hoje); d5.setDate(hoje.getDate() + 5);
  const d6 = new Date(hoje); d6.setDate(hoje.getDate() + 6);

  const DIAS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  const DIAS_FULL = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];

  const [equipeRaw, escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:I50'),
    getSheet('Escala!A2:F2000'),
    getSheet('Ausencias!A2:I500'),
  ]);

  const usuario = equipeRaw.find(r => r[0] === nome);
  const isGestor = usuario?.[8] === 'gestor';

  const escala = escalaRaw.map(r => r);
  const ausencias = ausenciasRaw.map(r => r);

  // Semana (7 dias)
  const dias = [hoje, d1, d2, d3, d4, d5, d6];
  const escSem = escala.filter(r => dias.some(d => fmtData(d) === r[0]));
  const ausSem = ausencias;
  const nomes = equipeRaw.map(r => r[0]);

  const escHoje = escala.filter(r => r[0] === hojeStr);
  const escD1 = escala.filter(r => r[0] === d1Str);

  // ── VISÃO EQUIPE ──────────────────────────────────────────────────────────
  if (!isGestor) {
    const cargo = usuario?.[1] || '';
    const nucleo = usuario?.[2] || 'Operacoes';
    const turnoHoje = escala.find(r => r[0] === hojeStr && r[2] === nome);
    const turnoD1 = escala.find(r => r[0] === d1Str && r[2] === nome);
    const ausHoje = ausencias.find(a => a[1] === nome && (a[4] === hojeStr || a[5] === hojeStr));
    const ausD1 = ausencias.find(a => a[1] === nome && (a[4] === d1Str || a[5] === d1Str));

    const [eventosHoje, eventosAmanha, fraseDoDia] = await Promise.all([
      getEventos(hojeAirtable),
      getEventos(fmtAirtable(d1)),
      getFraseDoDia(hojeStr),
    ]);

    function cardTurno(turno, aus, label, isAmanha = false) {
      if (aus) return `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:#991b1b;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:20px;font-weight:700;color:#991b1b">${aus[3] || 'Ausencia'}</div></div>`;
      if (!turno || (!turno[3] && !turno[4])) return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:15px;color:#9ca3af">Sem escala</div></div>`;
      if (turno[5] === 'Folga') return `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:#92400e;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:20px;font-weight:700;color:#d97706">Folga</div></div>`;
      const [bg, bc, tc] = isAmanha ? ['#eff6ff', '#93c5fd', '#1d4ed8'] : ['var(--card)', 'var(--border)', 'var(--text)'];
      return `<div style="background:${bg};border:1px solid ${bc};border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:${isAmanha ? '#3b82f6' : 'var(--text3)'};font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:22px;font-weight:700;color:${tc}">${turno[3]} -- ${turno[4]}</div></div>`;
    }

    // Semana do colaborador (próximos 7 dias)
    function renderSemanaColab() {
      return dias.map(d => {
        const df = fmtData(d);
        const t = escala.find(r => r[0] === df && r[2] === nome);
        const aus = ausencias.find(a => a[1] === nome && (a[4] === df || a[5] === df));
        const isHoje = df === hojeStr;
        const isD1 = df === d1Str;
        let bg = 'var(--card)', bc = 'var(--border)', tc = 'var(--text3)', label = '--';
        if (aus) { bg = '#fdf4ff'; bc = '#d8b4fe'; tc = '#7c3aed'; label = aus[3] || 'Aus.'; }
        else if (t?.[5] === 'Folga') { bg = '#fffbeb'; bc = '#fcd34d'; tc = '#92400e'; label = 'Folga'; }
        else if (t?.[3] && t?.[4]) { bg = isHoje ? '#f0fdf4' : isD1 ? '#eff6ff' : 'var(--card)'; bc = isHoje ? '#86efac' : isD1 ? '#93c5fd' : 'var(--border)'; tc = isHoje ? '#166534' : isD1 ? '#1d4ed8' : 'var(--text)'; label = `${t[3]}<br>${t[4]}`; }
        return `<div style="background:${bg};border:1px solid ${bc};border-radius:8px;padding:8px 6px;text-align:center">
          <div style="font-size:9px;font-weight:700;color:${tc};text-transform:uppercase;margin-bottom:3px">${DIAS_PT[d.getDay()]}</div>
          <div style="font-size:9px;color:${tc};margin-bottom:4px">${df}</div>
          <div style="font-size:11px;font-weight:700;color:${tc};line-height:1.3">${label}</div>
        </div>`;
      }).join('');
    }

    // Eventos com cobertura para equipe
    function renderEventosEquipe(eventos, escDia) {
      if (!eventos.length) return `<div style="padding:20px;text-align:center;color:#aaa;font-size:13px">Nenhum evento</div>`;
      return eventos.map(ev => {
        const evMin = toMin(ev.hora);
        const encerrado = evMin !== null && evMin < horaAtualMin - 30;
        const cob = escDia.filter(r => r[3] && r[4] && r[5] !== 'Folga' && estaDeServico(r[3], r[4], ev.hora));
        const semCob = cob.length === 0;
        const [bc, bb] = semCob ? ['#fee2e2', '#fca5a5'] : ['#dcfce7', '#86efac'];
        return `<div style="border:1px solid ${encerrado ? 'var(--border)' : bb};border-radius:8px;margin-bottom:8px;overflow:hidden${encerrado ? ';opacity:.4' : ''}">
          <div style="background:${encerrado ? 'var(--bg2)' : bc};padding:8px 12px;display:flex;align-items:center;gap:10px">
            <div style="font-size:13px;font-weight:700;min-width:50px;color:var(--text)">${ev.hora || '--'}</div>
            <div style="flex:1"><div style="font-size:12px;font-weight:700">${ev.nome}</div><div style="font-size:10px;color:#aaa">${ev.tipo}${ev.local ? ' · ' + ev.local : ''}</div></div>
            <div style="font-size:10px;font-weight:600;color:${semCob ? '#991b1b' : '#166534'}">${semCob ? 'Sem cob.' : 'OK'}</div>
          </div>
        </div>`;
      }).join('');
    }

    const conteudoEquipe = `
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse</div><div class="hs">${DIAS_FULL[hoje.getDay()]} ${hojeStr}</div></div>
  <div class="hr">
    <span class="hs">Ola, ${nome.split(' ')[0]}</span>
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'&#9728;&#65039;':'&#127769;';})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <form method="POST" action="/api/app?action=logout" style="display:inline"><button type="submit" class="btn-sm">Sair</button></form>
  </div>
</div>
<div class="wrap">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px">
    <div style="width:44px;height:44px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
    <div style="flex:1">
      <div style="font-size:16px;font-weight:700">${nome}</div>
      <div style="font-size:12px;color:var(--text3)">${cargo}${nucleo ? ' · ' + nucleo : ''}</div>
    </div>
    <div style="font-size:12px;font-style:italic;color:#22c55e;text-align:right;max-width:200px;line-height:1.4">"${fraseDoDia}"</div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
    ${cardTurno(turnoHoje, ausHoje, 'Hoje')}
    ${cardTurno(turnoD1, ausD1, 'Amanha', true)}
  </div>

  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">Minha semana</div>
    <div class="grid7">${renderSemanaColab()}</div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div class="card">
      <div class="card-header">
        <span class="card-title" style="color:#22c55e">Eventos hoje</span>
        <span class="badge blue">${eventosHoje.length}</span>
      </div>
      <div class="card-body" style="max-height:400px;overflow-y:auto">${renderEventosEquipe(eventosHoje, escHoje)}</div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title" style="color:#3b82f6">Eventos amanha</span>
        <span class="badge blue">${eventosAmanha.length}</span>
      </div>
      <div class="card-body" style="max-height:400px;overflow-y:auto">${renderEventosEquipe(eventosAmanha, escD1)}</div>
    </div>
  </div>
</div>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(baseHTML('Equipe', conteudoEquipe + CHAT_IA));
  }

  // ── VISÃO GESTOR ──────────────────────────────────────────────────────────

  const [
    eventosHoje, eventosAmanha,
    eventosD2, eventosD3, eventosD4, eventosD5, eventosD6,
    fraseDoDia,
  ] = await Promise.all([
    getEventos(hojeAirtable),
    getEventos(fmtAirtable(d1)),
    getEventos(fmtAirtable(d2)),
    getEventos(fmtAirtable(d3)),
    getEventos(fmtAirtable(d4)),
    getEventos(fmtAirtable(d5)),
    getEventos(fmtAirtable(d6)),
    getFraseDoDia(hojeStr),
  ]);

  const eventosCruzadosHoje = cruzarEventos(eventosHoje, escHoje, hojeStr);
  const numEncerradosHoje = eventosCruzadosHoje.filter(e => {
    const evMin = toMin(e.hora);
    return evMin !== null && evMin < horaAtualMin - 30;
  }).length;
  const eventosCruzadosAmanha = cruzarEventos(eventosAmanha, escD1, d1Str);

  const diasNav = [
    { label: '#NossoDia', sublabel: hojeStr, eventos: eventosCruzadosHoje, total: eventosHoje.length, key: 'hoje', data: hojeStr, comOpac: true },
    { label: '#NossoDiaAmanhã', sublabel: d1Str, eventos: eventosCruzadosAmanha, total: eventosAmanha.length, key: 'amanha', data: d1Str, comOpac: false },
    { label: fmtData(d2), sublabel: DIAS_PT[d2.getDay()], eventos: cruzarEventos(eventosD2, escala.filter(r => r[0] === fmtData(d2)), fmtData(d2)), total: eventosD2.length, key: 'd2', data: fmtData(d2), comOpac: false },
    { label: fmtData(d3), sublabel: DIAS_PT[d3.getDay()], eventos: cruzarEventos(eventosD3, escala.filter(r => r[0] === fmtData(d3)), fmtData(d3)), total: eventosD3.length, key: 'd3', data: fmtData(d3), comOpac: false },
    { label: fmtData(d4), sublabel: DIAS_PT[d4.getDay()], eventos: cruzarEventos(eventosD4, escala.filter(r => r[0] === fmtData(d4)), fmtData(d4)), total: eventosD4.length, key: 'd4', data: fmtData(d4), comOpac: false },
    { label: fmtData(d5), sublabel: DIAS_PT[d5.getDay()], eventos: cruzarEventos(eventosD5, escala.filter(r => r[0] === fmtData(d5)), fmtData(d5)), total: eventosD5.length, key: 'd5', data: fmtData(d5), comOpac: false },
    { label: fmtData(d6), sublabel: DIAS_PT[d6.getDay()], eventos: cruzarEventos(eventosD6, escala.filter(r => r[0] === fmtData(d6)), fmtData(d6)), total: eventosD6.length, key: 'd6', data: fmtData(d6), comOpac: false },
  ];

  const semCob = eventosCruzadosAmanha.filter(e => e.semCob).length;
  const comAtenc = eventosCruzadosAmanha.filter(e => e.atenc.length > 0).length;
  const trabAmanha = escD1.filter(r => r[3] && r[4] && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente').length;
  const folgAmanha = escD1.filter(r => !r[3] || r[5] === 'Folga' || r[5] === 'Folga/Ausente').length;
  const cobPct = equipeRaw.length > 0 ? Math.round(trabAmanha / equipeRaw.length * 100) : 0;
  const atualizado = hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function av(n, bg = '#dbeafe', c = '#1d4ed8') {
    return `<div style="width:24px;height:24px;border-radius:50%;background:${bg};color:${c};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(n)}</div>`;
  }

  function renderEventos(eventosCruzados, comOpacidade = false) {
    if (eventosCruzados.length === 0) return `<div style="padding:20px;text-align:center;color:#aaa;font-size:13px">Nenhum evento</div>`;
    let primeiroAtivo = true;
    return eventosCruzados.map(ev => {
      const evMin = toMin(ev.hora);
      const encerrado = comOpacidade && evMin !== null && evMin < horaAtualMin - 30;
      const idAtivo = (!encerrado && primeiroAtivo && comOpacidade) ? 'id="primeiro-ativo-hoje"' : '';
      if (!encerrado && primeiroAtivo && comOpacidade) primeiroAtivo = false;
      const fraseEnc = encerrado ? gerarFraseEncerrado(ev.nome) : '';
      const [bc, bb, itc] = ev.semCob ? ['var(--badge-red-bg)', 'var(--badge-red-c)', 'var(--badge-red-c)'] : ['var(--badge-green-bg)', 'var(--badge-green-c)', 'var(--badge-green-c)'];
      return `<div ${idAtivo} style="border:1px solid ${encerrado ? 'var(--border)' : bb};border-radius:8px;margin-bottom:10px;overflow:hidden${encerrado ? ';opacity:.35' : ''}">
        <div style="background:${encerrado ? 'var(--card)' : bc};padding:8px 12px;display:flex;align-items:center;gap:10px">
          <div style="font-size:13px;font-weight:700;color:${encerrado ? 'var(--text3)' : 'var(--today-c)'};min-width:50px">${ev.hora || '--'}</div>
          <div style="flex:1"><div style="font-size:12px;font-weight:700;color:${encerrado ? 'var(--text3)' : 'var(--text)'}">${ev.nome}</div><div style="font-size:10px;color:#aaa">${ev.tipo}${ev.local ? ' · <span style=\'font-weight:600;color:var(--text3)\'>' + ev.local + '</span>' : ''}</div></div>
          ${encerrado
          ? `<div style="font-size:10px;font-weight:600;color:#9ca3af;font-style:italic">${fraseEnc}</div>`
          : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
              <div style="font-size:10px;font-weight:700;color:${itc}">${ev.semCob ? 'Sem cobertura' : 'OK'}</div>
              ${ev.semAntecedencia ? `<span style="font-size:14px;animation:pulsar 1s infinite">&#9888;</span>` : ''}
            </div>`
        }
        </div>
        ${!encerrado ? `<div style="padding:8px 12px;background:var(--bg2)">
          ${ev.disp.map(p => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border2)">${av(p.nome)}<span style="flex:1;font-size:11px;font-weight:600">${p.nome}</span><span style="font-size:11px;color:#7dd3fc;font-weight:700">${p.ent}--${p.sai}</span></div>`).join('')}
          ${ev.atenc.map(p => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border2)">${av(p.nome, '#fef3c7', '#92400e')}<span style="flex:1;font-size:11px;font-weight:600">${p.nome}</span><span style="font-size:11px;color:#7dd3fc;font-weight:700">${p.ent}--${p.sai}</span></div>`).join('')}
          ${ev.semCob ? `<div style="text-align:center;padding:6px;color:#991b1b;font-size:11px;font-weight:600">Sem cobertura neste horario</div>` : ''}
          ${ev.aus.length ? `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px">${ev.aus.map(p => `<span style="background:var(--bg3);color:var(--text3);border-radius:3px;padding:1px 6px;font-size:10px">${p.nome.split(' ')[0]}</span>`).join('')}</div>` : ''}
        </div>` : ''}
      </div>`;
    }).join('');
  }

  let tabelaHTML = '';
  nomes.forEach(n => {
    const cargo = equipeRaw.find(r => r[0] === n)?.[1] || '';
    tabelaHTML += `<tr><td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;text-align:left"><div style="display:flex;align-items:center;gap:6px">${av(n)}<div><div style="font-size:11px;font-weight:600;white-space:nowrap">${n}</div>${cargo ? `<div style="font-size:9px;color:#aaa">${cargo}</div>` : ''}</div></div></td>`;
    dias.forEach(d => {
      const df = fmtData(d), isD1 = df === d1Str, isHoje = df === hojeStr;
      const reg = escSem.find(r => r[0] === df && r[2] === n);
      const ausente = ausSem.find(a => a[1] === n && (a[4] === df || a[5] === df));
      const bg = isD1 ? '#eff6ff' : isHoje ? '#fafafa' : '';
      tabelaHTML += `<td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;text-align:center;background:${bg};cursor:pointer" onclick="abrirAjuste('${df}','${n}','${reg ? reg[3] : ''}','${reg ? reg[4] : ''}','${reg ? reg[5] : ''}')">`;
      if (ausente) tabelaHTML += `<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">${ausente[3] || 'Aus.'}</span>`;
      else if (reg) {
        if (reg[5] === 'Folga') tabelaHTML += `<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Folga</span>`;
        else if (!reg[3] && !reg[4]) tabelaHTML += `<span style="color:#d1d5db;font-size:11px">--</span>`;
        else tabelaHTML += `<span style="font-size:11px;color:${isD1 ? '#1d4ed8' : '#333'};font-weight:${isD1 ? 700 : 500}">${reg[3]}--${reg[4]}</span>`;
      } else tabelaHTML += `<span style="color:#e5e7eb;font-size:11px">+</span>`;
      tabelaHTML += `</td>`;
    });
    tabelaHTML += `</tr>`;
  });

  const conteudo = `
<div class="header">
  <div class="logo" style="background:none;padding:0;overflow:visible"><svg width="32" height="32" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="hg" cx="38%" cy="35%" r="62%"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="45%" stop-color="#e53e3e"/><stop offset="100%" stop-color="#7f1d1d"/></radialGradient></defs>
  <rect x="0" y="0" width="72" height="72" rx="18" fill="#e53e3e"/>
  <rect x="0" y="36" width="72" height="36" rx="18" fill="#7f1d1d" opacity="0.3"/>
  <path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/>
  <polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg></div>
  <div><div class="ht">Pulse <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px">Gestor</span></div><div class="hs">${DIAS_FULL[d1.getDay()]} ${d1Str} · ${atualizado}</div></div>
  <div class="hr">
    <span style="font-size:12px;color:#666">Ola, ${nome.split(' ')[0]}</span>
    <a href="/api/escalas?v=semana" class="btn-sm">Escala</a>
    <a href="/api/equipe-view" class="btn-sm">Equipe</a>
    <a href="/api/repositorio" class="btn-sm">Repositorio</a>
    <a href="/api/gerar-escala" class="btn-sm" style="background:#1a2744;border-color:#2a4080;color:#63b3ed">&#10024; IA</a>
    <button class="btn-sm" onclick="location.reload()">&#8635;</button>
    <button id="tt" class="btn-sm" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'&#9728;&#65039;':'&#127769;';})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <form method="POST" action="/api/app?action=logout" style="display:inline"><button type="submit" class="btn-sm">Sair</button></form>
  </div>
</div>
<div class="wrap">
  <div class="metrics">
    <div class="metric blue-m"><div class="ml">Trabalhando amanha</div><div class="mv">${trabAmanha}</div><div class="ms">${cobPct}% cobertura · ${equipeRaw.length} na equipe</div></div>
    <div class="metric ${folgAmanha > 2 ? 'amber-m' : ''}"><div class="ml">Folgas amanha</div><div class="mv">${folgAmanha}</div><div class="ms">${ausencias.filter(a => a[4] === d1Str).length} via Pulse</div></div>
    <div class="metric ${semCob > 0 ? 'red-m' : ''}"><div class="ml">Sem cobertura</div><div class="mv">${semCob}</div><div class="ms">de ${eventosAmanha.length} eventos amanha</div></div>
    <div class="metric" style="display:flex;align-items:center;justify-content:center;text-align:center">
      <div style="width:100%">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px">
          <svg class="pulse-heart-anim" width="28" height="28" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><rect x="0" y="0" width="72" height="72" rx="18" fill="#e53e3e"/><rect x="0" y="36" width="72" height="36" rx="18" fill="#7f1d1d" opacity="0.3"/><path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/><polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span style="font-size:10px;font-weight:700;color:#e53e3e;letter-spacing:.06em;text-transform:uppercase">Frase do dia</span>
        </div>
        <div style="font-size:13px;font-weight:600;font-style:italic;color:#22c55e;line-height:1.5;text-shadow:0 0 12px rgba(34,197,94,.3)">"${fraseDoDia}"</div>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
    <div class="card">
      <div class="card-header">
        <span class="card-title" style="color:#22c55e">#NossoDia</span>
        <span class="badge blue">${eventosHoje.length} eventos</span>
        <span style="font-size:10px;color:var(--text3);margin-left:auto">${hojeStr}</span>
      </div>
      <div id="cb-hoje" class="card-body" style="max-height:520px;overflow-y:auto">${renderEventos(eventosCruzadosHoje, true)}</div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title" style="color:#3b82f6">#NossoDiaAmanhã</span>
        <span class="badge ${semCob > 0 ? 'red' : comAtenc > 0 ? 'amber' : 'green'}">${eventosAmanha.length} eventos</span>
        <span style="font-size:10px;color:var(--text3);margin-left:auto">${d1Str}</span>
      </div>
      <div class="card-body" style="max-height:520px;overflow-y:auto">${renderEventos(eventosCruzadosAmanha, false)}</div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;gap:6px">
        <button onclick="navDia(-1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
        <div style="flex:1;text-align:center">
          ${diasNav.slice(2).map((d, i) => `<div id="tab3-label-${i}" style="display:${i === 0 ? 'block' : 'none'}">
            <span class="card-title" style="color:#a855f7">${d.sublabel} · ${d.label}</span>
            <span class="badge" style="background:#f3e8ff;color:#6b21a8;margin-left:4px">${d.total} ev.</span>
          </div>`).join('')}
        </div>
        <button onclick="navDia(1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div class="card-body" style="max-height:520px;overflow-y:auto">
        ${diasNav.slice(2).map((d, i) => `<div id="painel3-${i}" style="display:${i === 0 ? 'block' : 'none'}">${renderEventos(d.eventos, false)}</div>`).join('')}
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-header">
      <span class="card-title">Escala da semana</span>
      <span style="font-size:10px;color:var(--text3)">Clique para editar</span>
      <a href="/api/escalas?v=semana" class="btn-sm" style="margin-left:auto">Ver completo</a>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;color:#888;background:#fafafa;border-bottom:1px solid #f0f0f0">Colaborador</th>
          ${dias.map(d => {
    const df = fmtData(d), isHoje = df === hojeStr, isD1 = df === d1Str;
    return `<th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:${isHoje ? '#22c55e' : isD1 ? '#1d4ed8' : '#888'};background:${isD1 ? '#eff6ff' : '#fafafa'};border-bottom:1px solid #f0f0f0;white-space:nowrap">${DIAS_PT[d.getDay()]}<br><span style="font-weight:400">${df}</span></th>`;
  }).join('')}
        </tr></thead>
        <tbody>${tabelaHTML}</tbody>
      </table>
    </div>
  </div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h3>Ajustar escala</h3>
    <input type="hidden" id="aj-data"><input type="hidden" id="aj-nome">
    <div class="field"><label>Colaborador</label><input id="aj-colab" readonly style="background:#f9fafb;color:#888"></div>
    <div class="field"><label>Data</label><input id="aj-data-show" readonly style="background:#f9fafb;color:#888"></div>
    <div class="field"><label>Acao</label>
      <select id="aj-acao" onchange="toggleAcao()">
        <option value="horario">Alterar horario</option>
        <option value="folga">Colocar folga</option>
        <option value="remover">Remover da escala</option>
      </select>
    </div>
    <div id="aj-horarios">
      <div class="field"><label>Entrada</label><input type="time" id="aj-entrada"></div>
      <div class="field"><label>Saida</label><input type="time" id="aj-saida"></div>
    </div>
    <div class="field"><label>Observacao</label><input type="text" id="aj-obs" placeholder="opcional"></div>
    <div class="modal-btns">
      <button class="btn-cancel" onclick="fecharModal()">Cancelar</button>
      <button class="btn-primary" onclick="salvarAjuste()">Salvar</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>`;

  const script = `<script>
function abrirAjuste(data,nome,ent,sai,obs){
  document.getElementById('aj-data').value=data;
  document.getElementById('aj-nome').value=nome;
  document.getElementById('aj-colab').value=nome;
  document.getElementById('aj-data-show').value=data;
  document.getElementById('aj-entrada').value=ent||'';
  document.getElementById('aj-saida').value=sai||'';
  document.getElementById('aj-obs').value=obs||'';
  document.getElementById('aj-acao').value='horario';
  toggleAcao();
  document.getElementById('modal').classList.add('open');
}
function fecharModal(){document.getElementById('modal').classList.remove('open');}
function toggleAcao(){document.getElementById('aj-horarios').style.display=document.getElementById('aj-acao').value==='horario'?'block':'none';}
async function salvarAjuste(){
  const body={acao:document.getElementById('aj-acao').value,data:document.getElementById('aj-data').value,colaborador:document.getElementById('aj-nome').value,entrada:document.getElementById('aj-entrada').value,saida:document.getElementById('aj-saida').value,obs:document.getElementById('aj-obs').value};
  const r=await fetch('/api/app?action=ajuste',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.ok){fecharModal();toast('Escala atualizada!');setTimeout(()=>location.reload(),1200);}
  else toast('Erro: '+d.error,'#dc2626');
}
function toast(msg,bg='#1a1a1a'){const t=document.getElementById('toast');t.textContent=msg;t.style.background=bg;t.style.display='block';setTimeout(()=>t.style.display='none',2500);}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)fecharModal();});
window.addEventListener('load',function(){
  var b=document.getElementById('cb-hoje');
  var a=document.getElementById('primeiro-ativo-hoje');
  if(b&&a){
    var pos=0,el=a.previousElementSibling;
    while(el){pos+=el.offsetHeight+10;el=el.previousElementSibling;}
    b.scrollTop=Math.max(0,pos-280);
  }
});
var diaAtual3=0;
function navDia(dir){
  var total=5;
  diaAtual3=(diaAtual3+dir+total)%total;
  for(var i=0;i<total;i++){
    var p=document.getElementById('painel3-'+i);
    var l=document.getElementById('tab3-label-'+i);
    if(p)p.style.display=i===diaAtual3?'block':'none';
    if(l)l.style.display=i===diaAtual3?'block':'none';
  }
}
</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(baseHTML('Gestor', conteudo + CHAT_IA, script));
}
