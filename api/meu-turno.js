// api/meu-turno.js — Visão individual da equipe
// Acesse: /api/meu-turno?nome=rafael-gusmao
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';

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
  const normaliza = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-');
  return equipe.find(r => normaliza(r[0]) === slug)?.[0] || null;
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}
async function getEventosDia(dataStr) {
  // Filtra só pela data de INÍCIO (fldgNvn52DK5Yu8x9) — fldBNl8ypKaV5hFG5 é o Encerramento
  // e não deve entrar no filtro, senão evento de outro dia vaza para a lista de hoje.
  const filter=`DATESTR({fldgNvn52DK5Yu8x9})='${dataStr}'`;
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

export default async function handler(req, res) {
  const slug = req.query.nome || '';
  const [equipeRaw, escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:G50'),
    getSheet('Escala!A2:F500'),
    getSheet('Ausências!A2:I500'),
  ]);

  const nome = slugToNome(slug, equipeRaw);
  if (!nome) {
    // Mostra lista de links disponíveis
    const links = equipeRaw.map(r=>{
      const s=r[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-');
      return `<li style="padding:8px 0;border-bottom:1px solid #f0f0f0"><a href="/api/meu-turno?nome=${s}" style="color:#1d4ed8;text-decoration:none;font-size:14px">${r[0]}</a></li>`;
    }).join('');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Pulse — Meu turno</title><style>body{font-family:-apple-system,sans-serif;max-width:400px;margin:40px auto;padding:0 20px}h2{font-size:16px;margin-bottom:16px}</style></head><body><h2>Selecione seu nome</h2><ul style="list-style:none;padding:0">${links}</ul></body></html>`);
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
    if(ausencia) return `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px"><div style="font-size:10px;color:#991b1b;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:20px;font-weight:700;color:#991b1b">${ausencia[3]||'Ausência'}</div></div>`;
    if(!turno||(!turno[3]&&!turno[4])) return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px"><div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:16px;color:#9ca3af">Sem escala</div></div>`;
    if(turno[5]==='Folga') return `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px"><div style="font-size:10px;color:#92400e;font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:20px;font-weight:700;color:#d97706">Folga</div></div>`;
    const bg=isD1?'#eff6ff':'#fff', bc=isD1?'#93c5fd':'#e5e5e5', tc=isD1?'#1d4ed8':'#1a1a1a';
    return `<div style="background:${bg};border:1px solid ${bc};border-radius:8px;padding:10px 14px"><div style="font-size:10px;color:${isD1?'#3b82f6':'#888'};font-weight:600;text-transform:uppercase;margin-bottom:4px">${label}</div><div style="font-size:22px;font-weight:700;color:${tc}">${turno[3]} → ${turno[4]}</div>${eventosMap[isD1?d1Str:hojeStr]?`<div style="margin-top:6px">${eventosMap[isD1?d1Str:hojeStr].map(e=>`<div style="font-size:11px;color:#555;padding:2px 0">${e.hora?e.hora+' · ':''}${e.nome}</div>`).join('')}</div>`:''}</div>`;
  }

  let semanasHTML='';
  semanas.forEach((dias,si)=>{
    const segS=fmtData(dias[0]), domS=fmtData(dias[6]);
    const isAtual=dias.some(d=>fmtData(d)===hojeStr);
    const isProxima=dias[0]>hoje&&si===semanas.length-1;
    const label=isAtual?'Semana atual':isProxima?'Próxima semana':`Semana ${segS}–${domS}`;

    semanasHTML+=`<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:${isAtual?'#1d4ed8':isProxima?'#059669':'#888'};text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        ${label}${isAtual?'<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 6px;font-size:9px">atual</span>':''}${isProxima?'<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 6px;font-size:9px">próxima</span>':''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${dias.map(d=>{
          const df=fmtData(d);
          const isHoje=df===hojeStr, isD1=df===d1Str;
          const turno=escalaRaw.find(r=>r[0]===df&&r[2]===nome);
          const ausente=ausenciasRaw.find(a=>a[1]===nome&&(a[4]===df||a[5]===df));
          const eventos=eventosMap[df]||[];
          let bg='#fff',bc='#e5e5e5',tc='#1a1a1a';
          if(isHoje){bg='#1a1a1a';bc='#1a1a1a';tc='#fff';}
          else if(isD1){bg='#eff6ff';bc='#93c5fd';tc='#1d4ed8';}
          let turnoTxt='—', turnoColor=isHoje?'#fff':'#9ca3af';
          if(ausente){turnoTxt=ausente[3]||'Aus.';turnoColor=isHoje?'#fca5a5':'#dc2626';}
          else if(turno){
            if(turno[5]==='Folga'){turnoTxt='Folga';turnoColor=isHoje?'#fde68a':'#d97706';}
            else if(turno[3]&&turno[4]){turnoTxt=`${turno[3]}`;turnoColor=isHoje?'#fff':isD1?'#1d4ed8':'#1a1a1a';}
          }
          return `<div style="background:${bg};border:1px solid ${bc};border-radius:8px;padding:8px 6px;text-align:center;min-height:70px">
            <div style="font-size:9px;font-weight:600;color:${isHoje?'#aaa':isD1?'#3b82f6':'#888'};text-transform:uppercase;margin-bottom:3px">${DIAS_PT[d.getDay()]}</div>
            <div style="font-size:11px;font-weight:600;color:${isHoje?'#fff':'#555'}">${df}</div>
            <div style="font-size:10px;font-weight:700;color:${turnoColor};margin-top:4px">${turnoTxt}</div>
            ${turno&&turno[4]&&turno[5]!=='Folga'?`<div style="font-size:9px;color:${isHoje?'#aaa':'#9ca3af'}">→${turno[4]}</div>`:''}
            ${eventos.length?`<div style="margin-top:3px;font-size:8px;color:${isHoje?'#fcd34d':'#f59e0b'};font-weight:600">${eventos.length} evento${eventos.length>1?'s':''}</div>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  const atualizado=hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

  const html=`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — ${nome}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a;max-width:600px;margin:0 auto}
.header{background:#1a1a1a;padding:14px 16px;display:flex;align-items:center;gap:10px}
.logo{width:28px;height:28px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;font-size:12px;font-weight:700}
.ht{font-size:14px;font-weight:600;color:#fff}
.hs{font-size:11px;color:#888}
.wrap{padding:14px 16px}
.av-big{width:48px;height:48px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center}
</style>
</head><body>
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse</div><div class="hs">Meu turno</div></div>
  <div style="margin-left:auto;font-size:10px;color:#555">${atualizado}</div>
</div>
<div class="wrap">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px">
    <div class="av-big">${iniciais(nome)}</div>
    <div>
      <div style="font-size:16px;font-weight:700">${nome}</div>
      <div style="font-size:12px;color:#888">${cargo||'Colaborador'} · ${nucleo}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
    ${renderTurnoCard(turnoHoje,ausenciaHoje,'Hoje — '+DIAS_FULL[hoje.getDay()])}
    ${renderTurnoCard(turnoD1,ausenciaD1,'Amanhã — '+DIAS_FULL[d1.getDay()],true)}
  </div>

  <div style="font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Minha escala</div>
  ${semanasHTML}

  <div style="text-align:center;padding:16px 0;font-size:11px;color:#aaa">
    Para registrar folga ou ausência, mande um DM para o Pulse no Slack
  </div>
</div>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
