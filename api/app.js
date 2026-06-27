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
function hash(s) { return createHash('sha256').update(s + process.env.PULSE_SECRET || 'pulse2026').digest('hex').slice(0,32); }
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
    })).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  } catch { return []; }
}

function gerarFraseEncerrado(nomeEvento) {
  const frases = [
    'Esse aqui ja foi, e foi bonito!',
    'Menos um, galera. Segue o baile!',
    'Missao cumprida. Proximo!',
    'Entregue! Pode riscar da lista.',
    'Foi de primeira, sem drama!',
    'Producao entregue com louvor!',
    'Ja era. E foi sucesso!',
    'Passou voando, como devia!',
    'Check! Ta no saco.',
    'Era uma vez... e ja acabou.',
    'Fechou bonito, equipe!',
    'Evento no retrovisor!',
    'Tcharaaaan! Encerrado.',
    'Foi, voltou, deu certo!',
    'Mais um na conta da galera!',
    'Operacao realizada, pode fechar!',
    'Esse a gente dominou!',
    'Sem susto, sem drama. OK!',
    'Cumpriu o horario certinho!',
    'Equipe nota 10 nesse aqui!',
  ];
  const idx = nomeEvento.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % frases.length;
  return frases[idx];
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [k,...v] = c.trim().split('=');
    cookies[k.trim()] = v.join('=');
  });
  return cookies;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [nome, h, ts] = decoded.split('|');
    if (Date.now() - parseInt(ts) > COOKIE_MAX * 1000) return null;
    if (h !== hash(nome + ts)) return null;
    return { nome };
  } catch { return null; }
}

function setSessionCookie(res, nome) {
  const ts = Date.now().toString();
  const h = hash(nome + ts);
  const token = Buffer.from(`${nome}|${h}|${ts}`).toString('base64');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0`);
}

function baseHTML(titulo, conteudo, script='') {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — ${titulo}</title>
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
--bg:#0f0f0f;--bg2:#1a1a1a;--bg3:#222;--border:#2a2a2a;--border2:#222;
--text:#f0f0f0;--text2:#bbb;--text3:#777;--text4:#555;
--header:#111;--logo-bg:#333;--logo-c:#f0f0f0;
--card:#1a1a1a;--input:#222;--modal:#1e1e1e;
--th:#1e1e1e;--th-c:#666;--th-border:#2a2a2a;--td-border:#1e1e1e;
--btn-border:#555;--btn-c:#999;
--blue-m-bg:#0d1f3c;--blue-m-border:#1e3a5f;--blue-m-v:#60a5fa;
--red-m-bg:#1f0d0d;--red-m-border:#5f1e1e;--red-m-v:#f87171;
--amber-m-bg:#1f1700;--amber-m-border:#5f4500;--amber-m-v:#fbbf24;
--badge-blue-bg:#1e3a5f;--badge-blue-c:#60a5fa;
--badge-green-bg:#0d2010;--badge-green-c:#4ade80;
--badge-red-bg:#2d1010;--badge-red-c:#f87171;
--badge-amber-bg:#2d1f00;--badge-amber-c:#fbbf24;
--badge-gray-bg:#222;--badge-gray-c:#888;
--today-bg:#0d1f3c;--today-border:#1e3a5f;--today-c:#60a5fa;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.header{background:#1a1a1a;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:28px;height:28px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;font-size:12px;font-weight:700;flex-shrink:0}
.ht{font-size:14px;font-weight:600;color:#fff}
.hs{font-size:11px;color:#666}
.hr{margin-left:auto;display:flex;align-items:center;gap:8px}
.btn-sm{background:none;border:1px solid #444;border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer;color:#ccc;text-decoration:none;display:inline-block}
.btn-sm:hover{background:#333}
.wrap{max-width:1100px;margin:0 auto;padding:16px 20px}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;margin-bottom:14px}
.card-header{padding:10px 14px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px}
.card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#555}
.badge{border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600}
.blue{background:#dbeafe;color:#1d4ed8}.red{background:#fee2e2;color:#991b1b}.amber{background:#fef3c7;color:#92400e}.green{background:#dcfce7;color:#166534}.gray{background:#f3f4f6;color:#6b7280}
.card-body{padding:12px 14px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.metric{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px}
.metric.blue-m{border-color:#dbeafe;background:#eff6ff}
.metric.red-m{border-color:#fca5a5;background:#fef2f2}
.metric.amber-m{border-color:#fcd34d;background:#fffbeb}
.ml{font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.mv{font-size:24px;font-weight:700;line-height:1}
.ms{font-size:10px;color:#aaa;margin-top:3px}
.blue-m .mv{color:#1d4ed8}.red-m .mv{color:#dc2626}.amber-m .mv{color:#d97706}
.layout2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.full{grid-column:1/-1}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:620px}
th{padding:6px 8px;text-align:center;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;border-bottom:1px solid #f0f0f0;background:#fafafa;white-space:nowrap}
th.tnome{text-align:left;width:145px}
th.thoje{background:#f5f5f5;color:#555}
th.td1{background:#eff6ff;color:#1d4ed8;border-bottom:2px solid #3b82f6}
td{padding:5px 8px;border-bottom:1px solid #f5f5f5;vertical-align:middle;text-align:center}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafafa!important}
.td-hoje{background:#fafafa}.td-d1{background:#eff6ff}
.av{width:24px;height:24px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.legenda{display:flex;gap:12px;padding:8px 14px;border-top:1px solid #f0f0f0;flex-wrap:wrap}
.leg{font-size:10px;color:#888;display:flex;align-items:center;gap:4px}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:#fff;border-radius:12px;padding:22px;width:340px;max-width:92vw}
.modal h3{font-size:15px;font-weight:600;margin-bottom:16px}
.field{margin-bottom:12px}
.field label{display:block;font-size:11px;color:#555;font-weight:600;margin-bottom:4px}
.field input,.field select{width:100%;border:1px solid #e5e5e5;border-radius:7px;padding:8px 10px;font-size:13px;outline:none}
.field input:focus,.field select:focus{border-color:#3b82f6;box-shadow:0 0 0 2px #dbeafe}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.btn-primary{background:#1d4ed8;color:#fff;border:none;border-radius:7px;padding:7px 18px;font-size:12px;cursor:pointer;font-weight:600}
.btn-primary:hover{background:#1e40af}
.btn-cancel{background:none;border:1px solid #e5e5e5;border-radius:7px;padding:7px 14px;font-size:12px;cursor:pointer;color:#555}
.btn-cancel:hover{background:#f5f5f5}
.toast{position:fixed;bottom:20px;right:20px;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;z-index:300;display:none;max-width:280px}
.semana-titulo{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.grid7{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:18px}
.dia-card{border-radius:8px;padding:8px 5px;text-align:center;min-height:72px;border:1px solid #e5e5e5;background:#fff}
.dia-card.hoje{background:#1a1a1a;border-color:#1a1a1a}
.dia-card.d1{background:#eff6ff;border-color:#93c5fd}
.ev-encerrado{opacity:.35;transition:opacity .3s}
@keyframes pulsar{0%,100%{opacity:1}50%{opacity:.2}}
@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.layout2{grid-template-columns:1fr}.wrap{padding:10px 12px}.grid7{grid-template-columns:repeat(7,1fr);gap:3px}}
</style>
${conteudo}
${script}
</html>`;
}

function paginaLogin(equipe, erro='') {
  const opcoes = equipe.map(r=>`<option value="${r[0]}">${r[0]}</option>`).join('');
  return baseHTML('Entrar', `
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
  <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:28px 24px;width:100%;max-width:360px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
      <div style="width:36px;height:36px;background:#1a1a1a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700">P</div>
      <div><div style="font-size:16px;font-weight:700">Pulse</div><div style="font-size:11px;color:#888">Dashboard operacional</div></div>
    </div>
    ${erro?`<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:7px;padding:8px 12px;font-size:12px;color:#991b1b;margin-bottom:14px">${erro}</div>`:''}
    <form method="POST" action="/api/app?action=login">
      <div class="field"><label>Seu nome</label>
        <select name="nome" required style="width:100%;border:1px solid #e5e5e5;border-radius:7px;padding:8px 10px;font-size:13px;outline:none">
          <option value="">Selecione...</option>${opcoes}
        </select>
      </div>
      <div class="field"><label>Senha</label>
        <input type="password" name="senha" required placeholder="••••••" style="width:100%;border:1px solid #e5e5e5;border-radius:7px;padding:8px 10px;font-size:13px;outline:none">
      </div>
      <button type="submit" style="width:100%;background:#1a1a1a;color:#fff;border:none;border-radius:7px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px">Entrar</button>
    </form>
    <div style="text-align:center;margin-top:14px">
      <a href="/api/app?action=primeiro-acesso" style="font-size:12px;color:#1d4ed8;text-decoration:none">Primeiro acesso? Crie sua senha aqui</a>
    </div>
  </div>
</div>`);
}

function paginaPrimeiroAcesso(equipe, erro='') {
  const opcoes = equipe.filter(r=>!r[7]).map(r=>`<option value="${r[0]}">${r[0]}</option>`).join('');
  return baseHTML('Primeiro acesso', `
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
  <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:28px 24px;width:100%;max-width:360px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="width:36px;height:36px;background:#1a1a1a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700">P</div>
      <div><div style="font-size:16px;font-weight:700">Primeiro acesso</div></div>
    </div>
    <p style="font-size:12px;color:#888;margin-bottom:20px">Crie sua senha para acessar o Pulse.</p>
    ${erro?`<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:7px;padding:8px 12px;font-size:12px;color:#991b1b;margin-bottom:14px">${erro}</div>`:''}
    <form method="POST" action="/api/app?action=criar-senha">
      <div class="field"><label>Seu nome</label>
        <select name="nome" required style="width:100%;border:1px solid #e5e5e5;border-radius:7px;padding:8px 10px;font-size:13px;outline:none">
          <option value="">Selecione...</option>${opcoes}
        </select>
      </div>
      <div class="field"><label>Criar senha</label>
        <input type="password" name="senha" required minlength="4" placeholder="Mínimo 4 caracteres" style="width:100%;border:1px solid #e5e5e5;border-radius:7px;padding:8px 10px;font-size:13px;outline:none">
      </div>
      <div class="field"><label>Confirmar senha</label>
        <input type="password" name="confirmar" required minlength="4" placeholder="Repita a senha" style="width:100%;border:1px solid #e5e5e5;border-radius:7px;padding:8px 10px;font-size:13px;outline:none">
      </div>
      <button type="submit" style="width:100%;background:#1d4ed8;color:#fff;border:none;border-radius:7px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px">Criar senha e entrar</button>
    </form>
    <div style="text-align:center;margin-top:14px">
      <a href="/api/app" style="font-size:12px;color:#888;text-decoration:none">Voltar ao login</a>
    </div>
  </div>
</div>`);
}

export default async function handler(req, res) {
  const action = req.query.action || '';

  const equipeRaw = await getSheet('Equipe!A2:I50');

  if (req.method === 'POST' && action === 'login') {
    const { nome, senha } = req.body || {};
    const usuario = equipeRaw.find(r => r[0] === nome);
    if (!usuario) return res.redirect(302, '/api/app?erro=usuario');
    if (!usuario[7]) return res.redirect(302, '/api/app?action=primeiro-acesso&erro=sem-senha');
    if (usuario[7] !== hash(senha)) return res.redirect(302, '/api/app?erro=senha');
    setSessionCookie(res, nome);
    return res.redirect(302, '/api/app');
  }

  if (req.method === 'POST' && action === 'criar-senha') {
    const { nome, senha, confirmar } = req.body || {};
    if (senha !== confirmar) return res.redirect(302, '/api/app?action=primeiro-acesso&erro=senhas');
    if (senha.length < 4) return res.redirect(302, '/api/app?action=primeiro-acesso&erro=curta');
    const idx = equipeRaw.findIndex(r => r[0] === nome);
    if (idx < 0) return res.redirect(302, '/api/app?action=primeiro-acesso&erro=usuario');
    if (equipeRaw[idx][7]) return res.redirect(302, '/api/app?erro=ja-tem-senha');
    const row = idx + 2;
    await setSheet(`Equipe!H${row}`, [[hash(senha)]]);
    setSessionCookie(res, nome);
    return res.redirect(302, '/api/app');
  }

  if (req.method === 'POST' && action === 'logout') {
    clearSession(res);
    return res.redirect(302, '/api/app');
  }

  if (req.method === 'POST' && action === 'ajuste') {
    const session = getSession(req);
    if (!session) return res.status(401).json({error:'Não autorizado'});
    const usuario = equipeRaw.find(r => r[0] === session.nome);
    if (usuario?.[8] !== 'gestor') return res.status(403).json({error:'Acesso negado'});
    const {data, colaborador, entrada, saida, obs, acao} = req.body || {};
    const escalaRaw = await getSheet('Escala!A2:F500');
    const idx = escalaRaw.findIndex(r => r[0] === data && r[2] === colaborador);
    const obsVal = acao === 'folga' ? 'Folga' : acao === 'remover' ? 'Folga/Ausente' : (obs||'');
    const entVal = acao === 'horario' ? (entrada||'') : '';
    const saiVal = acao === 'horario' ? (saida||'') : '';
    if (idx >= 0) {
      await setSheet(`Escala!D${idx+2}:F${idx+2}`, [[entVal, saiVal, obsVal]]);
    } else {
      await appendSheet('Escala!A:F', [[data,'',colaborador,entVal,saiVal,obsVal]]);
    }
    const agora = getBRT();
    await appendSheet('Ajustes!A:G', [[agora.toLocaleString('pt-BR'), data, colaborador, acao, entVal, saiVal, obsVal]]);
    return res.status(200).json({ok:true});
  }

  if (action === 'logout') {
    clearSession(res);
    return res.redirect(302, '/api/app');
  }

  if (action === 'primeiro-acesso') {
    const erros = {usuario:'Usuário não encontrado.','sem-senha':'Crie uma senha primeiro.',senhas:'As senhas não coincidem.',curta:'Senha muito curta (mín. 4 caracteres).'};
    return res.status(200).send(paginaPrimeiroAcesso(equipeRaw, erros[req.query.erro]||''));
  }

  const session = getSession(req);
  if (!session) {
    const erros = {usuario:'Usuário não encontrado.',senha:'Senha incorreta.','ja-tem-senha':'Conta já criada. Faça login.'};
    return res.status(200).send(paginaLogin(equipeRaw, erros[req.query.erro]||''));
  }

  const usuario = equipeRaw.find(r => r[0] === session.nome);
  const isGestor = usuario?.[8] === 'gestor';
  const nome = session.nome;

  const hoje = getBRT();
  const d1 = new Date(hoje); d1.setDate(hoje.getDate()+1);
  const hojeStr = fmtData(hoje), d1Str = fmtData(d1);
  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
  const DIAS_FULL = ['Domingo','Segunda','Terca','Quarta','Quinta','Sexta','Sabado'];

  const dow = hoje.getDay();
  const seg = new Date(hoje); seg.setDate(hoje.getDate()-dow+1);
  const dias = Array.from({length:7},(_,i)=>{const d=new Date(seg);d.setDate(seg.getDate()+i);return d;});
  const segStr = fmtData(dias[0]), domStr = fmtData(dias[6]);

  const segProx = new Date(seg); segProx.setDate(seg.getDate()+7);
  const diasProx = Array.from({length:7},(_,i)=>{const d=new Date(segProx);d.setDate(segProx.getDate()+i);return d;});

  const semanasAnt = [-2,-1].map(offset=>{
    const s=new Date(seg); s.setDate(seg.getDate()+offset*7);
    return Array.from({length:7},(_,i)=>{const d=new Date(s);d.setDate(s.getDate()+i);return d;});
  });

  const [escalaRaw, ausenciasRaw, eventosHoje, eventosAmanha] = await Promise.all([
    getSheet('Escala!A2:F500'),
    getSheet('Ausencias!A2:I500'),
    getEventos(fmtAirtable(hoje)),
    getEventos(fmtAirtable(d1)),
  ]);

  const escala = escalaRaw;
  const ausencias = ausenciasRaw;
  // hora atual em minutos para comparar com eventos
  const horaAtualMin = hoje.getHours()*60 + hoje.getMinutes();

  if (isGestor) {
    const escSem = escala.filter(r=>r[0]>=segStr&&r[0]<=domStr);
    const ausSem = ausencias.filter(r=>r[4]>=segStr&&r[4]<=domStr);
    const escHoje = escala.filter(r=>r[0]===hojeStr);
    const escD1 = escala.filter(r=>r[0]===d1Str);
    const nomes = equipeRaw.map(r=>r[0]);

    function cruzarEventos(eventos, escDia, dataStr) {
      return eventos.map(ev=>{
        const disp=[],atenc=[],aus=[];
        escDia.forEach(r=>{
          const n=r[2], ent=r[3], sai=r[4], obs=r[5];
          const ausente=ausSem.find(a=>a[1]===n&&(a[4]===dataStr||a[5]===dataStr));
          if(ausente||obs==='Folga'||obs==='Folga/Ausente'||(!ent&&!sai)){aus.push({nome:n,motivo:ausente?ausente[3]:'Folga'});return;}
          if(estaDeServico(ent,sai,ev.hora)){
            const st=statusTurno(ent,sai,ev.hora);
            st?atenc.push({nome:n,ent,sai,status:st}):disp.push({nome:n,ent,sai});
          }
        });
        const semCob = disp.length===0&&atenc.length===0;
        // Verifica antecedencia: alguem ja trabalhando >= 1h antes do evento
        const evMin = toMin(ev.hora);
        const temAntecedencia = evMin===null || disp.concat(atenc).some(p=>{
          const entMin = toMin(p.ent);
          const saiMin = toMin(p.sai);
          if(entMin===null||saiMin===null) return false;
          // turno normal (ex: 08:00-16:00)
          if(saiMin > entMin) {
            return (evMin - entMin) >= 60;
          } else {
            // turno vira meia-noite (ex: 23:00-07:00)
            // evento antes da meia-noite: distancia desde entrada
            if(evMin >= entMin) return (evMin - entMin) >= 60;
            // evento depois da meia-noite: entrada foi ontem, sempre tem antecedencia
            return true;
          }
        });
        return{...ev,disp,atenc,aus,semCob,semAntecedencia:!semCob&&!temAntecedencia};
      });
    }

    const eventosCruzadosHoje = cruzarEventos(eventosHoje, escHoje, hojeStr);
    const eventosCruzadosAmanha = cruzarEventos(eventosAmanha, escD1, d1Str);

    const semCob=eventosCruzadosAmanha.filter(e=>e.semCob).length;
    const comAtenc=eventosCruzadosAmanha.filter(e=>e.atenc.length>0).length;
    const trabAmanha=escD1.filter(r=>r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Folga/Ausente').length;
    const folgAmanha=escD1.filter(r=>!r[3]||r[5]==='Folga'||r[5]==='Folga/Ausente').length;
    const cobPct=equipeRaw.length>0?Math.round(trabAmanha/equipeRaw.length*100):0;
    const atualizado=hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

    function av(n,bg='#dbeafe',c='#1d4ed8'){return `<div style="width:24px;height:24px;border-radius:50%;background:${bg};color:${c};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(n)}</div>`;}

    function renderEventos(eventosCruzados, comOpacidade=false) {
      if(eventosCruzados.length===0) return `<div style="padding:20px;text-align:center;color:#aaa;font-size:13px">Nenhum evento</div>`;
      return eventosCruzados.map(ev=>{
        const evMin = toMin(ev.hora);
        const encerrado = comOpacidade && evMin !== null && evMin < horaAtualMin - 30;
        const fraseEnc = encerrado ? gerarFraseEncerrado(ev.nome) : '';
        const [bc,bb,itc]=ev.semCob?['#fef2f2','#fca5a5','#991b1b']:['#f0fdf4','#86efac','#166534'];
        return `<div style="border:1px solid ${encerrado?'#e5e7eb':bb};border-radius:8px;margin-bottom:10px;overflow:hidden${encerrado?';opacity:.35':''}">
          <div style="background:${encerrado?'#f9fafb':bc};padding:8px 12px;display:flex;align-items:center;gap:10px">
            <div style="font-size:13px;font-weight:700;color:${encerrado?'#9ca3af':'#1d4ed8'};min-width:50px">${ev.hora||'--'}</div>
            <div style="flex:1"><div style="font-size:12px;font-weight:700;color:${encerrado?'#9ca3af':'#1a1a1a'}">${ev.nome}</div><div style="font-size:10px;color:#aaa">${ev.tipo}</div></div>
            ${encerrado
              ? `<div style="font-size:10px;font-weight:600;color:#9ca3af;font-style:italic">${fraseEnc}</div>`
              : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
                  <div style="font-size:10px;font-weight:700;color:${itc}">${ev.semCob?'Sem cobertura':'OK'}</div>
                  ${ev.semAntecedencia?`<span style="font-size:14px;animation:pulsar 1s infinite">&#9888;</span>`:''}
                </div>`
            }
          </div>
          ${!encerrado?`<div style="padding:8px 12px">
            ${ev.disp.map(p=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f5f5f5">${av(p.nome)}<span style="flex:1;font-size:11px;font-weight:600">${p.nome}</span><span style="font-size:11px;color:#1d4ed8;font-weight:600">${p.ent}--${p.sai}</span></div>`).join('')}
            ${ev.atenc.map(p=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #fef9c3">${av(p.nome,'#fef3c7','#92400e')}<span style="flex:1;font-size:11px;font-weight:600">${p.nome}</span><span style="font-size:11px;color:#555">${p.ent}--${p.sai}</span></div>`).join('')}
            ${ev.semCob?`<div style="text-align:center;padding:6px;color:#991b1b;font-size:11px;font-weight:600">Sem cobertura neste horario</div>`:''}
            ${ev.aus.length?`<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px">${ev.aus.map(p=>`<span style="background:#f3f4f6;color:#9ca3af;border-radius:3px;padding:1px 6px;font-size:10px">${p.nome.split(' ')[0]}</span>`).join('')}</div>`:''}
          </div>`:''}
        </div>`;
      }).join('');
    }

    let tabelaHTML='';
    nomes.forEach(n=>{
      const cargo=equipeRaw.find(r=>r[0]===n)?.[1]||'';
      tabelaHTML+=`<tr><td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;text-align:left"><div style="display:flex;align-items:center;gap:6px">${av(n)}<div><div style="font-size:11px;font-weight:600;white-space:nowrap">${n}</div>${cargo?`<div style="font-size:9px;color:#aaa">${cargo}</div>`:''}</div></div></td>`;
      dias.forEach(d=>{
        const df=fmtData(d), isD1=df===d1Str, isHoje=df===hojeStr;
        const reg=escSem.find(r=>r[0]===df&&r[2]===n);
        const ausente=ausSem.find(a=>a[1]===n&&(a[4]===df||a[5]===df));
        const bg=isD1?'#eff6ff':isHoje?'#fafafa':'';
        tabelaHTML+=`<td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;text-align:center;background:${bg};cursor:pointer" onclick="abrirAjuste('${df}','${n}','${reg?reg[3]:''}','${reg?reg[4]:''}','${reg?reg[5]:''}')">`;
        if(ausente) tabelaHTML+=`<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">${ausente[3]||'Aus.'}</span>`;
        else if(reg){
          if(reg[5]==='Folga') tabelaHTML+=`<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Folga</span>`;
          else if(!reg[3]&&!reg[4]) tabelaHTML+=`<span style="color:#d1d5db;font-size:11px">--</span>`;
          else tabelaHTML+=`<span style="font-size:11px;color:${isD1?'#1d4ed8':'#333'};font-weight:${isD1?700:500}">${reg[3]}--${reg[4]}</span>`;
        } else tabelaHTML+=`<span style="color:#e5e7eb;font-size:11px">+</span>`;
        tabelaHTML+=`</td>`;
      });
      tabelaHTML+=`</tr>`;
    });

    const conteudo=`
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px">Gestor</span></div><div class="hs">${DIAS_FULL[d1.getDay()]} ${d1Str} · ${atualizado}</div></div>
  <div class="hr">
    <span style="font-size:12px;color:#666">Ola, ${nome.split(' ')[0]}</span>
    <a href="/api/escalas?v=semana" class="btn-sm">Escala</a>
    <a href="/api/equipe-view" class="btn-sm">Equipe</a>
    <button class="btn-sm" onclick="location.reload()">&#8635;</button>
    <button id="tt" class="btn-sm" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'&#9728;&#65039;':'&#127769;';})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <form method="POST" action="/api/app?action=logout" style="display:inline"><button type="submit" class="btn-sm">Sair</button></form>
  </div>
</div>
<div class="wrap">
  <div class="metrics">
    <div class="metric blue-m"><div class="ml">Trabalhando amanha</div><div class="mv">${trabAmanha}</div><div class="ms">${cobPct}% cobertura · ${equipeRaw.length} na equipe</div></div>
    <div class="metric ${folgAmanha>2?'amber-m':''}"><div class="ml">Folgas amanha</div><div class="mv">${folgAmanha}</div><div class="ms">${ausencias.filter(a=>a[4]===d1Str).length} via Pulse</div></div>
    <div class="metric ${semCob>0?'red-m':''}"><div class="ml">Sem cobertura</div><div class="mv">${semCob}</div><div class="ms">de ${eventosAmanha.length} eventos amanha</div></div>
    <div class="metric ${comAtenc>0?'amber-m':''}"><div class="ml">Trocas de turno</div><div class="mv">${comAtenc}</div><div class="ms">eventos com entrada/saida</div></div>
  </div>
  <div class="layout2">
    <div class="card">
      <div class="card-header">
        <span class="card-title">#NossoDia</span>
        <span class="badge blue">${eventosHoje.length} eventos</span>
        <span style="font-size:10px;color:#888;margin-left:auto">${hojeStr}</span>
      </div>
      <div class="card-body" style="max-height:500px;overflow-y:auto">${renderEventos(eventosCruzadosHoje, true)}</div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">#NossoDiaAmanha</span>
        <span class="badge ${semCob>0?'red':comAtenc>0?'amber':'green'}">${eventosAmanha.length} eventos</span>
        <span style="font-size:10px;color:#888;margin-left:auto">${d1Str}</span>
      </div>
      <div class="card-body" style="max-height:500px;overflow-y:auto">${renderEventos(eventosCruzadosAmanha, false)}</div>
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

    const script=`<script>
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
  const r=await fetch('/api/app?action=ajuste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.ok){fecharModal();toast('Escala atualizada!');setTimeout(()=>location.reload(),1200);}
  else toast('Erro: '+d.error,'#dc2626');
}
function toast(msg,bg='#1a1a1a'){const t=document.getElementById('toast');t.textContent=msg;t.style.background=bg;t.style.display='block';setTimeout(()=>t.style.display='none',2500);}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)fecharModal();});
</script>`;

    return res.status(200).send(baseHTML('Gestor', conteudo, script));

  } else {
    const cargo = usuario?.[1]||'', nucleo = usuario?.[2]||'Operacoes';
    const turnoHoje = escala.find(r=>r[0]===hojeStr&&r[2]===nome);
    const turnoD1 = escala.find(r=>r[0]===d1Str&&r[2]===nome);
    const ausHoje = ausencias.find(a=>a[1]===nome&&(a[4]===hojeStr||a[5]===hojeStr));
    const ausD1 = ausencias.find(a=>a[1]===nome&&(a[4]===d1Str||a[5]===d1Str));

    function cardTurno(turno, aus, label, isAmanha=false) {
      if(aus) return `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:#991b1b;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:20px;font-weight:700;color:#991b1b">${aus[3]||'Ausencia'}</div></div>`;
      if(!turno||(!turno[3]&&!turno[4])) return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:15px;color:#9ca3af">Sem escala</div></div>`;
      if(turno[5]==='Folga') return `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:#92400e;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:20px;font-weight:700;color:#d97706">Folga</div></div>`;
      const [bg,bc,tc]=isAmanha?['#eff6ff','#93c5fd','#1d4ed8']:['#fff','#e5e5e5','#1a1a1a'];
      return `<div style="background:${bg};border:1px solid ${bc};border-radius:10px;padding:12px 14px"><div style="font-size:10px;color:${isAmanha?'#3b82f6':'#888'};font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:22px;font-weight:700;color:${tc}">${turno[3]} -- ${turno[4]}</div></div>`;
    }

    function renderSemana(diasSem, labelSem, isAtual=false, isProx=false) {
      return `<div style="margin-bottom:20px">
        <div class="semana-titulo" style="color:${isAtual?'#1d4ed8':isProx?'#059669':'#888'}">
          ${labelSem} ${isAtual?'<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 6px;font-size:9px">atual</span>':''}${isProx?'<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 6px;font-size:9px">proxima</span>':''}
        </div>
        <div class="grid7">
          ${diasSem.map(d=>{
            const df=fmtData(d), isHoje=df===hojeStr, isDiaD1=df===d1Str;
            const turno=escala.find(r=>r[0]===df&&r[2]===nome);
            const aus=ausencias.find(a=>a[1]===nome&&(a[4]===df||a[5]===df));
            let turnoTxt='--', tc=isHoje?'#aaa':'#9ca3af', saiTxt='';
            if(aus){turnoTxt=aus[3]||'Aus.';tc=isHoje?'#fca5a5':'#dc2626';}
            else if(turno){
              if(turno[5]==='Folga'){turnoTxt='Folga';tc=isHoje?'#fde68a':'#d97706';}
              else if(turno[3]&&turno[4]){turnoTxt=turno[3];saiTxt='--'+turno[4];tc=isHoje?'#fff':isDiaD1?'#1d4ed8':'#1a1a1a';}
            }
            return `<div class="dia-card ${isHoje?'hoje':isDiaD1?'d1':''}">
              <div style="font-size:9px;font-weight:600;color:${isHoje?'#888':isDiaD1?'#3b82f6':'#aaa'};text-transform:uppercase">${DIAS_PT[d.getDay()]}</div>
              <div style="font-size:10px;font-weight:600;color:${isHoje?'#ccc':isDiaD1?'#3b82f6':'#888'};margin:1px 0">${df}</div>
              <div style="font-size:11px;font-weight:700;color:${tc};margin-top:3px">${turnoTxt}</div>
              ${saiTxt?`<div style="font-size:9px;color:${isHoje?'#666':isDiaD1?'#93c5fd':'#aaa'}">${saiTxt}</div>`:''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    const atualizado=hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

    const conteudo=`
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse</div><div class="hs">Meu turno</div></div>
  <div class="hr">
    <span style="font-size:11px;color:#666">${atualizado}</span>
    <form method="POST" action="/api/app?action=logout" style="display:inline"><button type="submit" class="btn-sm">Sair</button></form>
  </div>
</div>
<div class="wrap" style="max-width:620px">
  <div style="background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <div style="width:44px;height:44px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
    <div><div style="font-size:16px;font-weight:700">${nome}</div><div style="font-size:12px;color:#888">${cargo||'Colaborador'} · ${nucleo}</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
    ${cardTurno(turnoHoje,ausHoje,'#NossoDia -- '+DIAS_FULL[hoje.getDay()])}
    ${cardTurno(turnoD1,ausD1,'#NossoDiaAmanha -- '+DIAS_FULL[d1.getDay()],true)}
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">Minha escala</span></div>
    <div class="card-body">
      ${semanasAnt.map(s=>renderSemana(s,`Semana ${fmtData(s[0])}--${fmtData(s[6])}`)).join('')}
      ${renderSemana(dias,'Semana atual',true)}
      ${renderSemana(diasProx,'Proxima semana',false,true)}
    </div>
  </div>
  <div style="text-align:center;padding:16px 0;font-size:11px;color:#aaa">Para registrar folga ou ausencia, mande um DM para o Pulse no Slack</div>
</div>`;

    return res.status(200).send(baseHTML('Meu turno', conteudo));
  }
}
