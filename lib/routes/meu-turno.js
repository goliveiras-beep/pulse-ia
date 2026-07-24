// api/meu-turno.js — Visão individual da equipe
// Acesse: /api/meu-turno?nome=rafael-gusmao
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
import { createHash } from 'crypto';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';
const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function parseCookies(cookieHeader) {
  const cookies = {};
  (cookieHeader||'').split(';').forEach(c => {
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
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch { return null; }
}

function getBRT() {
  const a=new Date(); return new Date(a.getTime()+((-3*60)-a.getTimezoneOffset())*60000);
}
function toHoraBRT(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  d.setHours(d.getHours() - 3);
  return d.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || '';
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function slugToNome(slug, equipe) {
  const normaliza = s => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,'-');
  return equipe.find(r => normaliza(r[0]) === slug)?.[0] || null;
}
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}
async function getEventosDia(dataStr) {
  const filter=`OR(DATESTR({fldBNl8ypKaV5hFG5})='${dataStr}',DATESTR({fldgNvn52DK5Yu8x9})='${dataStr}')`;
  try {
    const r=await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=20`,
      {headers:{Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`}});
    const d=await r.json();
    return (d.records||[]).map(r=>({nome:r.fields['Match ID']||'Evento',hora:toHoraBRT(r.fields['Início do Evento BRT']||''),tipo:r.fields['Tipo de Conteúdo']||''}))
      .sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  } catch { return []; }
}

function semanasDe(dataRef, qtd) {
  const semanas=[];
  for(let s=-(qtd-1);s<=1;s++){
    const seg=new Date(dataRef);
    const dow=dataRef.getDay();
    seg.setDate(dataRef.getDate()-dow+1+s*7);
    const dias=Array.from({length:7},(_,i)=>{const d=new Date(seg);d.setDate(seg.getDate()+i);return d;});
    semanas.push(dias);
  }
  return semanas;
}

function shellCSS() {
  return `
:root{
  --bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;
  --text:#1a1a1a;--text2:#555;--text3:#888;--text4:#bbb;
  --header:#161920;--blue:#1d4ed8;
  --blue-m-bg:#eff6ff;--blue-m-border:#dbeafe;--blue-m-v:#1d4ed8;
  --badge-green-bg:#dcfce7;--badge-green-c:#166534;
  --badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
  --badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
  --shadow-sm:0 1px 2px rgba(20,20,20,.05);
}
html.dark{
  --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
  --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
  --header:#0f1117;--blue:#63b3ed;
  --blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;
  --badge-green-bg:#0d2010;--badge-green-c:#68d391;
  --badge-red-bg:#1f1010;--badge-red-c:#fc8181;
  --badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
  --shadow-sm:0 1px 2px rgba(0,0,0,.35);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);max-width:600px;margin:0 auto}
a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:28px;height:28px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;font-size:12px;font-weight:700;flex-shrink:0}
.ht{font-size:14px;font-weight:600;color:#fff}
.hs{font-size:11px;color:#888}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer;text-decoration:none}
.btn-sm:hover{border-color:#6b7280;color:#e2e8f0}
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:var(--text);text-decoration:none;white-space:nowrap}
.menu-item:hover{background:var(--bg3)}
.wrap{padding:14px 16px}
.av-big{width:48px;height:48px;border-radius:50%;background:var(--blue-m-bg);color:var(--blue-m-v);font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-sm)}
`;
}

function menuHTML(isGestor) {
  const itensGestor = isGestor ? `
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausências</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
  ` : '';
  return `
    <button id="tt" class="btn-sm" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Início</a>${itensGestor}
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/equipamentos" class="menu-item">&#128230; Equipamentos</a>
        <a href="/api/chamados" class="menu-item">&#127915; Chamados</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>`;
}

const MENU_SCRIPT = `
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
</script>`;

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const slug = req.query.nome || '';
  // Equipe (12 col): 0=nome, 1=cargo, 2=nucleo, 8=perfil, 10=status aprovação
  const [equipeRaw, escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:L200'),
    getSheet('Escala!A2:F500'),
    getSheet('Ausências!A2:I500'),
  ]);

  const usuario = equipeRaw.find(r => r[0] === session.nome);
  if (!usuario || (usuario[10]||'ativo') !== 'ativo') return res.redirect(302, '/api/app');
  const isGestor = usuario[8] === 'gestor';

  const nome = slugToNome(slug, equipeRaw);
  if (!nome) {
    // Mostra lista de links disponíveis
    const links = equipeRaw.filter(r => r[0] && (r[10]||'ativo') === 'ativo').map(r=>{
      const s=r[0].toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,'-');
      return `<li style="padding:8px 0;border-bottom:1px solid var(--border2)"><a href="/api/meu-turno?nome=${s}" style="color:var(--blue);text-decoration:none;font-size:14px">${esc(r[0])}</a></li>`;
    }).join('');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulse — Meu turno</title>
<style>${shellCSS()}</style></head><body>
<div class="header"><div class="logo">P</div><div><div class="ht">Pulse</div><div class="hs">Meu turno</div></div><div class="hr">${menuHTML(isGestor)}</div></div>
<div class="wrap"><h2 style="font-size:16px;margin-bottom:16px;font-weight:700">Selecione o nome</h2><ul style="list-style:none;padding:0">${links}</ul></div>
${MENU_SCRIPT}
</body></html>`);
  }

  const perfil = equipeRaw.find(r=>r[0]===nome) || [nome,'','Operações'];
  const cargo = perfil[1]||'', nucleo = perfil[2]||'Operações';

  const hoje = getBRT();
  const d1 = new Date(hoje); d1.setDate(hoje.getDate()+1);
  const hojeStr = fmtData(hoje), d1Str = fmtData(d1);
  const DIAS_PT=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIAS_FULL=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  // Semanas: 2 anteriores + atual + próxima = 4 semanas
  const semanas = semanasDe(hoje, 4);

  // Busca eventos para os dias que a pessoa trabalha
  const diasTrabalhados = escalaRaw.filter(r=>r[2]===nome&&r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Folga/Ausente').map(r=>r[0]);
  const eventosMap = {};
  for(const dia of diasTrabalhados.slice(0,14)) {
    const [d,m] = dia.split('/');
    const ano = hoje.getFullYear();
    const dataAt = fmtAirtable(new Date(ano, parseInt(m)-1, parseInt(d)));
    const evs = await getEventosDia(dataAt);
    if(evs.length) eventosMap[dia] = evs;
  }

  // Turno de hoje e amanhã
  const turnoHoje = escalaRaw.find(r=>r[0]===hojeStr&&r[2]===nome);
  const turnoD1 = escalaRaw.find(r=>r[0]===d1Str&&r[2]===nome);
  const ausenciaHoje = ausenciasRaw.find(a=>a[1]===nome&&(a[4]===hojeStr||a[5]===hojeStr));
  const ausenciaD1 = ausenciasRaw.find(a=>a[1]===nome&&(a[4]===d1Str||a[5]===d1Str));

  function renderTurnoCard(turno, ausencia, label, isD1=false) {
    if(ausencia) return `<div class="card" style="background:var(--badge-red-bg);border-color:var(--badge-red-c);padding:10px 14px"><div style="font-size:10px;color:var(--badge-red-c);font-weight:600;text-transform:uppercase;margin-bottom:4px">${esc(label)}</div><div style="font-size:20px;font-weight:700;color:var(--badge-red-c)">${esc(ausencia[3]||'Ausência')}</div></div>`;
    if(!turno||(!turno[3]&&!turno[4])) return `<div class="card" style="padding:10px 14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">${esc(label)}</div><div style="font-size:16px;color:var(--text4)">Sem escala</div></div>`;
    if(turno[5]==='Folga') return `<div class="card" style="background:var(--badge-amber-bg);border-color:var(--badge-amber-c);padding:10px 14px"><div style="font-size:10px;color:var(--badge-amber-c);font-weight:600;text-transform:uppercase;margin-bottom:4px">${esc(label)}</div><div style="font-size:20px;font-weight:700;color:var(--badge-amber-c)">Folga</div></div>`;
    const bg=isD1?'var(--blue-m-bg)':'var(--card)', bc=isD1?'var(--blue-m-border)':'var(--border)', tc=isD1?'var(--blue-m-v)':'var(--text)';
    return `<div class="card" style="background:${bg};border-color:${bc};padding:10px 14px"><div style="font-size:10px;color:${isD1?'var(--blue-m-v)':'var(--text3)'};font-weight:600;text-transform:uppercase;margin-bottom:4px">${esc(label)}</div><div style="font-size:22px;font-weight:700;color:${tc}">${esc(turno[3])} → ${esc(turno[4])}</div>${eventosMap[isD1?d1Str:hojeStr]?`<div style="margin-top:6px">${eventosMap[isD1?d1Str:hojeStr].map(e=>`<div style="font-size:11px;color:var(--text2);padding:2px 0">${e.hora?esc(e.hora)+' · ':''}${esc(e.nome)}</div>`).join('')}</div>`:''}</div>`;
  }

  let semanasHTML='';
  semanas.forEach((dias,si)=>{
    const segS=fmtData(dias[0]), domS=fmtData(dias[6]);
    const isAtual=dias.some(d=>fmtData(d)===hojeStr);
    const isProxima=dias[0]>hoje&&si===semanas.length-1;
    const label=isAtual?'Semana atual':isProxima?'Próxima semana':`Semana ${segS}–${domS}`;

    semanasHTML+=`<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:${isAtual?'var(--blue-m-v)':isProxima?'var(--badge-green-c)':'var(--text3)'};text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        ${label}${isAtual?'<span style="background:var(--blue-m-bg);color:var(--blue-m-v);border-radius:4px;padding:1px 6px;font-size:9px">atual</span>':''}${isProxima?'<span style="background:var(--badge-green-bg);color:var(--badge-green-c);border-radius:4px;padding:1px 6px;font-size:9px">próxima</span>':''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${dias.map(d=>{
          const df=fmtData(d);
          const isHoje=df===hojeStr, isD1=df===d1Str;
          const turno=escalaRaw.find(r=>r[0]===df&&r[2]===nome);
          const ausente=ausenciasRaw.find(a=>a[1]===nome&&(a[4]===df||a[5]===df));
          const eventos=eventosMap[df]||[];
          let bg='var(--card)',bc='var(--border)',tc='var(--text)';
          if(isHoje){bg='var(--header)';bc='var(--header)';tc='#fff';}
          else if(isD1){bg='var(--blue-m-bg)';bc='var(--blue-m-border)';tc='var(--blue-m-v)';}
          let turnoTxt='—', turnoColor=isHoje?'#fff':'var(--text4)';
          if(ausente){turnoTxt=ausente[3]||'Aus.';turnoColor=isHoje?'#fca5a5':'var(--badge-red-c)';}
          else if(turno){
            if(turno[5]==='Folga'){turnoTxt='Folga';turnoColor=isHoje?'#fde68a':'var(--badge-amber-c)';}
            else if(turno[3]&&turno[4]){turnoTxt=`${turno[3]}`;turnoColor=isHoje?'#fff':isD1?'var(--blue-m-v)':'var(--text)';}
          }
          return `<div style="background:${bg};border:1px solid ${bc};border-radius:8px;padding:8px 6px;text-align:center;min-height:70px">
            <div style="font-size:9px;font-weight:600;color:${isHoje?'var(--text4)':isD1?'var(--blue-m-v)':'var(--text3)'};text-transform:uppercase;margin-bottom:3px">${DIAS_PT[d.getDay()]}</div>
            <div style="font-size:11px;font-weight:600;color:${isHoje?'#fff':'var(--text2)'}">${df}</div>
            <div style="font-size:10px;font-weight:700;color:${turnoColor};margin-top:4px">${esc(turnoTxt)}</div>
            ${turno&&turno[4]&&turno[5]!=='Folga'?`<div style="font-size:9px;color:${isHoje?'var(--text4)':'var(--text4)'}">→${esc(turno[4])}</div>`:''}
            ${eventos.length?`<div style="margin-top:3px;font-size:8px;color:${isHoje?'#fcd34d':'#f59e0b'};font-weight:600">${eventos.length} evento${eventos.length>1?'s':''}</div>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  const atualizado=hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

  const html=`<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — ${esc(nome)}</title>
<style>${shellCSS()}</style>
</head><body>
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse</div><div class="hs">Meu turno</div></div>
  <div style="margin-left:auto;font-size:10px;color:#888">${atualizado}</div>
  <div class="hr">${menuHTML(isGestor)}</div>
</div>
<div class="wrap">
  <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px 16px">
    <div class="av-big">${iniciais(nome)}</div>
    <div>
      <div style="font-size:16px;font-weight:700">${esc(nome)}</div>
      <div style="font-size:12px;color:var(--text3)">${esc(cargo||'Colaborador')} · ${esc(nucleo)}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
    ${renderTurnoCard(turnoHoje,ausenciaHoje,'Hoje — '+DIAS_FULL[hoje.getDay()])}
    ${renderTurnoCard(turnoD1,ausenciaD1,'Amanhã — '+DIAS_FULL[d1.getDay()],true)}
  </div>

  <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Minha escala</div>
  ${semanasHTML}

  <div style="text-align:center;padding:16px 0;font-size:11px;color:var(--text4)">
    Para registrar folga ou ausência, use o botão de Solicitações no portal
  </div>
</div>
${MENU_SCRIPT}
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
