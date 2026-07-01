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
function iniciais(n) { return (n||'?').split(' ').slice(0,2).map(p=>p[0]||'').join('').toUpperCase() || '?'; }
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function toHoraBRT(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  d.setHours(d.getHours() - 3);
  return d.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || '';
}
function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }
function estaDeServico(ent, sai, horaEv, horaFimEv) {
  if(!ent||!sai||!horaEv) return false;
  const i=toMin(ent), f=toMin(sai), e=toMin(horaEv);
  if(i===null||f===null||e===null) return false;
  const isOvernight = f < i; // turno vira meia-noite (ex: 23:00→07:00)
  const durTurno = isOvernight ? (1440-i)+f : f-i;

  // Verifica se a pessoa está de plantão na hora do evento
  let posNoTurno;
  if(isOvernight) {
    // Turno noturno: cobre das ent até 24:00 + 00:00 até sai
    if(e >= i) posNoTurno = e - i;           // evento na primeira metade (ex: 23:30 dentro de 23:00-07:00)
    else posNoTurno = (1440 - i) + e;         // evento na segunda metade (ex: 04:00 dentro de 23:00-07:00)
  } else {
    // Turno diurno: só cobre entre ent e sai
    if(e < i - 60 || e > f + 15) return false;
    posNoTurno = e - i;
  }
  // Pessoa está de plantão se a hora do evento está dentro do turno (com 60min de tolerância no início)
  return posNoTurno >= -60 && posNoTurno < durTurno + 15;
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
  // Filtra pela data de INÍCIO do evento (campo fld8hthI7oI4MY5aP = Data de início)
  // fldRnfbwPVzFiHMqs é o campo "Data c/ Pós" (data de término) — não usar para filtrar
  const filter=`AND(DATESTR({fld8hthI7oI4MY5aP})='${dataStr}',{Status}!='Cancelado')`;
  try {
    const r=await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=30`,
      {headers:{Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`}});
    const d=await r.json();
    return (d.records||[]).map(r=>({
      nome:r.fields['Match ID']||'Evento',
      hora:r.fields['Horário KO']||r.fields['PGM (horário)']||'',
      horaFim:toHoraBRT(r.fields['Data c/ Pós']||''),
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
          { role: 'system', content: 'Responda com APENAS UMA frase curta de até 6 palavras, sem mencionar o dia da semana. Sem explicações, sem listas. Só a frase animada para equipe de TV ao vivo.' },
          { role: 'user', content: `Frase animada para equipe de TV ao vivo. Data: ${dataStr}.` }
        ]
      })
    });
    const d = await r.json();
    const frase = d.choices?.[0]?.message?.content?.trim()?.replace(/^["']|["']$/g,'') || 'Câmera ligada, coração acelerado!';
    // Remove menções a dias da semana da frase gerada
    const diasSemana = ['domingo','segunda','terça','quarta','quinta','sexta','sábado','segunda-feira','terça-feira'];
    const fraseOk = diasSemana.some(d => frase.toLowerCase().includes(d))
      ? 'Câmera ligada, produção no ar!'
      : frase;
    try { await setSheet('Equipe!K1:L1', [[dataStr, fraseOk]]); } catch {}
    return fraseOk;
  } catch { return 'Camera ligada, coração acelerado, vamos nessa!'; }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
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
    const sessionParts = data.split('~~');
    const nome = sessionParts[0];
    if (!nome) return null;
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
  var amp='&amp;',lt='&lt;',gt='&gt;';
  var s=txt.split('&').join(amp).split('<').join(lt).split('>').join(gt);
  var lines=s.split(String.fromCharCode(10));
  var out=[];
  for(var i=0;i<lines.length;i++){
    var l=lines[i];
    var c0=l.charAt(0),c1=l.charAt(1);
    if((c0==='#')&&l.indexOf(' ')>0){out.push('<div style="font-weight:700">'+l.slice(l.indexOf(' ')+1)+'</div>');}
    else if((c0==='-'||c0==='*')&&c1===' '){out.push('<div style="padding-left:10px">&#8226; '+l.slice(2)+'</div>');}
    else{out.push(l);}
  }
  return out.join('<br>');
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
    var r=await fetch('/api/chat',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:chatHistorico,pagina:chatPagina})});
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
/* ── Métricas ────────────────────────────────────────────────────────────── */
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}
.metric{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;min-width:0;display:flex;flex-direction:column;gap:4px;height:96px;justify-content:center}
.metric.blue-m{background:var(--blue-m-bg);border-color:var(--blue-m-border)}
.metric.red-m{background:var(--red-m-bg);border-color:var(--red-m-border)}
.metric.amber-m{background:var(--amber-m-bg);border-color:var(--amber-m-border)}
.ml{font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.mv{font-size:32px;font-weight:800;line-height:1;color:var(--text)}
.mv.blue-v{color:var(--blue-m-v)}.mv.red-v{color:var(--red-m-v)}.mv.amber-v{color:var(--amber-m-v)}
.ms{font-size:11px;color:var(--text3);line-height:1.35}
/* ── Frase do dia (banner) ───────────────────────────────────────────────── */
.frase-banner{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 18px;display:flex;align-items:center;gap:12px;margin-bottom:16px}
.frase-banner .frase-ic{flex-shrink:0}
.frase-banner .frase-label{font-size:10px;font-weight:700;color:#e53e3e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
.frase-banner .frase-txt{font-size:13px;font-weight:600;font-style:italic;color:#22c55e;line-height:1.4}
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
@media(max-width:640px){
  .wrap{padding:10px}
  .header{padding:8px 10px;gap:6px;flex-wrap:nowrap}
  .ht{font-size:11px!important}.hs{font-size:9px!important}
  .hr{gap:3px;flex-wrap:nowrap}.btn-sm{display:none}.hr .btn-sm-keep{display:flex!important}
  #grelogio-gmt{display:none!important}#gtempo-cidade{display:none!important}
  #gtempo-widget{padding:3px 7px!important}
  #grelogio-brt,#relogio-brt{font-size:13px!important}
  .wrap table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .eventos-grid{grid-template-columns:1fr!important}
  .eventos-tab{display:flex;gap:6px;margin-bottom:10px;overflow-x:auto;white-space:nowrap;padding-bottom:4px}
  .eventos-tab-btn{flex-shrink:0;border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;background:none;color:var(--text3);cursor:pointer}
  .eventos-tab-btn.ativo{background:var(--blue-m-bg);border-color:var(--blue-m-border);color:var(--blue-m-v)}
  .mv{font-size:26px!important}
  .metrics{grid-template-columns:repeat(2,1fr)!important;gap:8px}
  .metric{height:84px!important;padding:12px 14px!important}
  .frase-banner{padding:10px 14px!important}
}
</style>
</head>
<body>
${conteudo}
${script}
</body>
</html>`;
}

function loginPage(erro = '') {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
  const BASE_URL = process.env.PULSE_BASE_URL || 'https://pulse-ia-six.vercel.app';
  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(BASE_URL + '/api/auth/callback')}&response_type=code&scope=email%20profile&access_type=offline&prompt=consent`;

  const erroMsg = erro === 'usuario_nao_encontrado' ? 'Sua conta Google não está na equipe. Fale com o gestor.'
    : erro === 'acesso_negado' ? 'Acesso negado pelo Google.'
    : erro === 'falha_auth' ? 'Falha na autenticação. Tente novamente.'
    : erro || '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:40px 36px;width:380px;max-width:calc(100vw - 32px);text-align:center}
.logo{width:56px;height:56px;border-radius:14px;background:#e53e3e;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
h1{font-size:22px;font-weight:700;color:#e2e8f0;margin-bottom:6px}
.sub{font-size:13px;color:#718096;margin-bottom:28px}
.btn-google{width:100%;background:#fff;border:none;border-radius:10px;padding:13px 16px;font-size:14px;font-weight:600;color:#1a1a1a;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:background .15s}
.btn-google:hover{background:#f0f0f0}
.erro{background:#1f1010;border:1px solid #3d2020;border-radius:8px;padding:10px 14px;font-size:12px;color:#fc8181;margin-bottom:20px}
</style>
</head>
<body>
<div class="box">
  <div class="logo">
    <svg width="28" height="28" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
      <path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/>
      <polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <h1>Pulse</h1>
  <p class="sub">Portal operacional · Livemode</p>
  ${erroMsg ? `<div class="erro">⚠️ ${erroMsg}</div>` : ''}
  <a href="${oauthUrl}" style="text-decoration:none">
    <button class="btn-google" type="button">
      <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.3z"/></svg>
      Entrar com Google
    </button>
  </a>
</div>
</body>
</html>`;
}


// Verifica se uma data DD/MM está dentro do intervalo de ausência
function dentroAusencia(aus, df) {
  const ini = aus[4] || "";
  const fim = aus[5] || ini;
  if (!ini) return false;
  const toNum = s => { const p = s.split("/"); return parseInt(p[1]) * 100 + parseInt(p[0]); };
  const n = toNum(df), i = toNum(ini), f = toNum(fim);
  if (f >= i) return n >= i && n <= f;
  return n >= i || n <= f;
}
function cruzarEventos(eventos, escHoje, dataStr) {
  return eventos.map(ev => {
    const disp = escHoje.filter(r => r[3] && r[4] && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente' && estaDeServico(r[3], r[4], ev.hora, ev.horaFim));
    const atenc = escHoje.filter(r => r[3] && r[4] && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente' && statusTurno(r[3], r[4], ev.hora) !== null && !disp.find(d => d[2] === r[2]));
    const aus = escHoje.filter(r => !disp.find(d => d[2] === r[2]) && !atenc.find(a => a[2] === r[2]));
    const semCob = disp.length === 0;
    const semAntecedencia = atenc.length > 0 && disp.length === 0;

    // Deduplica por nome — prefere a entrada com horário mais relevante (turno do dia atual)
    function dedup(arr) {
      const seen = new Map();
      arr.forEach(r => { if(!seen.has(r[2])) seen.set(r[2], r); });
      return Array.from(seen.values());
    }

    return {
      ...ev,
      disp: dedup(disp).map(r => ({ nome: r[2], ent: r[3], sai: r[4] })),
      atenc: dedup(atenc).map(r => ({ nome: r[2], ent: r[3], sai: r[4] })),
      aus: dedup(aus).map(r => ({ nome: r[2] })),
      semCob,
      semAntecedencia,
    };
  });
}

export default async function handler(req, res) {
  const action = req.query.action || '';

  if (req.method === 'POST' && action === 'logout') {
    clearSession(res);
    return res.redirect(302, '/api/app');
  }

  const session = getSession(req);
  if (!session) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(loginPage());
  }

  const { nome } = session;

  if (req.method === 'POST' && action === 'ajuste') {
    const equipeCheck = await getSheet('Equipe!A2:L200');
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

  if (req.method === 'POST' && action === 'solicitar') {
    try {
      const { tipo, motivo, dataInicio, dataFim } = req.body || {};
      if (!tipo || !dataInicio) return res.status(400).json({ error: 'Dados inválidos' });
      const novoId = 'PLS-' + String(Date.now()).slice(-6);
      await appendSheet('Ausências!A:F', [[novoId, nome, tipo, motivo || '', dataInicio, dataFim || dataInicio]]);
      return res.status(200).json({ ok: true, id: novoId });
    } catch(err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  }

  if (req.method === 'POST' && action === 'cancelar-solicitacao') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const ausRaw = await getSheet('Ausências!A2:F500');
    const idx = ausRaw.findIndex(r => r[0] === id && r[1] === nome);
    if (idx < 0) return res.status(404).json({ error: 'Solicitação não encontrada' });
    await setSheet(`Ausências!A${idx + 2}:F${idx + 2}`, [['CANCELADO', nome, ausRaw[idx][2], ausRaw[idx][3], ausRaw[idx][4], ausRaw[idx][5]]]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && action === 'publicar') {
    const eqCheck = await getSheet('Equipe!A2:I200');
    const uCheck = eqCheck.find(r=>r[0]===nome);
    if (uCheck?.[8] !== 'gestor') return res.status(403).json({ error: 'Acesso negado' });
    const { horizonte } = req.body || {};
    try {
      // Tenta escrever direto — se a aba não existe, cria e tenta de novo
      async function salvarConfig() {
        const cfgRaw = await getSheet('PulseConfig!A2:B20');
        const cfgIdx = (cfgRaw||[]).findIndex(r=>r[0]==='publicacao_horizonte');
        if (!horizonte) {
          if (cfgIdx >= 0) await setSheet(`PulseConfig!A${cfgIdx+2}:B${cfgIdx+2}`, [['','']]);
        } else if (cfgIdx >= 0) {
          await setSheet(`PulseConfig!B${cfgIdx+2}`, [[horizonte]]);
        } else {
          await appendSheet('PulseConfig!A:B', [['publicacao_horizonte', horizonte]]);
        }
      }
      try {
        await salvarConfig();
      } catch(e1) {
        // Aba não existe — cria via batchUpdate
        if (e1.message.includes('Unable to parse range') || e1.message.includes('404') || e1.message.includes('No grid')) {
          await sheetsRequest(process.env.GOOGLE_SHEET_ID, ':batchUpdate', 'POST', {
            requests: [{ addSheet: { properties: { title: 'PulseConfig' } } }]
          });
          await setSheet('PulseConfig!A1:B1', [['chave','valor']]);
          await salvarConfig();
        } else { throw e1; }
      }
      return res.status(200).json({ ok: true, horizonte: horizonte || '' });
    } catch(e) {
      console.error('publicar erro:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

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

  const [equipeRaw, escalaRaw, ausenciasRaw, configRaw] = await Promise.all([
    getSheet('Equipe!A2:L200'),
    getSheet('Escala!A2:F2000'),
    getSheet('Ausências!A2:I500'),
    getSheet('PulseConfig!A2:B20'),
  ]);

  const usuario = equipeRaw.find(r => r[0] === nome && (r[10]||'ativo') === 'ativo');

  if (!usuario) {
    clearSession(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(loginPage('Usuário não encontrado ou sem acesso. Tente fazer login novamente.'));
  }

  const isGestor = usuario?.[8] === 'gestor' && (usuario?.[10]||'ativo') === 'ativo';

  // Horizonte de publicação: gestores veem tudo, colaboradores só até a data publicada
  const configMap = Object.fromEntries((configRaw||[]).filter(r=>r[0]).map(r=>[r[0],r[1]||'']));
  const horizonteStr = configMap['publicacao_horizonte']||''; // formato DD/MM
  function dentroHorizonte(df) {
    if(isGestor || !horizonteStr) return true;
    // Compara DD/MM — assume mesmo ano; se mês do horizonte < mês atual, é próximo ano
    const [dh,mh]=horizonteStr.split('/').map(Number);
    const [dd,md]=df.split('/').map(Number);
    const anoBase = hoje.getFullYear();
    const dataHorizonte = new Date(anoBase, mh-1, dh);
    const dataEvento = new Date(anoBase, md-1, dd);
    if(dataEvento < new Date(anoBase, hoje.getMonth(), hoje.getDate()-1)) return true; // passado sempre visível
    return dataEvento <= dataHorizonte;
  }

  const escala = isGestor ? escalaRaw.map(r=>r) : escalaRaw.filter(r=>!r[0]||dentroHorizonte(r[0]));
  const ausencias = ausenciasRaw.map(r => r);

  const dias = [hoje, d1, d2, d3, d4, d5, d6];
  const escSem = escala.filter(r => dias.some(d => fmtData(d) === r[0]));
  const ausSem = ausencias;
  const nomes = equipeRaw.map(r => r[0]);

  // Inclui turnos noturnos do dia anterior que ainda estão de serviço no dia atual
  // Ex: turno 23:00–07:00 de ontem cobre eventos de 00:00–07:00 de hoje
  function diaAnteriorStr(dfStr) {
    const [dd,mm] = dfStr.split('/').map(Number);
    const d = new Date(new Date().getFullYear(), mm-1, dd);
    d.setDate(d.getDate()-1);
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');
  }
  function escalaComNoturnosAnteriores(escalaArr, dataStr) {
    const ontem = diaAnteriorStr(dataStr);
    const diaAtual = escalaArr.filter(r => r[0] === dataStr);
    // Turnos noturnos do dia anterior (saída < entrada = virou meia-noite)
    const noturnos = escalaArr.filter(r =>
      r[0] === ontem && r[3] && r[4] && toMin(r[4]) < toMin(r[3])
    );
    // Combina: hoje + noturnos de ontem (podem haver duplicatas de nome, tudo bem)
    return [...diaAtual, ...noturnos];
  }

  const escHoje = escalaComNoturnosAnteriores(escala, hojeStr);
  const escD1 = escala.filter(r => r[0] === d1Str);
  const minhasSolicits = ausencias.filter(a => a[1] === nome && a[0] !== 'CANCELADO').sort((a,b) => (b[4]||'').localeCompare(a[4]||'')).slice(0,10);
  const colegasJson = JSON.stringify(nomes.filter(n => n !== nome));

  const TIPO_CORES_BTN = {
    'Férias': ['#dbeafe','#1d4ed8'],
    'Folga programada': ['#dcfce7','#166534'],
    'Atestado médico': ['#fee2e2','#991b1b'],
    'Folga direcionada': ['#fef3c7','#92400e'],
  };
  function badgeTipo(tipo) {
    const [bg, c] = TIPO_CORES_BTN[tipo] || ['#f3f4f6','#374151'];
    return `<span style="background:${bg};color:${c};border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">${tipo}</span>`;
  }
  function renderMinhasSolicits() {
    if (!minhasSolicits.length) return `<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px">Nenhuma solicitação registrada</div>`;
    return minhasSolicits.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border2)">
        <div style="flex:1">
          ${badgeTipo(s[2])}
          ${s[3] ? `<div style="font-size:11px;color:var(--text2);margin-top:3px">${s[3]}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;font-weight:600;color:var(--text)">${s[4]}${s[5] && s[5] !== s[4] ? ' → ' + s[5] : ''}</div>
          <div style="font-size:10px;color:var(--text3)">${s[0]}</div>
        </div>
        <button onclick="cancelarSolicit('${s[0]}')" style="background:none;border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:10px;color:var(--text3);cursor:pointer">✕</button>
      </div>`).join('');
  }

  const SOLICITAR_BTN = `
<div id="sol-btn" onclick="toggleSolicitar()" style="position:fixed;bottom:24px;left:24px;z-index:900;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#16a34a,#15803d);box-shadow:0 4px 20px rgba(22,163,74,.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;transition:transform .2s" title="Solicitações">📋</div>

<div id="sol-box" style="display:none;position:fixed;bottom:88px;left:24px;z-index:900;width:380px;max-width:calc(100vw - 48px);background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.3);max-height:90vh;flex-direction:column;overflow:hidden">
  <div style="background:var(--header);padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);flex-shrink:0">
    <span style="font-size:16px">📋</span>
    <div style="flex:1;font-size:13px;font-weight:600;color:#e2e8f0">Minhas solicitações</div>
    <button onclick="toggleSolicitar()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:20px;padding:4px;line-height:1">&times;</button>
  </div>
  <div style="display:flex;gap:4px;padding:10px 14px 0;flex-shrink:0">
    <button id="sol-tab-nova" onclick="solTab('nova')" style="flex:1;border:none;border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:#16a34a;color:#fff;cursor:pointer">+ Nova</button>
    <button id="sol-tab-hist" onclick="solTab('hist')" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:none;color:var(--text2);cursor:pointer">Histórico</button>
  </div>
  <div style="overflow-y:auto;padding:12px 14px;flex:1">
    <div id="sol-form-area">
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Tipo</label>
        <select id="sol-tipo" onchange="solTipoChange()" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
          <option value="Férias">🏖️ Férias</option>
          <option value="Folga programada">☀️ Folga programada</option>
          <option value="Atestado médico">🏥 Atestado médico</option>
          <option value="Troca de horário">🔄 Troca de horário</option>
        </select>
      </div>
      <div id="sol-ferias-area">
        <div style="background:var(--blue-m-bg);border:1px solid var(--blue-m-border);border-radius:6px;padding:8px 10px;font-size:11px;color:var(--blue-m-v);margin-bottom:10px">
          📌 CLT: mín. 14 dias num período, mín. 5 dias nos demais. Máx. 3 períodos.
        </div>
        <div id="sol-periodos"></div>
        <button onclick="adicionarPeriodo()" id="sol-add-periodo" style="width:100%;border:1px dashed var(--border);border-radius:6px;padding:7px;font-size:12px;color:var(--text3);background:none;cursor:pointer;margin-bottom:10px">+ Adicionar período</button>
        <div id="sol-ferias-erro" style="display:none;color:#dc2626;font-size:11px;margin-bottom:8px"></div>
      </div>
      <div id="sol-datas-area">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Data início</label>
            <div style="display:flex;gap:6px">
              <input type="date" id="sol-inicio" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
              <select id="sol-inicio-ano" onchange="ajustarAnoData('sol-inicio',this.value)" title="Pular direto para o ano" style="width:64px;border:1px solid var(--border);border-radius:6px;padding:8px 4px;font-size:12px;background:var(--bg2);color:var(--text);outline:none"></select>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Data fim</label>
            <div style="display:flex;gap:6px">
              <input type="date" id="sol-fim" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
              <select id="sol-fim-ano" onchange="ajustarAnoData('sol-fim',this.value)" title="Pular direto para o ano" style="width:64px;border:1px solid var(--border);border-radius:6px;padding:8px 4px;font-size:12px;background:var(--bg2);color:var(--text);outline:none"></select>
            </div>
          </div>
        </div>
      </div>
      <div id="sol-atestado-area" style="display:none">
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Arquivo do atestado</label>
          <div id="sol-upload-area" style="border:2px dashed var(--border);border-radius:8px;padding:16px;text-align:center;cursor:pointer" onclick="document.getElementById('sol-arquivo').click()">
            <div style="font-size:24px;margin-bottom:4px">📎</div>
            <div style="font-size:12px;color:var(--text3)">Clique para selecionar PDF, JPG ou PNG</div>
            <div id="sol-arquivo-nome" style="font-size:11px;color:#16a34a;margin-top:4px;display:none"></div>
          </div>
          <input type="file" id="sol-arquivo" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="solArquivoSelecionado(this)">
          <div id="sol-upload-progress" style="display:none;margin-top:6px">
            <div style="background:var(--border);border-radius:4px;height:4px;overflow:hidden">
              <div id="sol-upload-bar" style="background:#16a34a;height:100%;width:0%;transition:width .3s"></div>
            </div>
            <div style="font-size:10px;color:var(--text3);margin-top:3px" id="sol-upload-status">Enviando...</div>
          </div>
        </div>
      </div>
      <div id="sol-troca-area" style="display:none">
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Colega para trocar</label>
          <select id="sol-colega" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
            <option value="">Selecione...</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Meu dia</label>
            <input type="date" id="sol-troca-meu-dia" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Dia do colega</label>
            <input type="date" id="sol-troca-colega-dia" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
          </div>
        </div>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Observação (opcional)</label>
        <textarea id="sol-obs" rows="2" placeholder="Ex: viagem em família, CID M54..." style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;background:var(--bg2);color:var(--text);outline:none;resize:none;font-family:inherit"></textarea>
      </div>
      <button onclick="enviarSolicits()" style="width:100%;background:#16a34a;border:none;border-radius:6px;padding:10px;font-size:13px;font-weight:600;color:#fff;cursor:pointer">Enviar solicitação</button>
      <div id="sol-msg" style="display:none;margin-top:8px;text-align:center;font-size:12px;font-weight:600;padding:8px;border-radius:6px"></div>
    </div>
    <div id="sol-hist-area" style="display:none">
      ${renderMinhasSolicits()}
    </div>
  </div>
</div>
<script>
var solAberto=false;
var solColegas=${colegasJson};
var solPeriodos=1;
function gerarOpcoesAno(selectId, anosAtras, anosFrente){
  var sel=document.getElementById(selectId);
  if(!sel) return;
  var anoAtual=new Date().getFullYear();
  var html='';
  for(var y=anoAtual-(anosAtras||0); y<=anoAtual+(anosFrente===undefined?2:anosFrente); y++){
    html+='<option value="'+y+'"'+(y===anoAtual?' selected':'')+'>'+y+'</option>';
  }
  sel.innerHTML=html;
  // Adiciona listener programaticamente — evita problemas de escaping de aspas no template literal
  var inputId=selectId.replace(/-ano$/,'');
  sel.addEventListener('change',function(){ajustarAnoData(inputId,this.value);});
}
function ajustarAnoData(inputId, ano){
  var el=document.getElementById(inputId);
  if(!el) return;
  var base=el.value?new Date(el.value+'T00:00:00'):new Date();
  var mm=String(base.getMonth()+1).padStart(2,'0');
  var dd=String(base.getDate()).padStart(2,'0');
  el.value=ano+'-'+mm+'-'+dd;
  el.dispatchEvent(new Event('change'));
}
(function(){
  var sel=document.getElementById('sol-colega');
  if (sel) solColegas.forEach(function(c){var o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o);});
  adicionarPeriodoInicial();
  gerarOpcoesAno('sol-inicio-ano');
  gerarOpcoesAno('sol-fim-ano');
})();
function adicionarPeriodoInicial(){var c=document.getElementById('sol-periodos');if(!c)return;c.innerHTML='';solPeriodos=1;c.innerHTML=criarPeriodoHTML(1);atualizarBotaoAddPeriodo();gerarOpcoesAno('p1-inicio-ano');gerarOpcoesAno('p1-fim-ano');}
function criarPeriodoHTML(n){var label=n===1?'1º período (mín. 14 dias)':n===2?'2º período (mín. 5 dias)':'3º período (mín. 5 dias)';return '<div id="periodo-'+n+'" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:11px;font-weight:600;color:var(--text3)">'+label+'</span>'+(n>1?'<button onclick="removerPeriodo('+n+')" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px">✕</button>':'')+'</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="display:block;font-size:10px;color:var(--text3);margin-bottom:3px">Início</label><div style="display:flex;gap:4px"><input type="date" id="p'+n+'-inicio" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none"><select id="p'+n+'-inicio-ano" title="Ano" style="width:58px;border:1px solid var(--border);border-radius:5px;padding:6px 2px;font-size:11px;background:var(--bg);color:var(--text);outline:none"></select></div></div><div><label style="display:block;font-size:10px;color:var(--text3);margin-bottom:3px">Fim</label><div style="display:flex;gap:4px"><input type="date" id="p'+n+'-fim" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none"><select id="p'+n+'-fim-ano" title="Ano" style="width:58px;border:1px solid var(--border);border-radius:5px;padding:6px 2px;font-size:11px;background:var(--bg);color:var(--text);outline:none"></select></div></div></div><div id="p'+n+'-dias" style="font-size:10px;color:var(--text3);margin-top:5px;text-align:right"></div></div>';}
function adicionarPeriodo(){if(solPeriodos>=3)return;solPeriodos++;var c=document.getElementById('sol-periodos');var div=document.createElement('div');div.innerHTML=criarPeriodoHTML(solPeriodos);c.appendChild(div.firstChild);['inicio','fim'].forEach(function(t){var el=document.getElementById('p'+solPeriodos+'-'+t);if(el)el.addEventListener('change',function(){calcDias(solPeriodos);});});atualizarBotaoAddPeriodo();gerarOpcoesAno('p'+solPeriodos+'-inicio-ano');gerarOpcoesAno('p'+solPeriodos+'-fim-ano');}
function removerPeriodo(n){var el=document.getElementById('periodo-'+n);if(el)el.remove();solPeriodos=Math.max(1,solPeriodos-1);atualizarBotaoAddPeriodo();}
function atualizarBotaoAddPeriodo(){var btn=document.getElementById('sol-add-periodo');if(btn)btn.style.display=solPeriodos>=3?'none':'block';}
function calcDias(n){var ini=document.getElementById('p'+n+'-inicio');var fim=document.getElementById('p'+n+'-fim');var info=document.getElementById('p'+n+'-dias');if(!ini||!fim||!info)return;if(ini.value&&fim.value){var d=Math.round((new Date(fim.value)-new Date(ini.value))/(1000*60*60*24))+1;var min=n===1?14:5;info.textContent=d+' dia'+(d!==1?'s':'')+(d<min?' ⚠ mín. '+min+' dias':'');info.style.color=d<min?'#dc2626':'#16a34a';}}
setTimeout(function(){['inicio','fim'].forEach(function(t){var el=document.getElementById('p1-'+t);if(el)el.addEventListener('change',function(){calcDias(1);});});},100);
function toggleSolicitar(){solAberto=!solAberto;var box=document.getElementById('sol-box');box.style.display=solAberto?'flex':'none';document.getElementById('sol-btn').style.transform=solAberto?'scale(0.9)':'scale(1)';}
function solTab(tab){var isNova=tab==='nova';document.getElementById('sol-form-area').style.display=isNova?'block':'none';document.getElementById('sol-hist-area').style.display=isNova?'none':'block';document.getElementById('sol-tab-nova').style.cssText='flex:1;border:none;border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:'+(isNova?'#16a34a':'none')+';color:'+(isNova?'#fff':'var(--text2)')+';cursor:pointer';document.getElementById('sol-tab-hist').style.cssText='flex:1;border:'+(isNova?'1px solid var(--border)':'none')+';border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:'+(isNova?'none':'#16a34a')+';color:'+(isNova?'var(--text2)':'#fff')+';cursor:pointer';}
function solTipoChange(){var tipo=document.getElementById('sol-tipo').value;var isFerias=tipo==='Férias';var isTroca=tipo==='Troca de horário';var isAtestado=tipo==='Atestado médico';document.getElementById('sol-ferias-area').style.display=isFerias?'block':'none';document.getElementById('sol-datas-area').style.display=(!isFerias&&!isTroca)?'block':'none';document.getElementById('sol-troca-area').style.display=isTroca?'block':'none';document.getElementById('sol-atestado-area').style.display=isAtestado?'block':'none';}
function validarFerias(){var periodos=[];for(var i=1;i<=solPeriodos;i++){var ini=document.getElementById('p'+i+'-inicio');var fim=document.getElementById('p'+i+'-fim');if(!ini||!fim||!document.getElementById('periodo-'+i))continue;if(!ini.value||!fim.value)return 'Preencha todas as datas dos períodos';var dias=Math.round((new Date(fim.value)-new Date(ini.value))/(1000*60*60*24))+1;if(dias<1)return 'Data fim deve ser após data início';periodos.push({inicio:ini.value,fim:fim.value,dias:dias});}if(periodos.length===0)return 'Informe pelo menos um período';var total=periodos.reduce(function(s,p){return s+p.dias;},0);var temMinimo14=periodos.some(function(p){return p.dias>=14;});var todosMin5=periodos.every(function(p){return p.dias>=5;});if(!temMinimo14)return 'Pelo menos um período deve ter mínimo 14 dias (CLT art. 134)';if(!todosMin5)return 'Nenhum período pode ter menos de 5 dias (CLT art. 134)';if(total>30)return 'Total de dias não pode exceder 30 dias';return null;}
function fmtDt(s){if(!s)return '';var p=s.split('-');return p[2]+'/'+p[1];}
function solArquivoSelecionado(input){var f=input.files[0];if(!f)return;var nome=document.getElementById('sol-arquivo-nome');nome.textContent=f.name;nome.style.display='block';document.getElementById('sol-upload-area').style.borderColor='#16a34a';}
async function uploadAtestado(file){var prog=document.getElementById('sol-upload-progress');var bar=document.getElementById('sol-upload-bar');var status=document.getElementById('sol-upload-status');prog.style.display='block';bar.style.width='30%';status.textContent='Enviando arquivo...';var fd=new FormData();fd.append('file',file);try{bar.style.width='60%';var r=await fetch('/api/upload-atestado',{method:'POST',credentials:'include',body:fd});bar.style.width='100%';var d=await r.json();if(d.ok){status.textContent='✓ Arquivo enviado!';return d.url;}else{status.textContent='Erro: '+d.error;status.style.color='#dc2626';return null;}}catch(e){status.textContent='Erro de conexão: '+e.message;status.style.color='#dc2626';return null;}}
async function enviarSolicits(){var tipo=document.getElementById('sol-tipo').value;var obs=document.getElementById('sol-obs').value;var msg=document.getElementById('sol-msg');msg.style.display='none';var body={tipo,motivo:obs};if(tipo==='Férias'){var err=validarFerias();if(err){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='⚠ '+err;return;}var periodos=[];for(var i=1;i<=solPeriodos;i++){var ini=document.getElementById('p'+i+'-inicio');var fim=document.getElementById('p'+i+'-fim');if(!ini||!fim||!document.getElementById('periodo-'+i))continue;if(ini.value&&fim.value)periodos.push({inicio:fmtDt(ini.value),fim:fmtDt(fim.value)});}body.periodos=periodos;body.dataInicio=periodos[0].inicio;body.dataFim=periodos[periodos.length-1].fim;body.motivo=(obs?obs+' | ':'')+'Períodos: '+periodos.map(function(p,i){return (i+1)+'º: '+p.inicio+' a '+p.fim;}).join(', ');}else if(tipo==='Troca de horário'){var colega=document.getElementById('sol-colega').value;var meuDia=document.getElementById('sol-troca-meu-dia').value;var colegaDia=document.getElementById('sol-troca-colega-dia').value;if(!colega||!meuDia||!colegaDia){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='⚠ Preencha colega e datas';return;}body.dataInicio=fmtDt(meuDia);body.dataFim=fmtDt(meuDia);body.motivo='Troca com '+colega+': meu dia '+fmtDt(meuDia)+' pelo dia '+fmtDt(colegaDia)+(obs?' | '+obs:'');}else{var inicio=document.getElementById('sol-inicio').value;var fim=document.getElementById('sol-fim').value;if(!inicio){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='⚠ Informe a data de início';return;}body.dataInicio=fmtDt(inicio);body.dataFim=fmtDt(fim||inicio);if(tipo==='Atestado médico'){var arquivo=document.getElementById('sol-arquivo').files[0];if(arquivo){var url=await uploadAtestado(arquivo);if(!url){return;}body.motivo=(obs?obs+' | ':'')+'Anexo: '+url;}}}try{var r=await fetch('/api/app?action=solicitar',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var d=await r.json();if(d.ok){msg.style.display='block';msg.style.background='#0d2010';msg.style.color='#68d391';msg.textContent='✓ Enviado! ID: '+d.id;setTimeout(function(){location.reload();},1800);}else{msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='Erro: '+d.error;}}catch(e){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='Erro de conexão: '+e.message;}}
async function cancelarSolicit(id){if(!confirm('Cancelar esta solicitação?'))return;var r=await fetch('/api/app?action=cancelar-solicitacao',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});var d=await r.json();if(d.ok)location.reload();else alert('Erro: '+d.error);}
</script>`;

  if (!isGestor) {
    const cargo = usuario?.[1] || '';
    const nucleo = usuario?.[2] || 'Operacoes';
    const turnoHoje = escala.find(r => r[0] === hojeStr && r[2] === nome);
    const turnoD1 = escala.find(r => r[0] === d1Str && r[2] === nome);
    const ausHoje = ausencias.find(a => a[1] === nome && dentroAusencia(a, hojeStr) && a[0] !== 'CANCELADO');
    const ausD1 = ausencias.find(a => a[1] === nome && dentroAusencia(a, d1Str) && a[0] !== 'CANCELADO');

    const [eventosHoje, eventosAmanha, eventosD2c, eventosD3c, eventosD4c, eventosD5c, eventosD6c] = await Promise.all([
      getEventos(hojeAirtable),
      getEventos(fmtAirtable(d1)),
      getEventos(fmtAirtable(d2)),
      getEventos(fmtAirtable(d3)),
      getEventos(fmtAirtable(d4)),
      getEventos(fmtAirtable(d5)),
      getEventos(fmtAirtable(d6)),
    ]);

    // ── Frase do dia inteligente ──────────────────────────────────────────
    async function getFraseInteligente() {
      // Detectar contexto do colaborador
      const toDateNum = s => { if (!s) return 0; const p = s.split('/'); return parseInt(p[1])*100+parseInt(p[0]); };
      const hojeNum = toDateNum(hojeStr);
      const d1Num = toDateNum(d1Str);

      // Verificar férias próximas (nos próximos 14 dias)
      const minhasAus = ausencias.filter(a => a[1] === nome && a[0] !== 'CANCELADO');
      let feriasBreve = null;
      let folgaAmanha = null;
      for (const a of minhasAus) {
        const iniNum = toDateNum(a[4]);
        const diff = iniNum - hojeNum;
        if (a[2] === 'Férias' && diff > 0 && diff <= 1400) { // próximos ~14 dias (MMDD)
          const dias = Math.abs(Math.round((new Date(a[4].split('/')[1]+'/'+a[4].split('/')[0]+'/'+new Date().getFullYear()) - new Date()) / 86400000));
          if (dias <= 14) feriasBreve = { tipo: a[2], inicio: a[4], dias };
        }
        if (dentroAusencia(a, d1Str) && (a[2] === 'Folga programada' || a[2] === 'Folga direcionada')) {
          folgaAmanha = a;
        }
      }

      // Colegas de folga amanhã
      const colegasFolgaAmanha = ausencias.filter(a =>
        a[1] !== nome && dentroAusencia(a, d1Str) && a[0] !== 'CANCELADO' &&
        (a[2] === 'Folga programada' || a[2] === 'Folga direcionada')
      ).map(a => a[1].split(' ')[0]);

      // Turno de amanhã
      const turnoD1Str = turnoD1 ? `${turnoD1[3]}–${turnoD1[4]}` : null;

      // Montar contexto para a IA
      let contexto = `Colaborador: ${nome.split(' ')[0]}. Hoje: ${DIAS_FULL[hoje.getDay()]}, ${hojeStr}.`;
      if (ausHoje) contexto += ` Hoje está de ${ausHoje[2]}.`;
      else if (turnoHoje) contexto += ` Turno hoje: ${turnoHoje[3]}–${turnoHoje[4]}.`;
      if (folgaAmanha) contexto += ` AMANHÃ TEM FOLGA!`;
      else if (turnoD1Str) contexto += ` Amanhã: ${turnoD1Str}.`;
      if (feriasBreve) contexto += ` FÉRIAS em ${feriasBreve.dias} dias (${feriasBreve.inicio})!`;
      if (colegasFolgaAmanha.length) contexto += ` Colegas de folga amanhã: ${colegasFolgaAmanha.slice(0,3).join(', ')}.`;

      try {
        // Verificar cache
        try {
          const cache = await getSheet('Equipe!K1:L1');
          if (cache?.[0]?.[0] === hojeStr+nome && cache?.[0]?.[1]) return cache[0][1];
        } catch {}

        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant', max_tokens: 100,
            messages: [
              { role: 'system', content: 'Voce e o assistente do Pulse, app interno de uma empresa de TV. Gere UMA mensagem curta (max 12 palavras) e animada para o colaborador. Se houver info sobre ferias proximas, folga amanha ou colegas de folga, use isso de forma criativa e personalizada. Sem explicacoes, so a mensagem. Use o primeiro nome do colaborador quando relevante.' },
              { role: 'user', content: contexto }
            ]
          })
        });
        const d = await r.json();
        const frase = d.choices?.[0]?.message?.content?.trim() || 'Câmera ligada, coração acelerado!';
        try { await setSheet('Equipe!K1:L1', [[hojeStr+nome, frase]]); } catch {}
        return frase;
      } catch {
        if (folgaAmanha) return `Amanhã é seu dia de descanso, ${nome.split(' ')[0]}! ☀️`;
        if (feriasBreve) return `${feriasBreve.dias} dias para as férias! Aguenta firme! 🏖️`;
        return 'Câmera ligada, coração acelerado! 🎬';
      }
    }

    const fraseDoDia = await getFraseInteligente();
    const totalEventosHoje = eventosHoje.length;
    const pulseSpeed = totalEventosHoje >= 15 ? '0.6s' : totalEventosHoje >= 10 ? '1s' : totalEventosHoje >= 5 ? '1.5s' : '2.5s';

    // ── Helpers de card ───────────────────────────────────────────────────
    function cardTurno(turno, aus, label, isAmanha = false) {
      if (aus) {
        const tipo = aus[2] || 'Ausencia';
        const icones = {'Férias':'🏖️','Folga programada':'☀️','Atestado médico':'🏥','Troca de horário':'🔄','Folga direcionada':'📌'};
        const cores = {'Férias':['#1a2744','#2a4080','#63b3ed'],'Folga programada':['#0d2010','#166534','#68d391'],'Atestado médico':['#1f1010','#991b1b','#fc8181'],'Folga direcionada':['#2d1f00','#92400e','#f6ad55']};
        const [bg,bc,tc] = cores[tipo] || ['#1a0d2e','#6b21a8','#c084fc'];
        const ic = icones[tipo] || '📋';
        const periodo = aus[4] ? `${aus[4]}${aus[5] && aus[5] !== aus[4] ? ' → '+aus[5] : ''}` : '';
        return `<div style="background:${bg};border:1px solid ${bc};border-radius:12px;padding:14px 16px">
          <div style="font-size:10px;color:${tc};font-weight:600;text-transform:uppercase;margin-bottom:6px;opacity:.8">${label}</div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:28px">${ic}</div>
            <div>
              <div style="font-size:18px;font-weight:700;color:${tc}">${tipo}</div>
              ${periodo ? `<div style="font-size:11px;color:${tc};opacity:.7;margin-top:2px">${periodo}</div>` : ''}
            </div>
          </div>
        </div>`;
      }
      if (!turno || (!turno[3] && !turno[4])) return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:6px">${label}</div><div style="font-size:15px;color:var(--text4)">Sem escala</div></div>`;
      if (turno[5] === 'Folga') return `<div style="background:#1f1a0d;border:1px solid #3d3010;border-radius:12px;padding:14px 16px"><div style="font-size:10px;color:#f6ad55;font-weight:600;text-transform:uppercase;margin-bottom:6px;opacity:.8">${label}</div><div style="display:flex;align-items:center;gap:10px"><div style="font-size:28px">☀️</div><div style="font-size:18px;font-weight:700;color:#f6ad55">Folga</div></div></div>`;
      const obsVal = turno[5] || '';
      const temAnexo = obsVal.includes('Anexo:') || obsVal.startsWith('http');
      const anexoUrl = temAnexo ? (obsVal.includes('Anexo:') ? obsVal.split('Anexo:')[1].trim() : obsVal) : '';
      const obsDisplay = (!temAnexo && obsVal) ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">${obsVal}</div>` : '';
      const anexoDisplay = temAnexo ? `<a href="${anexoUrl}" target="_blank" style="font-size:11px;color:#3b82f6;margin-top:4px;display:block">📎 Ver atestado</a>` : '';
      const [bg, bc, tc] = isAmanha ? ['#1a2744','#2a4080','#63b3ed'] : ['var(--card)','var(--border)','var(--text)'];
      return `<div style="background:${bg};border:1px solid ${bc};border-radius:12px;padding:14px 16px">
        <div style="font-size:10px;color:${isAmanha?'#63b3ed':'var(--text3)'};font-weight:600;text-transform:uppercase;margin-bottom:6px">${label}</div>
        <div style="font-size:26px;font-weight:800;color:${tc};letter-spacing:1px">${turno[3]} <span style="font-size:18px;opacity:.5">→</span> ${turno[4]}</div>
        ${obsDisplay}${anexoDisplay}
      </div>`;
    }

    function renderSemanaColab() {
      return dias.map(d => {
        const df = fmtData(d);
        const t = escala.find(r => r[0] === df && r[2] === nome);
        const aus = ausencias.find(a => a[1] === nome && dentroAusencia(a, df));
        const isHoje = df === hojeStr;
        const isD1 = df === d1Str;
        let bg = 'var(--card)', bc = 'var(--border)', tc = 'var(--text3)', label = '--';
        if (aus) {
          const tipo = aus[2] || '';
          const icones = {'Férias':'🏖️','Folga programada':'☀️','Atestado médico':'🏥','Troca de horário':'🔄','Folga direcionada':'📌'};
          if (tipo === 'Férias') { bg = '#1a2744'; bc = '#2a4080'; tc = '#63b3ed'; }
          else if (tipo === 'Atestado médico') { bg = '#1f1010'; bc = '#991b1b'; tc = '#fc8181'; }
          else { bg = '#1a0d2e'; bc = '#6b21a8'; tc = '#c084fc'; }
          label = icones[tipo] || '📋';
        }
        else if (t?.[5] === 'Folga') { bg = '#1f1a0d'; bc = '#3d3010'; tc = '#f6ad55'; label = '☀️'; }
        else if (t?.[3] && t?.[4]) { bg = isHoje ? '#0d2010' : isD1 ? '#1a2744' : 'var(--card)'; bc = isHoje ? '#166534' : isD1 ? '#2a4080' : 'var(--border)'; tc = isHoje ? '#68d391' : isD1 ? '#63b3ed' : 'var(--text)'; label = `${t[3]}<br><span style="opacity:.5;font-size:8px">→</span><br>${t[4]}`; }
        else if (t && t[5] && (t[5].includes('Anexo:') || t[5].startsWith('http'))) {
          const url = t[5].includes('Anexo:') ? t[5].split('Anexo:')[1].trim() : t[5];
          bg = '#1a0d2e'; bc = '#6b21a8'; tc = '#c084fc';
          label = `<a href="${url}" target="_blank" style="color:#c084fc;text-decoration:none">📎</a>`;
        }
        return `<div style="background:${bg};border:1px solid ${bc};border-radius:8px;padding:7px 4px;text-align:center${isHoje?';box-shadow:0 0 0 2px '+bc:''}">
          <div style="font-size:8px;font-weight:700;color:${tc};text-transform:uppercase;margin-bottom:2px">${DIAS_PT[d.getDay()]}</div>
          <div style="font-size:8px;color:${tc};opacity:.7;margin-bottom:4px">${df}</div>
          <div style="font-size:10px;font-weight:700;color:${tc};line-height:1.4">${label}</div>
        </div>`;
      }).join('');
    }

    // ── Grade mensal ──────────────────────────────────────────────────────
    function renderMesColab() {
      const ano = hoje.getFullYear();
      const mes = hoje.getMonth();
      const primeiroDia = new Date(ano, mes, 1);
      const ultimoDia = new Date(ano, mes + 1, 0);
      const nomeMes = primeiroDia.toLocaleString('pt-BR', { month: 'long' });
      const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

      let html = `<div style="margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;text-transform:capitalize;color:var(--text);margin-bottom:10px">${nomeMes} ${ano}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px">
          ${diasSemana.map(d => `<div style="text-align:center;font-size:9px;font-weight:700;color:var(--text3);padding:3px 0;text-transform:uppercase">${d}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">`;

      // Células vazias antes do primeiro dia
      for (let i = 0; i < primeiroDia.getDay(); i++) {
        html += `<div></div>`;
      }

      for (let d = 1; d <= ultimoDia.getDate(); d++) {
        const data = new Date(ano, mes, d);
        const df = fmtData(data);
        const t = escala.find(r => r[0] === df && r[2] === nome);
        const aus = ausencias.find(a => a[1] === nome && dentroAusencia(a, df) && a[0] !== 'CANCELADO');
        const isHoje = df === hojeStr;

        let bg = 'var(--bg2)', bc = 'transparent', tc = 'var(--text3)', label = '', ic = '';
        if (aus) {
          const tipo = aus[2] || '';
          const icones = {'Férias':'🏖️','Folga programada':'☀️','Atestado médico':'🏥','Troca de horário':'🔄','Folga direcionada':'📌'};
          if (tipo === 'Férias') { bg = '#1a2744'; bc = '#2a4080'; tc = '#63b3ed'; }
          else if (tipo === 'Atestado médico') { bg = '#1f1010'; bc = '#991b1b'; tc = '#fc8181'; }
          else { bg = '#1a0d2e'; bc = '#6b21a8'; tc = '#c084fc'; }
          ic = icones[tipo] || '📋';
        } else if (t?.[5] === 'Folga') {
          bg = '#1f1a0d'; bc = '#3d3010'; tc = '#f6ad55'; ic = '☀️';
        } else if (t?.[3] && t?.[4]) {
          bg = '#0d1a10'; bc = '#166534'; tc = '#68d391';
          label = `<div style="font-size:7px;line-height:1.2;margin-top:2px">${t[3]}<br>${t[4]}</div>`;
        }

        html += `<div style="background:${bg};border:1px solid ${bc};border-radius:6px;padding:4px 3px;text-align:center;min-height:42px${isHoje ? ';box-shadow:0 0 0 2px #63b3ed' : ''}">
          <div style="font-size:10px;font-weight:${isHoje?'800':'600'};color:${isHoje?'#63b3ed':tc}">${d}</div>
          ${ic ? `<div style="font-size:13px;line-height:1">${ic}</div>` : label}
        </div>`;
      }

      html += `</div></div>`;
      return html;
    }

    const diasExtras = [
      {label: fmtData(d2), sub: DIAS_PT[d2.getDay()], evs: eventosD2c},
      {label: fmtData(d3), sub: DIAS_PT[d3.getDay()], evs: eventosD3c},
      {label: fmtData(d4), sub: DIAS_PT[d4.getDay()], evs: eventosD4c},
      {label: fmtData(d5), sub: DIAS_PT[d5.getDay()], evs: eventosD5c},
      {label: fmtData(d6), sub: DIAS_PT[d6.getDay()], evs: eventosD6c},
    ];
    const diasExtrasJson = JSON.stringify(diasExtras.map(d => ({label:d.label,sub:d.sub,evs:d.evs.map(e=>({nome:e.nome,hora:e.hora,horaFim:e.horaFim,tipo:e.tipo,local:e.local}))})));
    // Cruzar com escala para mostrar quem está no turno (igual à visão do gestor)
    const escHoje2   = escalaComNoturnosAnteriores(escala, hojeStr);
    const escAmanha2 = escalaComNoturnosAnteriores(escala, d1Str);
    const eventosHojeJson   = JSON.stringify(cruzarEventos(eventosHoje,  escHoje2,  hojeStr).map(e => ({nome:e.nome,hora:e.hora,horaFim:e.horaFim,tipo:e.tipo,local:e.local,disp:e.disp,semCob:e.semCob})));
    const eventosAmanhaJson = JSON.stringify(cruzarEventos(eventosAmanha, escAmanha2, d1Str).map(e => ({nome:e.nome,hora:e.hora,horaFim:e.horaFim,tipo:e.tipo,local:e.local,disp:e.disp,semCob:e.semCob})));
    const hojeAno = hoje.getFullYear();
    const hojeNumMes = hoje.getMonth();

    const conteudoEquipe = `
<div class="header" style="background:var(--header)">
  <div class="logo" style="background:none;padding:0;overflow:visible">
    <svg id="pulse-logo-colab" width="36" height="36" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg" style="animation:pulse-heart-colab ${pulseSpeed} ease-in-out infinite">
      <defs><radialGradient id="hgc" cx="38%" cy="35%" r="62%"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="45%" stop-color="#e53e3e"/><stop offset="100%" stop-color="#7f1d1d"/></radialGradient></defs>
      <rect x="0" y="0" width="72" height="72" rx="18" fill="#e53e3e"/>
      <rect x="0" y="36" width="72" height="36" rx="18" fill="#7f1d1d" opacity="0.3"/>
      <path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/>
      <polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <div>
    <div class="ht">Pulse <span style="font-size:10px;font-weight:400;color:#666">· Livemode</span></div>
    <div class="hs" id="relogio-header">${DIAS_FULL[hoje.getDay()]} ${hojeStr}</div>
  </div>
  <div class="hr">
    <div id="tempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="tempo-icone">⏳</span>
      <span id="tempo-temp" style="font-weight:700">--°C</span>
      <span id="tempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;font-weight:600;color:#718096;letter-spacing:.04em">Brasil</span>
        <span id="relogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;font-weight:600;color:#4a5568;letter-spacing:.04em">GMT</span>
        <span id="relogio-gmt" style="font-size:11px;font-weight:600;color:#718096;font-variant-numeric:tabular-nums"></span>
      </div>
    </div>
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'&#9728;&#65039;':'&#127769;';})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <form method="POST" action="/api/app?action=logout" style="display:inline"><button type="submit" class="btn-sm">Sair</button></form>
  </div>
</div>
<style>
@keyframes pulse-heart-colab{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
.ev-ao-vivo{border-color:#22c55e!important;animation:border-pulse-green 2s ease-in-out infinite}
.ev-proximo-30{border-color:#f59e0b!important}
.ev-proximo-60{border-color:#f97316!important}
@keyframes border-pulse-green{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4)}50%{box-shadow:0 0 0 4px rgba(34,197,94,0)}}
.tab-nav-colab{display:flex;gap:6px;margin-bottom:14px}
.tab-btn-colab{flex:1;border:1px solid var(--border);border-radius:8px;padding:7px;font-size:12px;font-weight:600;background:none;color:var(--text3);cursor:pointer;transition:all .15s}
.tab-btn-colab.ativo{background:var(--blue-m-bg);border-color:var(--blue-m-border);color:var(--blue-m-v)}
/* ── MOBILE ── */
@media(max-width:640px){
  .header{padding:8px 12px;gap:6px}
  .ht{font-size:12px!important}
  .hr{gap:4px}
  .btn-sm{padding:3px 7px;font-size:10px}
  #gtempo-cidade,#tempo-cidade{display:none}
  #grelogio-brt,#relogio-brt{font-size:12px!important}
  #grelogio-gmt,#relogio-gmt{font-size:9px!important}
  #gtempo-temp,#tempo-temp{font-size:11px!important}
  .wrap{padding:10px 12px}
  /* Perfil: empilha no mobile */
  .wrap > div[style*="grid-template-columns:1fr 1fr"]:first-child{grid-template-columns:1fr!important}
  /* Cards hoje/amanhã: empilha */
  #painel-dia > div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr!important}
  /* 3 colunas de eventos: empilha */
  #painel-dia > div[style*="grid-template-columns:1fr 1fr 1fr"]{grid-template-columns:1fr!important}
  /* Abas menores */
  .tab-btn-colab{font-size:10px;padding:6px 4px}
}
</style>
<div class="wrap">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#fff;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(99,102,241,.4)">${iniciais(nome)}</div>
      <div>
        <div style="font-size:16px;font-weight:700">${nome}</div>
        <div style="font-size:12px;color:var(--text3)">${cargo}${nucleo ? ' · ' + nucleo : ''}</div>
      </div>
    </div>
    <div style="border-left:1px solid var(--border);padding-left:14px;display:flex;align-items:center;gap:12px">
      <svg style="animation:pulse-heart-colab ${pulseSpeed} ease-in-out infinite;flex-shrink:0" width="32" height="32" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="72" height="72" rx="18" fill="#e53e3e"/>
        <rect x="0" y="36" width="72" height="36" rx="18" fill="#7f1d1d" opacity="0.3"/>
        <path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/>
        <polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <div style="font-size:9px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Frase do dia</div>
        <div style="font-size:13px;font-weight:600;font-style:italic;color:#22c55e;line-height:1.5;text-shadow:0 0 10px rgba(34,197,94,.25)">"${fraseDoDia}"</div>
      </div>
    </div>
  </div>

  <div class="tab-nav-colab">
    <button class="tab-btn-colab ativo" onclick="trocarAba('dia')" id="tab-dia">📅 Hoje / Amanhã</button>
    <button class="tab-btn-colab" onclick="trocarAba('semana')" id="tab-semana">📆 Semana</button>
    <button class="tab-btn-colab" onclick="trocarAba('mes')" id="tab-mes">🗓️ Mês</button>
  </div>

  <div id="painel-dia">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      ${cardTurno(turnoHoje, ausHoje, 'Hoje')}
      ${cardTurno(turnoD1, ausD1, 'Amanhã', true)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="card">
        <div class="card-header">
          <span class="card-title" style="color:#22c55e">🟢 Hoje</span>
          <span class="badge blue">${eventosHoje.length}</span>
          <span style="font-size:10px;color:var(--text3);margin-left:auto">${hojeStr}</span>
        </div>
        <div id="lista-eventos-hoje" class="card-body" style="max-height:480px;overflow-y:auto;padding:8px"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title" style="color:#3b82f6">📅 Amanhã</span>
          <span class="badge blue">${eventosAmanha.length}</span>
          <span style="font-size:10px;color:var(--text3);margin-left:auto">${d1Str}</span>
        </div>
        <div id="lista-eventos-amanha" class="card-body" style="max-height:480px;overflow-y:auto;padding:8px"></div>
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;align-items:center;gap:6px">
          <button onclick="navDiaColab(-1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
          <div style="flex:1;text-align:center" id="nav-colab-label">
            <span class="card-title" style="color:#a855f7">${fmtData(d2)}</span>
            <span class="badge" style="background:#f3e8ff;color:#6b21a8;margin-left:4px">${eventosD2c.length} ev.</span>
          </div>
          <button onclick="navDiaColab(1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
        </div>
        <div id="lista-eventos-extra" class="card-body" style="max-height:480px;overflow-y:auto;padding:8px"></div>
      </div>
    </div>
  </div>

  <div id="painel-semana" style="display:none">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
        <button onclick="navSemana(-1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
        <div style="flex:1;text-align:center;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em" id="semana-label">Próximos 7 dias</div>
        <button onclick="navSemana(1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div class="grid7" id="semana-grid"></div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border);padding-top:10px;align-items:center">
        <span style="font-size:10px;color:var(--text3);font-weight:600">Legenda:</span>
        <span style="font-size:10px;background:#0d1a10;border:1px solid #166534;color:#68d391;border-radius:4px;padding:2px 8px">🟢 Trabalhando</span>
        <span style="font-size:10px;background:#1f1a0d;border:1px solid #3d3010;color:#f6ad55;border-radius:4px;padding:2px 8px">☀️ Folga</span>
        <span style="font-size:10px;background:#1a2744;border:1px solid #2a4080;color:#63b3ed;border-radius:4px;padding:2px 8px">🏖️ Férias</span>
        <span style="font-size:10px;background:#1f1010;border:1px solid #991b1b;color:#fc8181;border-radius:4px;padding:2px 8px">🏥 Atestado</span>
        <span style="font-size:10px;background:#1a0d2e;border:1px solid #6b21a8;color:#c084fc;border-radius:4px;padding:2px 8px">📋 Outras ausências</span>
      </div>
    </div>
  </div>

  <div id="painel-mes" style="display:none">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
        <button onclick="navMes(-1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
        <div style="flex:1;text-align:center;font-size:13px;font-weight:700;text-transform:capitalize;color:var(--text)" id="mes-label"></div>
        <button onclick="navMes(1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px">
        ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d => `<div style="text-align:center;font-size:9px;font-weight:700;color:var(--text3);padding:3px 0;text-transform:uppercase">${d}</div>`).join('')}
      </div>
      <div id="mes-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px"></div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border);padding-top:10px;align-items:center">
        <span style="font-size:10px;color:var(--text3);font-weight:600">Legenda:</span>
        <span style="font-size:10px;background:#0d1a10;border:1px solid #166534;color:#68d391;border-radius:4px;padding:2px 8px">🟢 Trabalhando</span>
        <span style="font-size:10px;background:#1f1a0d;border:1px solid #3d3010;color:#f6ad55;border-radius:4px;padding:2px 8px">☀️ Folga</span>
        <span style="font-size:10px;background:#1a2744;border:1px solid #2a4080;color:#63b3ed;border-radius:4px;padding:2px 8px">🏖️ Férias</span>
        <span style="font-size:10px;background:#1f1010;border:1px solid #991b1b;color:#fc8181;border-radius:4px;padding:2px 8px">🏥 Atestado</span>
        <span style="font-size:10px;background:#1a0d2e;border:1px solid #6b21a8;color:#c084fc;border-radius:4px;padding:2px 8px">📋 Outras ausências</span>
      </div>
    </div>
  </div>
</div>

<script>
var _evHoje = ${eventosHojeJson};
var _evAmanha = ${eventosAmanhaJson};
var _diasExtras = ${diasExtrasJson};
var _diaExtraAtual = 0;

// Dados completos do colaborador para navegação livre de semana/mês (independem da janela dos próximos 7 dias)
var _escalaColab = ${JSON.stringify(escala.filter(r => r[2] === nome).map(r => [r[0], r[3] || '', r[4] || '', r[5] || '']))};
var _ausenciasColab = ${JSON.stringify(ausencias.filter(a => a[1] === nome && a[0] !== 'CANCELADO').map(a => [a[2] || '', a[3] || '', a[4] || '', a[5] || '']))};
var _hojeBase = new Date(${hoje.getFullYear()}, ${hoje.getMonth()}, ${hoje.getDate()});
var _hojeStrJs = '${hojeStr}';
var DIAS_PT_JS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
var _semanaOffset = 0;
var _mesOffset = 0;

function fmtDataJs(d) { return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'); }
function dentroAusenciaJs(aus, df) {
  var ini = aus[2] || '', fim = aus[3] || ini;
  if (!ini) return false;
  function toNum(s) { var p = s.split('/'); return parseInt(p[1])*100 + parseInt(p[0]); }
  var n = toNum(df), i = toNum(ini), f = toNum(fim);
  if (f >= i) return n >= i && n <= f;
  return n >= i || n <= f;
}
function findEscalaColab(df) { return _escalaColab.find(function(r) { return r[0] === df; }); }
function findAusenciaColab(df) { return _ausenciasColab.find(function(a) { return dentroAusenciaJs(a, df); }); }

function renderSemanaGrid(offsetDays) {
  var html = '';
  for (var i = 0; i < 7; i++) {
    var d = new Date(_hojeBase); d.setDate(_hojeBase.getDate() + offsetDays + i);
    var df = fmtDataJs(d);
    var t = findEscalaColab(df);
    var aus = findAusenciaColab(df);
    var isHoje = (offsetDays === 0 && i === 0);
    var bg = 'var(--card)', bc = 'var(--border)', tc = 'var(--text3)', label = '--';
    if (aus) {
      var tipo = aus[0] || '';
      var icones = {'Férias':'🏖️','Folga programada':'☀️','Atestado médico':'🏥','Troca de horário':'🔄','Folga direcionada':'📌'};
      if (tipo === 'Férias') { bg='#1a2744'; bc='#2a4080'; tc='#63b3ed'; }
      else if (tipo === 'Atestado médico') { bg='#1f1010'; bc='#991b1b'; tc='#fc8181'; }
      else { bg='#1a0d2e'; bc='#6b21a8'; tc='#c084fc'; }
      label = icones[tipo] || '📋';
    } else if (t && t[3] === 'Folga') {
      bg='#1f1a0d'; bc='#3d3010'; tc='#f6ad55'; label='☀️';
    } else if (t && t[1] && t[2]) {
      bg = isHoje ? '#0d2010' : 'var(--card)';
      bc = isHoje ? '#166534' : 'var(--border)';
      tc = isHoje ? '#68d391' : 'var(--text)';
      label = t[1] + '<br><span style="opacity:.5;font-size:8px">&rarr;</span><br>' + t[2];
    } else if (t && t[3] && (t[3].indexOf('Anexo:') >= 0 || t[3].indexOf('http') === 0)) {
      var url = t[3].indexOf('Anexo:') >= 0 ? t[3].split('Anexo:')[1].trim() : t[3];
      bg='#1a0d2e'; bc='#6b21a8'; tc='#c084fc';
      label = '<a href="'+url+'" target="_blank" style="color:#c084fc;text-decoration:none">📎</a>';
    }
    html += '<div style="background:'+bg+';border:1px solid '+bc+';border-radius:8px;padding:7px 4px;text-align:center'+(isHoje?';box-shadow:0 0 0 2px '+bc:'')+'">'
      + '<div style="font-size:8px;font-weight:700;color:'+tc+';text-transform:uppercase;margin-bottom:2px">'+DIAS_PT_JS[d.getDay()]+'</div>'
      + '<div style="font-size:8px;color:'+tc+';opacity:.7;margin-bottom:4px">'+df+'</div>'
      + '<div style="font-size:10px;font-weight:700;color:'+tc+';line-height:1.4">'+label+'</div>'
      + '</div>';
  }
  return html;
}

function navSemana(dir) { _semanaOffset += dir * 7; atualizarSemana(); }

function atualizarSemana() {
  var ini = new Date(_hojeBase); ini.setDate(_hojeBase.getDate() + _semanaOffset);
  var fim = new Date(ini); fim.setDate(ini.getDate() + 6);
  var lbl = document.getElementById('semana-label');
  var nav = '';
  if (_semanaOffset === 0) nav = 'Semana atual';
  else if (_semanaOffset === -7) nav = '← Semana passada';
  else if (_semanaOffset === 7) nav = 'Próxima semana →';
  else if (_semanaOffset < 0) nav = Math.abs(_semanaOffset/7) + ' sem. atrás';
  else nav = (_semanaOffset/7) + ' sem. à frente';
  if (lbl) lbl.innerHTML = '<span style="color:var(--text3);font-size:10px">' + nav + '</span><br>' + fmtDataJs(ini) + ' — ' + fmtDataJs(fim);
  var grid = document.getElementById('semana-grid');
  if (grid) grid.innerHTML = renderSemanaGrid(_semanaOffset);
}

function renderMesGrid(offsetMonths) {
  var base = new Date(_hojeBase.getFullYear(), _hojeBase.getMonth() + offsetMonths, 1);
  var ano = base.getFullYear(), mes = base.getMonth();
  var ultimoDia = new Date(ano, mes + 1, 0).getDate();
  var primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  var html = '';
  for (var i = 0; i < primeiroDiaSemana; i++) html += '<div></div>';
  for (var dd = 1; dd <= ultimoDia; dd++) {
    var data = new Date(ano, mes, dd);
    var df = fmtDataJs(data);
    var t = findEscalaColab(df);
    var aus = findAusenciaColab(df);
    var isHoje = (offsetMonths === 0 && df === _hojeStrJs);
    var bg = 'var(--bg2)', bc = 'transparent', tc = 'var(--text3)', label = '', ic = '';
    if (aus) {
      var tipo = aus[0] || '';
      var icones = {'Férias':'🏖️','Folga programada':'☀️','Atestado médico':'🏥','Troca de horário':'🔄','Folga direcionada':'📌'};
      if (tipo === 'Férias') { bg='#1a2744'; bc='#2a4080'; tc='#63b3ed'; }
      else if (tipo === 'Atestado médico') { bg='#1f1010'; bc='#991b1b'; tc='#fc8181'; }
      else { bg='#1a0d2e'; bc='#6b21a8'; tc='#c084fc'; }
      ic = icones[tipo] || '📋';
    } else if (t && t[3] === 'Folga') {
      bg='#1f1a0d'; bc='#3d3010'; tc='#f6ad55'; ic='☀️';
    } else if (t && t[1] && t[2]) {
      bg='#0d1a10'; bc='#166534'; tc='#68d391';
      label = '<div style="font-size:7px;line-height:1.2;margin-top:2px">'+t[1]+'<br>'+t[2]+'</div>';
    }
    html += '<div style="background:'+bg+';border:1px solid '+bc+';border-radius:6px;padding:4px 3px;text-align:center;min-height:42px'+(isHoje?';box-shadow:0 0 0 2px #63b3ed':'')+'">'
      + '<div style="font-size:10px;font-weight:'+(isHoje?'800':'600')+';color:'+(isHoje?'#63b3ed':tc)+'">'+dd+'</div>'
      + (ic ? '<div style="font-size:13px;line-height:1">'+ic+'</div>' : label)
      + '</div>';
  }
  return html;
}

function navMes(dir) { _mesOffset += dir; atualizarMes(); }

function atualizarMes() {
  var base = new Date(_hojeBase.getFullYear(), _hojeBase.getMonth() + _mesOffset, 1);
  var nomeMes = base.toLocaleString('pt-BR', { month: 'long' });
  var lbl = document.getElementById('mes-label');
  var sufixo = _mesOffset === 0 ? ' <span style="font-size:10px;color:var(--text3);font-weight:400">(mês atual)</span>'
    : _mesOffset < 0 ? ' <span style="font-size:10px;color:var(--text3);font-weight:400">(histórico)</span>'
    : ' <span style="font-size:10px;color:var(--text3);font-weight:400">(futuro)</span>';
  if (lbl) lbl.innerHTML = nomeMes + ' ' + base.getFullYear() + sufixo;
  var grid = document.getElementById('mes-grid');
  if (grid) grid.innerHTML = renderMesGrid(_mesOffset);
}

function toMin(h){if(!h)return null;var p=h.split(':');return parseInt(p[0])*60+(parseInt(p[1])||0);}

function statusEvento(hora, agora, horaFim) {
  var m = toMin(hora);
  if (m === null) return 'neutro';
  var f = toMin(horaFim);
  if (f !== null) {
    if (f < m) f += 1440; // evento atravessa a meia-noite
    if (agora >= m && agora <= f) return 'aovivo'; // está dentro da janela real do evento
    if (agora > f) return (agora > f + 30) ? 'encerrado' : 'aovivo'; // pequena folga pós-término (atraso/overtime)
  } else {
    if (m < agora - 30) return 'encerrado';
    if (m <= agora + 5 && m >= agora - 30) return 'aovivo';
  }
  if (m <= agora + 30) return 'proximo30';
  if (m <= agora + 60) return 'proximo60';
  return 'futuro';
}

function statusLabel(s) {
  if (s==='aovivo') return '<span style="background:#166534;color:#86efac;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">● AO VIVO</span>';
  if (s==='proximo30') return '<span style="background:#451a03;color:#fcd34d;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">⚡ &lt;30min</span>';
  if (s==='proximo60') return '<span style="background:#431407;color:#fb923c;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">🔜 &lt;60min</span>';
  if (s==='encerrado') return '<span style="color:#4a5568;font-size:10px">Encerrado</span>';
  return '';
}

function borderClass(s) {
  if (s==='aovivo') return 'ev-ao-vivo';
  if (s==='proximo30') return 'ev-proximo-30';
  if (s==='proximo60') return 'ev-proximo-60';
  if (s==='encerrado') return 'ev-encerrado';
  return '';
}

function renderEventos(eventos, containerId, agora, isHoje) {
  var c = document.getElementById(containerId);
  if (!c) return;
  if (!eventos.length) {
    c.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;font-size:13px">Nenhum evento</div>';
    return;
  }

  var html = '';
  var primeiroAtivo = false;

  eventos.forEach(function(ev) {
    var s = isHoje ? statusEvento(ev.hora, agora, ev.horaFim) : 'futuro';
    var encerrado = s === 'encerrado';

    if (encerrado) {
      // Encerrado: compacto, apagado, hora riscada
      html += '<div style="border:1px solid var(--border2);border-radius:6px;margin-bottom:3px;opacity:0.45;transition:opacity .2s" onmouseenter="this.style.opacity=0.85" onmouseleave="this.style.opacity=0.45">';
      html += '<div style="padding:5px 10px;display:flex;align-items:center;gap:10px">';
      html += '<div style="font-size:12px;font-weight:700;min-width:44px;color:var(--text3);font-variant-numeric:tabular-nums;text-decoration:line-through">' + (ev.hora||'--') + (ev.horaFim?'–'+ev.horaFim:'') + '</div>';
      html += '<div style="flex:1"><div style="font-size:11px;color:var(--text3)">' + ev.nome + '</div>';
      html += '<div style="font-size:9px;color:var(--text4)">' + ev.tipo + (ev.local ? ' · ' + ev.local : '') + '</div></div>';
      html += '<div style="font-size:9px;color:var(--text4)">Encerrado</div>';
      html += '</div></div>';
    } else {
      // Ativo/futuro: destaque normal com status
      var bc = borderClass(s);
      var lbl = statusLabel(s);
      var isAoVivo = s === 'aovivo';
      var bgExtra = isAoVivo ? ';background:rgba(34,197,94,.07)' : s === 'proximo30' ? ';background:rgba(245,158,11,.04)' : s === 'proximo60' ? ';background:rgba(249,115,22,.03)' : '';
      var idAttr = (isAoVivo && !primeiroAtivo) ? ' id="ev-ativo-colab"' : '';
      if (isAoVivo && !primeiroAtivo) primeiroAtivo = true;
      html += '<div' + idAttr + ' class="' + bc + '" style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden;transition:border-color .3s,box-shadow .3s' + bgExtra + '">';
      html += '<div style="padding:8px 12px;display:flex;align-items:center;gap:10px">';
      html += '<div style="font-size:13px;font-weight:800;min-width:48px;color:var(--text);font-variant-numeric:tabular-nums">' + (ev.hora||'--') + (ev.horaFim?'<br><span style="font-size:9px;font-weight:600;opacity:.6">–'+ev.horaFim+'</span>':'') + '</div>';
      html += '<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--text)">' + ev.nome + '</div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:1px">' + ev.tipo + (ev.local ? ' · <span style="font-weight:600">' + ev.local + '</span>' : '') + '</div>';
      // Nomes de quem está de turno — com horário completo (igual gestor)
      if (ev.disp && ev.disp.length) {
        html += '<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,.07);padding-top:5px">';
        ev.disp.forEach(function(p){
          var ini = p.nome.split(' ');
          var abrev = ini.map(function(w,i){return i===0?w[0].toUpperCase()+(w[1]||'').toUpperCase():''}).filter(Boolean).join('').slice(0,2);
          html += '<div style="display:flex;align-items:center;gap:6px;padding:2px 0">'
            + '<div style="width:22px;height:22px;border-radius:50%;background:#2d3748;color:#a0aec0;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + abrev + '</div>'
            + '<span style="flex:1;font-size:11px;font-weight:600;color:var(--text)">' + p.nome + '</span>'
            + '<span style="font-size:11px;color:#7dd3fc;font-weight:700;font-variant-numeric:tabular-nums">' + (p.ent||'') + (p.sai?'–'+p.sai:'') + '</span>'
            + '</div>';
        });
        html += '</div>';
      } else if (ev.semCob) {
        html += '<div style="font-size:9px;color:#fc8181;margin-top:3px;font-weight:600">⚠ Sem cobertura neste horário</div>';
      }
      html += '</div>';
      if (lbl) html += '<div>' + lbl + '</div>';
      html += '</div></div>';
    }
  });

  c.innerHTML = html;

  // Scroll automático para o primeiro evento ativo
  if (isHoje) {
    setTimeout(function() {
      var el = c.querySelector('#ev-ativo-colab');
      if (el) c.scrollTop = Math.max(0, el.offsetTop - 40);
    }, 80);
  }
}
function atualizarEventos() {
  var now = new Date();
  var brtParts = new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  var bh = parseInt(brtParts.find(function(p){return p.type==='hour';}).value);
  var bm = parseInt(brtParts.find(function(p){return p.type==='minute';}).value);
  var minAtual = bh*60 + bm;
  renderEventos(_evHoje, 'lista-eventos-hoje', minAtual, true);
  renderEventos(_evAmanha, 'lista-eventos-amanha', minAtual, false);
  if (_diasExtras.length) {
    var d = _diasExtras[_diaExtraAtual];
    renderEventos(d.evs, 'lista-eventos-extra', 0, false);
  }
}

function atualizarRelogio() {
  var now = new Date();
  var brtParts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(now);
  var bh = brtParts.find(function(p){return p.type==='hour';}).value;
  var bm = brtParts.find(function(p){return p.type==='minute';}).value;
  var bs = brtParts.find(function(p){return p.type==='second';}).value;
  var elBrt = document.getElementById('relogio-brt');
  if (elBrt) elBrt.textContent = bh+':'+bm+':'+bs;
  var gh = String(now.getUTCHours()).padStart(2,'0');
  var gm = String(now.getUTCMinutes()).padStart(2,'0');
  var gs = String(now.getUTCSeconds()).padStart(2,'0');
  var elGmt = document.getElementById('relogio-gmt');
  if (elGmt) elGmt.textContent = gh+':'+gm+':'+gs;
}

async function carregarTempo() {
  try {
    var loc = null;
    try {
      var r1 = await fetch('https://ipapi.co/json/');
      var j1 = await r1.json();
      if (j1.latitude) loc = {lat: j1.latitude, lon: j1.longitude, city: j1.city};
    } catch(e) {}
    if (!loc) loc = {lat: -22.9068, lon: -43.1729, city: 'Rio de Janeiro'};
    var wmo = await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo');
    var wd = await wmo.json();
    var temp = wd.current && wd.current.temperature_2m !== undefined ? Math.round(wd.current.temperature_2m) : '--';
    var code = wd.current ? (wd.current.weathercode || 0) : 0;
    var icons = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',99:'⛈️'};
    document.getElementById('tempo-icone').textContent = icons[code] || '🌡️';
    document.getElementById('tempo-temp').textContent = temp+'°C';
    document.getElementById('tempo-cidade').textContent = loc.city || '';
  } catch(e) {
    document.getElementById('tempo-icone').textContent = '🌡️';
    document.getElementById('tempo-temp').textContent = '--°C';
  }
}

function trocarAba(aba) {
  ['dia','semana','mes'].forEach(function(a) {
    var p = document.getElementById('painel-'+a);
    var t = document.getElementById('tab-'+a);
    if (p) p.style.display = a === aba ? 'block' : 'none';
    if (t) t.className = 'tab-btn-colab' + (a === aba ? ' ativo' : '');
  });
}

function navDiaColab(dir) {
  _diaExtraAtual = (_diaExtraAtual + dir + _diasExtras.length) % _diasExtras.length;
  var d = _diasExtras[_diaExtraAtual];
  var lbl = document.getElementById('nav-colab-label');
  if (lbl) lbl.innerHTML = '<span class="card-title" style="color:#a855f7">'+d.sub+' · '+d.label+'</span><span class="badge" style="background:#f3e8ff;color:#6b21a8;margin-left:4px">'+d.evs.length+' ev.</span>';
  renderEventos(d.evs, 'lista-eventos-extra', 0, false);
}

// Garantir execução após DOM pronto
function iniciar() {
  try { atualizarEventos(); } catch(e) { console.error('atualizarEventos erro:', e); }
  try { atualizarRelogio(); } catch(e) {}
  try { carregarTempo(); } catch(e) {}
  try { atualizarSemana(); } catch(e) { console.error('atualizarSemana erro:', e); }
  try { atualizarMes(); } catch(e) { console.error('atualizarMes erro:', e); }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
setInterval(atualizarRelogio, 1000);
setInterval(atualizarEventos, 60000);
</script>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');


    return res.status(200).send(baseHTML('Equipe', conteudoEquipe + SOLICITAR_BTN + CHAT_IA));
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
  const eventosCruzadosAmanha = cruzarEventos(eventosAmanha, escD1, d1Str);

  const diasNav = [
    { label: '#NossoDia', sublabel: hojeStr, eventos: eventosCruzadosHoje, total: eventosHoje.length, key: 'hoje', data: hojeStr, comOpac: true },
    { label: '#NossoDiaAmanhã', sublabel: d1Str, eventos: eventosCruzadosAmanha, total: eventosAmanha.length, key: 'amanha', data: d1Str, comOpac: false },
    { label: fmtData(d2), sublabel: DIAS_PT[d2.getDay()], eventos: cruzarEventos(eventosD2, escalaComNoturnosAnteriores(escala, fmtData(d2)), fmtData(d2)), total: eventosD2.length, key: 'd2', data: fmtData(d2), comOpac: false },
    { label: fmtData(d3), sublabel: DIAS_PT[d3.getDay()], eventos: cruzarEventos(eventosD3, escalaComNoturnosAnteriores(escala, fmtData(d3)), fmtData(d3)), total: eventosD3.length, key: 'd3', data: fmtData(d3), comOpac: false },
    { label: fmtData(d4), sublabel: DIAS_PT[d4.getDay()], eventos: cruzarEventos(eventosD4, escalaComNoturnosAnteriores(escala, fmtData(d4)), fmtData(d4)), total: eventosD4.length, key: 'd4', data: fmtData(d4), comOpac: false },
    { label: fmtData(d5), sublabel: DIAS_PT[d5.getDay()], eventos: cruzarEventos(eventosD5, escalaComNoturnosAnteriores(escala, fmtData(d5)), fmtData(d5)), total: eventosD5.length, key: 'd5', data: fmtData(d5), comOpac: false },
    { label: fmtData(d6), sublabel: DIAS_PT[d6.getDay()], eventos: cruzarEventos(eventosD6, escalaComNoturnosAnteriores(escala, fmtData(d6)), fmtData(d6)), total: eventosD6.length, key: 'd6', data: fmtData(d6), comOpac: false },
  ];

  const semCob = eventosCruzadosAmanha.filter(e => e.semCob).length;
  const comAtenc = eventosCruzadosAmanha.filter(e => e.atenc.length > 0).length;
  const trabAmanha = escD1.filter(r => r[3] && r[4] && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente').length;
  const folgAmanha = escD1.filter(r => !r[3] || r[5] === 'Folga' || r[5] === 'Folga/Ausente').length;
  const folgHoje = escHoje.filter(r => !r[3] || r[5] === 'Folga' || r[5] === 'Folga/Ausente').length;
  // Férias que iniciam nos próximos 7 dias (alerta antecipado)
  const d7 = new Date(hoje); d7.setDate(hoje.getDate() + 7);
  const feriasProximas = ausencias.filter(a => {
    if (a[0] === 'CANCELADO' || a[2] !== 'Férias' || !a[4]) return false;
    const [dd, mm] = a[4].split('/').map(Number);
    const anoRef = hoje.getFullYear();
    // tenta com ano atual, se ficar no passado tenta com ano seguinte
    let inicioFerias = new Date(anoRef, mm - 1, dd);
    if (inicioFerias < hoje) inicioFerias = new Date(anoRef + 1, mm - 1, dd);
    return inicioFerias >= hoje && inicioFerias <= d7;
  });
  const feriasAtivas = feriasProximas.length;
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
      const fimMin = toMin(ev.horaFim);
      const fimMinAjustado = (fimMin !== null && fimMin < evMin) ? fimMin + 1440 : fimMin;
      const encerrado = comOpacidade && evMin !== null && (fimMinAjustado !== null ? horaAtualMin > fimMinAjustado + 30 : evMin < horaAtualMin - 30);
      const idAtivo = (!encerrado && primeiroAtivo && comOpacidade) ? 'id="primeiro-ativo-hoje"' : '';
      if (!encerrado && primeiroAtivo && comOpacidade) primeiroAtivo = false;
      const fraseEnc = encerrado ? gerarFraseEncerrado(ev.nome) : '';
      const [bc, bb, itc] = ev.semCob ? ['var(--badge-red-bg)', 'var(--badge-red-c)', 'var(--badge-red-c)'] : ['var(--badge-green-bg)', 'var(--badge-green-c)', 'var(--badge-green-c)'];
      return `<div ${idAtivo} data-hora="${ev.hora||''}" data-horafim="${ev.horaFim||''}" data-isoje="${comOpacidade?1:0}" style="border:1px solid ${encerrado ? 'var(--border)' : bb};border-radius:8px;margin-bottom:10px;overflow:hidden${encerrado ? ';opacity:.35' : ''}">
        <div style="background:${encerrado ? 'var(--card)' : bc};padding:8px 12px;display:flex;align-items:center;gap:10px">
          <div style="font-size:13px;font-weight:700;color:${encerrado ? 'var(--text3)' : 'var(--today-c)'};min-width:50px">${ev.hora || '--'}${ev.horaFim?'<br><span style="font-size:9px;font-weight:600;opacity:.6">–'+ev.horaFim+'</span>':''}</div>
          <div style="flex:1"><div style="font-size:12px;font-weight:700;color:${encerrado ? 'var(--text3)' : 'var(--text)'}">${ev.nome}</div><div style="font-size:10px;color:#aaa">${ev.tipo}${ev.local ? ' · <span style="font-weight:600;color:var(--text3)">' + ev.local + '</span>' : ''}</div></div>
          ${encerrado
          ? `<div style="font-size:10px;font-weight:600;color:#9ca3af;font-style:italic">${fraseEnc}</div>`
          : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
              <span class="badge-realtime"></span>
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
      const ausente = ausSem.find(a => a[1] === n && dentroAusencia(a, df));
      const bg = isD1 ? '#eff6ff' : isHoje ? '#fafafa' : '';
      tabelaHTML += `<td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;text-align:center;background:${bg};cursor:pointer" onclick="abrirAjuste('${df}','${n}','${reg ? reg[3] : ''}','${reg ? reg[4] : ''}','${reg ? reg[5] : ''}')">`;
      if (ausente) {
        const tipoAus = ausente[2] || '';
        const motivoAus = ausente[3] || '';
        const corAus = tipoAus === 'Férias' ? '#1d4ed8' : tipoAus === 'Atestado médico' ? '#991b1b' : tipoAus === 'Folga direcionada' ? '#92400e' : '#166534';
        const bgAus = tipoAus === 'Férias' ? '#dbeafe' : tipoAus === 'Atestado médico' ? '#fee2e2' : tipoAus === 'Folga direcionada' ? '#fef3c7' : '#dcfce7';
        const iconeAus = tipoAus === 'Férias' ? '🏖️' : tipoAus === 'Atestado médico' ? '🏥' : tipoAus === 'Folga direcionada' ? '📌' : '📅';
        tabelaHTML += `<span title="${tipoAus}${motivoAus ? ' — ' + motivoAus : ''}" style="background:${bgAus};color:${corAus};border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">${iconeAus}</span>`;
      }
      else if (reg) {
        if (reg[5] === 'Folga') tabelaHTML += `<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Folga</span>`;
        else if (!reg[3] && !reg[4]) tabelaHTML += `<span style="color:#d1d5db;font-size:11px">--</span>`;
        else tabelaHTML += `<span style="font-size:11px;color:${isD1 ? '#1d4ed8' : '#333'};font-weight:${isD1 ? 700 : 500}">${reg[3]}--${reg[4]}</span>`;
      } else tabelaHTML += `<span style="color:#e5e7eb;font-size:11px">+</span>`;
      tabelaHTML += `</td>`;
    });
    tabelaHTML += `</tr>`;
  });

  const pulseSpeedGestor = eventosHoje.length >= 15 ? '0.6s' : eventosHoje.length >= 10 ? '1s' : eventosHoje.length >= 5 ? '1.5s' : '2.5s';

  // Contador de requisições pendentes (solicitações de ausência + novos membros aguardando aprovação)
  const pendAusenciasGestor = ausencias.filter(a => a[0] && a[0].startsWith('PLS-')).length;
  const pendEquipeGestor = equipeRaw.filter(r => (r[10] || 'ativo').toLowerCase() === 'pendente').length;
  const totalPendentesGestor = pendAusenciasGestor + pendEquipeGestor;
  const badgeEquipeGestor = totalPendentesGestor > 0
    ? ` <span style="background:#dc2626;color:#fff;border-radius:50%;min-width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;padding:0 3px;vertical-align:middle">${totalPendentesGestor}</span>`
    : '';

  // Horizonte de publicação
  const horizonteAtual = configMap['publicacao_horizonte']||'';

  const conteudo = `
<div class="header">
  <div class="logo" style="background:none;padding:0;overflow:visible">
    <svg style="animation:pulse-heart ${pulseSpeedGestor} ease-in-out infinite" width="32" height="32" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="72" height="72" rx="18" fill="#e53e3e"/>
      <rect x="0" y="36" width="72" height="36" rx="18" fill="#7f1d1d" opacity="0.3"/>
      <path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/>
      <polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <div><div class="ht">Pulse <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px">Gestor</span></div><div class="hs">${DIAS_FULL[d1.getDay()]} ${d1Str} · ${atualizado}</div></div>
  <div class="hr">
    <div id="gtempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="gtempo-icone">⏳</span>
      <span id="gtempo-temp" style="font-weight:700">--°C</span>
      <span id="gtempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;font-weight:600;color:#718096;letter-spacing:.04em">Brasil</span>
        <span id="grelogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;font-weight:600;color:#4a5568;letter-spacing:.04em">GMT</span>
        <span id="grelogio-gmt" style="font-size:11px;font-weight:600;color:#718096;font-variant-numeric:tabular-nums"></span>
      </div>
    </div>
    <span style="font-size:12px;color:#666">Ola, ${nome.split(' ')[0]}</span>
    <a href="/api/escalas?v=semana" class="btn-sm">Escala</a>
    <a href="/api/equipe-view" class="btn-sm" style="display:inline-flex;align-items:center;gap:4px">Equipe${badgeEquipeGestor}</a>
    <a href="/api/repositorio" class="btn-sm">Repositorio</a>
    <button class="btn-sm" onclick="location.reload()">&#8635;</button>
    <button id="tt" class="btn-sm btn-sm-keep" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'&#9728;&#65039;':'&#127769;';})()" style="font-size:14px;padding:3px 8px;display:flex">&#127769;</button>
    <form method="POST" action="/api/app?action=logout" style="display:inline"><button type="submit" class="btn-sm btn-sm-keep" style="display:inline-block">Sair</button></form>
  </div>
</div>
<div class="wrap">
  
  <div class="frase-banner">
    <div class="frase-ic">
      <svg class="pulse-heart-anim" width="32" height="32" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="72" height="72" rx="18" fill="#e53e3e"/><rect x="0" y="36" width="72" height="36" rx="18" fill="#7f1d1d" opacity="0.3"/><path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/><polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div>
      <div class="frase-label">Frase do dia</div>
      <div class="frase-txt">"${fraseDoDia}"</div>
    </div>
  </div>

  <div class="metrics">
    <div class="metric blue-m"><div class="ml">Trabalhando amanhã</div><div class="mv blue-v">${trabAmanha}</div><div class="ms">${cobPct}% cobertura · ${equipeRaw.length} na equipe</div></div>
    <div class="metric ${folgHoje > 2 ? 'amber-m' : ''}"><div class="ml">Folgas hoje</div><div class="mv ${folgHoje > 2 ? 'amber-v' : ''}">${folgHoje}</div><div class="ms">${ausencias.filter(a => a[0] !== 'CANCELADO' && dentroAusencia(a, hojeStr)).length} via Pulse</div></div>
    <div class="metric ${folgAmanha > 2 ? 'amber-m' : ''}"><div class="ml">Folgas amanhã</div><div class="mv ${folgAmanha > 2 ? 'amber-v' : ''}">${folgAmanha}</div><div class="ms">${ausencias.filter(a => a[4] === d1Str).length} via Pulse</div></div>
    <div class="metric ${semCob > 0 ? 'red-m' : ''}" title="Eventos cujo intervalo início→fim não é coberto por nenhum turno escalado."><div class="ml">Sem cobertura</div><div class="mv ${semCob > 0 ? 'red-v' : ''}">${semCob}</div><div class="ms">de ${eventosAmanha.length} eventos amanhã</div></div>
    ${feriasAtivas > 0 ? `<div class="metric amber-m"><div class="ml">Férias em até 7 dias</div><div class="mv amber-v">${feriasAtivas}</div><div class="ms">${feriasProximas.map(a => `${a[1].split(' ')[0]} (${a[4]})`).join(', ')}</div></div>` : ''}
  </div>

  <!-- Abas de navegação (só mobile) -->
  <div class="eventos-tab" id="eventos-tab-mobile" style="display:none">
    <button class="eventos-tab-btn ativo" onclick="tabGestor(0)" id="gtab-0">🟢 Hoje <span style="opacity:.7">${eventosHoje.length}</span></button>
    <button class="eventos-tab-btn" onclick="tabGestor(1)" id="gtab-1">📅 Amanhã <span style="opacity:.7">${eventosAmanha.length}</span></button>
    ${diasNav.slice(2).map((d, i) => `<button class="eventos-tab-btn" onclick="tabGestor(${i+2})" id="gtab-${i+2}">${d.sublabel} · ${d.label} <span style="opacity:.7">${d.total}</span></button>`).join('')}
  </div>

  <div class="eventos-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    <div class="card" id="gpainel-0">
      <div class="card-header">
        <span class="card-title" style="color:#22c55e">#NossoDia</span>
        <span class="badge blue">${eventosHoje.length} eventos</span>
        <span style="font-size:10px;color:var(--text3);margin-left:auto">${hojeStr}</span>
      </div>
      <div id="cb-hoje" class="card-body" style="max-height:520px;overflow-y:auto">${renderEventos(eventosCruzadosHoje, true)}</div>
    </div>
    <div class="card" id="gpainel-1">
      <div class="card-header">
        <span class="card-title" style="color:#3b82f6">#NossoDiaAmanhã</span>
        <span class="badge ${semCob > 0 ? 'red' : comAtenc > 0 ? 'amber' : 'green'}">${eventosAmanha.length} eventos</span>
        <span style="font-size:10px;color:var(--text3);margin-left:auto">${d1Str}</span>
      </div>
      <div class="card-body" style="max-height:520px;overflow-y:auto">${renderEventos(eventosCruzadosAmanha, false)}</div>
    </div>
    <div class="card" id="gpainel-2-wrap">
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
      <div class="field"><label>Entrada</label><input type="text" id="aj-entrada" placeholder="HH:MM" maxlength="5" style="font-family:monospace;font-size:16px"></div>
      <div class="field"><label>Saida</label><input type="text" id="aj-saida" placeholder="HH:MM" maxlength="5" style="font-family:monospace;font-size:16px"></div>
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
// Relógio Brasil/GMT
function grelogio() {
  var now = new Date();
  var p = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now);
  var bh=p.find(function(x){return x.type==='hour';}).value;
  var bm=p.find(function(x){return x.type==='minute';}).value;
  var bs=p.find(function(x){return x.type==='second';}).value;
  var eb=document.getElementById('grelogio-brt');
  if(eb) eb.textContent=bh+':'+bm+':'+bs;
  var eg=document.getElementById('grelogio-gmt');
  if(eg) eg.textContent=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0');
}
async function gtempo() {
  try {
    var loc=null;
    try{var r1=await fetch('https://ipapi.co/json/');var j1=await r1.json();if(j1.latitude)loc={lat:j1.latitude,lon:j1.longitude,city:j1.city};}catch(e){}
    if(!loc)loc={lat:-22.9068,lon:-43.1729,city:'Rio de Janeiro'};
    var wd=await(await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')).json();
    var temp=wd.current&&wd.current.temperature_2m!==undefined?Math.round(wd.current.temperature_2m):'--';
    var icons={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',51:'🌦️',61:'🌧️',80:'🌦️',95:'⛈️'};
    document.getElementById('gtempo-icone').textContent=icons[wd.current&&wd.current.weathercode||0]||'🌡️';
    document.getElementById('gtempo-temp').textContent=temp+'°C';
    document.getElementById('gtempo-cidade').textContent=loc.city||'';
  }catch(e){document.getElementById('gtempo-temp').textContent='--°C';}
}
grelogio();gtempo();setInterval(grelogio,1000);

function abrirAjuste(data,nome,ent,sai,obs){document.getElementById('aj-data').value=data;document.getElementById('aj-nome').value=nome;document.getElementById('aj-colab').value=nome;document.getElementById('aj-data-show').value=data;document.getElementById('aj-entrada').value=ent||'';document.getElementById('aj-saida').value=sai||'';document.getElementById('aj-obs').value=obs||'';document.getElementById('aj-acao').value='horario';toggleAcao();document.getElementById('modal').classList.add('open');setTimeout(function(){document.getElementById('aj-entrada').focus();},100);}
// Tab/Enter entre campos do modal
document.getElementById('aj-entrada').addEventListener('keydown',function(e){if(e.key==='Tab'||e.key==='Enter'){e.preventDefault();document.getElementById('aj-saida').focus();}});
document.getElementById('aj-saida').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();salvarAjuste();}});
function fecharModal(){document.getElementById('modal').classList.remove('open');}
function toggleAcao(){document.getElementById('aj-horarios').style.display=document.getElementById('aj-acao').value==='horario'?'block':'none';}
async function salvarAjuste(){const body={acao:document.getElementById('aj-acao').value,data:document.getElementById('aj-data').value,colaborador:document.getElementById('aj-nome').value,entrada:document.getElementById('aj-entrada').value,saida:document.getElementById('aj-saida').value,obs:document.getElementById('aj-obs').value};const r=await fetch('/api/app?action=ajuste',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(d.ok){fecharModal();toast('Escala atualizada!');setTimeout(()=>location.reload(),1200);}else toast('Erro: '+d.error,'#dc2626');}
function toast(msg,bg='#1a1a1a'){const t=document.getElementById('toast');t.textContent=msg;t.style.background=bg;t.style.display='block';setTimeout(()=>t.style.display='none',2500);}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)fecharModal();});
window.addEventListener('load',function(){var b=document.getElementById('cb-hoje');var a=document.getElementById('primeiro-ativo-hoje');if(b&&a){var pos=0,el=a.previousElementSibling;while(el){pos+=el.offsetHeight+10;el=el.previousElementSibling;}b.scrollTop=Math.max(0,pos-280);}});
var diaAtual3=0;
function navDia(dir){var total=5;diaAtual3=(diaAtual3+dir+total)%total;for(var i=0;i<total;i++){var p=document.getElementById('painel3-'+i);var l=document.getElementById('tab3-label-'+i);if(p)p.style.display=i===diaAtual3?'block':'none';if(l)l.style.display=i===diaAtual3?'block':'none';}}

// Badges em tempo real para o gestor (AO VIVO / <30min / <60min)
function toMinG(h){if(!h)return null;var p=h.split(':').map(Number);return p[0]*60+(p[1]||0);}
function atualizarBadgesGestor(){
  var now=new Date();
  var brt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  var bh=parseInt(brt.find(function(p){return p.type==='hour';}).value);
  var bm=parseInt(brt.find(function(p){return p.type==='minute';}).value);
  var min=bh*60+bm;
  document.querySelectorAll('[data-hora]').forEach(function(el){
    var badge=el.querySelector('.badge-realtime'); if(!badge) return;
    if(el.dataset.isoje!=='1'){badge.innerHTML='';return;}
    var m=toMinG(el.dataset.hora); if(m===null) return;
    var f=toMinG(el.dataset.horafim||'');
    if(f!==null&&f<m) f+=1440; // evento atravessa meia-noite
    var s='';
    if(f!==null){
      if(min>=m&&min<=f) s='aovivo';
      else if(min>f) s=min>f+30?'enc':'aovivo';
      else if(m-min<=30) s='p30';
      else if(m-min<=60) s='p60';
    } else {
      if(m<min-30) s='enc';
      else if(m<=min+5&&m>=min-30) s='aovivo';
      else if(m-min<=30) s='p30';
      else if(m-min<=60) s='p60';
    }
    if(s==='aovivo'){
      badge.innerHTML='<span style="background:#166534;color:#86efac;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">● AO VIVO</span>';
      el.style.borderColor='#22c55e';
    } else if(s==='p30'){
      badge.innerHTML='<span style="background:#451a03;color:#fcd34d;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">⚡ &lt;30min</span>';
    } else if(s==='p60'){
      badge.innerHTML='<span style="background:#431407;color:#fb923c;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">🔜 &lt;60min</span>';
    } else {
      badge.innerHTML='';
    }
  });
}
atualizarBadgesGestor();
setInterval(atualizarBadgesGestor, 30000);

async function publicarHorizonte(opcao) {
  var hoje = new Date();
  var d = new Date(hoje);
  var horizonte = '';
  if(opcao==='limpar') {
  } else {
    if(opcao==='1 dia') d.setDate(d.getDate()+1);
    else if(opcao==='2 dias') d.setDate(d.getDate()+2);
    else if(opcao==='1 semana') d.setDate(d.getDate()+7);
    else if(opcao==='15 dias') d.setDate(d.getDate()+15);
    else if(opcao==='1 mês') d.setMonth(d.getMonth()+1);
    var dd=String(d.getDate()).padStart(2,'0');
    var mm=String(d.getMonth()+1).padStart(2,'0');
    horizonte=dd+'/'+mm;
  mostrarToast('Salvando...','#374151');
  }
  try {
    var r=await fetch('/api/publicar',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({horizonte})});
    var data=await r.json();
    if(data.ok){
      mostrarToast(opcao==='limpar'?'🔒 Publicação removida':'✓ Escala publicada até '+horizonte,'#166534');
      setTimeout(function(){location.reload();},1200);
    } else {
      mostrarToast('Erro: '+(data.error||'?'),'#dc2626');
    }
  } catch(e) { mostrarToast('Erro de conexão: '+e.message,'#dc2626'); }
}
function mostrarToast(msg,bg){
  var t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;color:#fff;display:none';document.body.appendChild(t);}
  t.textContent=msg;t.style.background=bg;t.style.display='block';
  clearTimeout(t._t);t._t=setTimeout(function(){t.style.display='none';},3500);
}

// Mobile: abas de eventos
var _gTabAtual = 0;
var _gTotalTabs = 7; // hoje + amanha + 5 dias
function tabGestor(idx) {
  _gTabAtual = idx;
  for (var i = 0; i < _gTotalTabs; i++) {
    var p = document.getElementById('gpainel-'+i) || document.getElementById('gpainel-2-wrap');
    var b = document.getElementById('gtab-'+i);
    if (i === 0 || i === 1) {
      var panel = document.getElementById('gpainel-'+i);
      if (panel) panel.style.display = i === idx ? 'block' : 'none';
    }
    if (b) b.className = 'eventos-tab-btn' + (i === idx ? ' ativo' : '');
  }
  // Painel 3 (dias extras)
  var wrap = document.getElementById('gpainel-2-wrap');
  if (wrap) wrap.style.display = idx >= 2 ? 'block' : 'none';
  if (idx >= 2) navDia(idx - 2 - diaAtual3);
}
function initMobileGestor() {
  if (window.innerWidth <= 640) {
    var tab = document.getElementById('eventos-tab-mobile');
    if (tab) tab.style.display = 'flex';
    var grid = document.querySelector('.eventos-grid');
    if (grid) grid.style.gridTemplateColumns = '1fr';
    // Esconder painel 1 e 2 inicialmente
    var p1 = document.getElementById('gpainel-1');
    var p2 = document.getElementById('gpainel-2-wrap');
    if (p1) p1.style.display = 'none';
    if (p2) p2.style.display = 'none';
  }
}
window.addEventListener('load', initMobileGestor);
window.addEventListener('resize', initMobileGestor);
</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(baseHTML('Gestor', conteudo + SOLICITAR_BTN + CHAT_IA, script));
}
