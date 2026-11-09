// lib/routes/avisar-central.js — "Avisar a central": o gestor digita um recado no Pulse e a Echo da central fala em voz alta.
// Rotas (via extras-bundle, rewrite /api/avisar-central):
//   GET  /api/avisar-central  → a página (só gestor)
//   POST /api/avisar-central  → { texto } → manda o recado pra Echo
//
// A Amazon não deixa um sistema de fora mandar a Echo falar; quem faz isso é o Voice Monkey (voicemonkey.io), uma skill
// ativada na conta Amazon da Echo da central. O Pulse só chama a API dele:
//   POST https://api-v3.voicemonkey.io/announce  { token, device, speech, [language], [voice] }
// Segredos do Cloudflare: VOICEMONKEY_TOKEN, VOICEMONKEY_DEVICE (id do "Speaker" criado no painel do Voice Monkey).
// Opcionais: VOICEMONKEY_LANGUAGE (ex.: pt-BR) e VOICEMONKEY_VOICE, se a voz padrão não sair em português.
// Plano grátis do Voice Monkey: 200 recados por mês.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
import { menuItens } from '../menu.js';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
const MAX_TEXTO = 300;

// ── Sessão (mesmo formato do mapa.js / banco-horas.js) ──
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => { const p = c.trim().split('='); const k = p.shift(); cookies[k] = p.join('='); });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe), h = d.slice(secondPipe + 1, lastPipe), ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (!assinaturaBate(h, hash(data + ts))) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    return nome ? { nome } : null;
  } catch { return null; }
}

// Equipe: 8=perfil, 10=status de aprovação
async function ehGestorAtivo(nome) {
  const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:L200')}`);
  const r = (d.values || []).find(x => x[0] === nome);
  return !!r && r[8] === 'gestor' && (r[10] || 'ativo').toLowerCase() === 'ativo';
}

// texto pra voz: tira emoji/símbolos que a Alexa leria em voz alta, junta espaços, corta no limite
export function limparRecado(t) {
  return String(t || '').replace(/[^\p{L}\p{N}\s.,:;!?()+\-/#%]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
}
export const falaDoRecado = (nome, texto) => 'Recado do Pulse, de ' + String(nome || '').trim().split(' ')[0] + '. ' + texto;

async function enviarParaEcho(fala) {
  const corpo = { token: process.env.VOICEMONKEY_TOKEN, device: process.env.VOICEMONKEY_DEVICE, speech: fala };
  if (process.env.VOICEMONKEY_LANGUAGE) corpo.language = process.env.VOICEMONKEY_LANGUAGE;
  if (process.env.VOICEMONKEY_VOICE) corpo.voice = process.env.VOICEMONKEY_VOICE;
  const r = await fetch('https://api-v3.voicemonkey.io/announce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error('Voice Monkey ' + r.status + ': ' + txt.slice(0, 160));
  return txt;
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.method === 'POST') return res.status(401).json({ error: 'Não autenticado' });
    return res.redirect(302, '/api/app');
  }
  let gestor = false;
  try { gestor = await ehGestorAtivo(session.nome); } catch { return res.status(503).json({ error: 'Não consegui ler a planilha agora' }); }
  if (!gestor) {
    if (req.method === 'POST') return res.status(403).json({ error: 'Só gestor pode avisar a central' });
    return res.redirect(302, '/api/app');
  }
  const configurado = !!(process.env.VOICEMONKEY_TOKEN && process.env.VOICEMONKEY_DEVICE);

  if (req.method === 'POST') {
    if (!configurado) return res.status(503).json({ error: 'A Echo da central ainda não foi conectada (Voice Monkey não configurado).' });
    const texto = limparRecado(req.body && req.body.texto);
    if (!texto) return res.status(400).json({ error: 'Escreva o recado.' });
    try {
      await enviarParaEcho(falaDoRecado(session.nome, texto));
      console.log('avisar-central: recado enviado por', session.nome);
      return res.status(200).json({ ok: true, falado: falaDoRecado(session.nome, texto) });
    } catch (e) {
      console.error('avisar-central:', e && e.message);
      return res.status(502).json({ error: 'A Echo não recebeu o recado. Tente de novo em instantes.' });
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(pagina(configurado));
}

const PRONTOS = [
  'Alguém da central, por favor me ligue.',
  'Atenção: confiram o que está no ar.',
  'Atenção: chamado urgente aberto no Pulse.',
  'Confiram o Slack, por favor.',
];

function pagina(configurado) {
  const botoes = PRONTOS.map(t => `<button type="button" class="pronto">${t}</button>`).join('');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avisar a central — Pulse</title><meta name="theme-color" content="#0b1020">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.json">
<script>try{if(localStorage.getItem('pulse-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}</script>
<style>
:root{--bg:#f4f6fb;--card:#fff;--text:#111827;--muted:#6b7280;--border:#e5e7eb;--accent:#2563eb;--ok:#16a34a;--erro:#dc2626}
html.dark{--bg:#0b1020;--card:#141a2e;--text:#e5e7eb;--muted:#94a3b8;--border:#26304a;--accent:#60a5fa;--ok:#4ade80;--erro:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);background:var(--card)}
header h1{font-size:17px;margin:0;flex:1}
.menu{position:relative}.menu .lista{display:none;position:absolute;right:0;top:40px;background:var(--card);border:1px solid var(--border);border-radius:10px;min-width:230px;padding:6px;z-index:5;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.menu.aberto .lista{display:flex;flex-direction:column}.menu .lista a,.menu .lista button{padding:9px 10px;border-radius:6px;color:var(--text);text-decoration:none;font-size:14px}
.menu .lista a:hover{background:var(--bg)}
.btn{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:8px;padding:7px 11px;font-size:16px;cursor:pointer}
main{max-width:560px;margin:0 auto;padding:20px 16px;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}
p{margin:0;color:var(--muted);font-size:14px;line-height:1.5}
textarea{width:100%;min-height:110px;resize:vertical;border:1px solid var(--border);border-radius:10px;padding:12px;font:inherit;font-size:16px;background:var(--bg);color:var(--text)}
.prontos{display:flex;flex-wrap:wrap;gap:8px}.pronto{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer}
.linha{display:flex;align-items:center;gap:10px}.conta{color:var(--muted);font-size:12px;flex:1;font-variant-numeric:tabular-nums}
#enviar{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:11px 18px;font-size:15px;font-weight:600;cursor:pointer}
#enviar:disabled{opacity:.5;cursor:default}
#status{font-size:14px;min-height:20px}.ok{color:var(--ok)}.erro{color:var(--erro)}
.aviso{border-left:3px solid var(--erro)}
</style></head><body>
<header><h1>&#128227; Avisar a central</h1>
  <div class="menu" id="menu"><button class="btn" id="menu-btn" aria-label="Menu">&#9776;</button><div class="lista">${menuItens(true, { classe: '' })}</div></div></header>
<main>
  ${configurado ? '' : '<div class="card aviso"><p><strong>A Echo da central ainda não está conectada.</strong> Falta ativar o Voice Monkey na conta da Echo e cadastrar o token no Pulse.</p></div>'}
  <div class="card">
    <p>O recado é falado em voz alta pela Echo da central, começando com "Recado do Pulse, de" e o seu primeiro nome.</p>
    <textarea id="texto" maxlength="${MAX_TEXTO}" placeholder="Ex.: Rafael, me liga quando puder."></textarea>
    <div class="prontos">${botoes}</div>
    <div class="linha"><span class="conta" id="conta">0/${MAX_TEXTO}</span><button id="enviar"${configurado ? '' : ' disabled'}>Falar na central</button></div>
    <div id="status" role="status"></div>
  </div>
</main>
<script>
(function(){
  var menu=document.getElementById('menu');document.getElementById('menu-btn').addEventListener('click',function(e){e.stopPropagation();menu.classList.toggle('aberto')});
  document.addEventListener('click',function(){menu.classList.remove('aberto')});
  var tx=document.getElementById('texto'),conta=document.getElementById('conta'),bt=document.getElementById('enviar'),st=document.getElementById('status');
  function atualiza(){conta.textContent=tx.value.length+'/${MAX_TEXTO}'}
  tx.addEventListener('input',atualiza);
  Array.prototype.forEach.call(document.querySelectorAll('.pronto'),function(b){b.addEventListener('click',function(){tx.value=b.textContent;atualiza();tx.focus()})});
  bt.addEventListener('click',function(){
    var t=tx.value.trim(); if(!t){st.className='erro';st.textContent='Escreva o recado.';return}
    bt.disabled=true;st.className='';st.textContent='Enviando...';
    fetch('/api/avisar-central',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:t})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){ if(x.ok){st.className='ok';st.textContent='Enviado. A Echo vai falar: "'+x.j.falado+'"';tx.value='';atualiza()} else {st.className='erro';st.textContent=x.j.error||'Falhou.'} })
      .catch(function(){st.className='erro';st.textContent='Sem conexão com o Pulse.'})
      .then(function(){bt.disabled=false});
  });
})();
</script></body></html>`;
}
