// api/gerar-escala.js — Geração de escala com cobertura inteligente
export const config = { maxDuration: 60 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const AIRTABLE_BASE = 'appwE9LmmTxynTGFY';
const AIRTABLE_TABLE = 'tblpibvwAIGBQXr0H';
const COOKIE_NAME = 'pulse_session';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }

function estaDeServico(ent, sai, horaEv) {
  if(!ent||!sai||!horaEv) return false;
  const i=toMin(ent), f=toMin(sai), e=toMin(horaEv);
  if(f > i) return e >= i-60 && e <= f;
  return e >= i-60 || e <= f;
}

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

async function getEventosPeriodo(dataInicio, dataFim) {
  const filter = `AND(DATESTR({fldRnfbwPVzFiHMqs})>='${dataInicio}',DATESTR({fldRnfbwPVzFiHMqs})<='${dataFim}')`;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=300&sort[0][field]=fldRnfbwPVzFiHMqs&sort[0][direction]=asc`,
      {headers:{Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`}});
    const d = await r.json();
    return (d.records||[]).map(r=>({
      data: r.fields['fldRnfbwPVzFiHMqs']?.split('T')[0]||'',
      hora: r.fields['Horário KO']||r.fields['PGM (horário)']||'',
      nome: r.fields['Match ID']||'Evento',
      tipo: r.fields['Tipo de Conteúdo']||'',
    }));
  } catch { return []; }
}

async function ajustarDia(data, eventosDia, escalaBase) {
  const lacunas = eventosDia.filter(ev => {
    if(!ev.hora) return false;
    return !escalaBase.some(p => estaDeServico(p.ent, p.sai, ev.hora));
  });

  if(lacunas.length === 0) return { escala: escalaBase, ajustes: [], lacunasResolvidas: 0 };

  const escalaStr = escalaBase.map(p=>`${p.nome}: ${p.ent}–${p.sai}`).join('\n');
  const lacunasStr = lacunas.map(e=>`${e.hora} — ${e.nome} (${e.tipo})`).join('\n');
  const todosStr = eventosDia.map(e=>`${e.hora} — ${e.nome}`).join('\n');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Você é gestor de operações de TV ao vivo. Para o dia ${data}, há eventos sem cobertura. Sugira o MÍNIMO de ajustes de turno para cobrir as lacunas.

EQUIPE ESCALADA (turno base):
${escalaStr}

TODOS OS EVENTOS DO DIA:
${todosStr}

EVENTOS SEM COBERTURA:
${lacunasStr}

Regras:
- Turno tem 9h (1h intervalo = 8h trabalhadas)
- Prefira mudar quem já faz turno mais próximo do horário da lacuna
- Mantenha o mesmo número de horas
- Responda SOMENTE em JSON assim (sem texto extra):
{"ajustes":[{"nome":"Nome Pessoa","entAntes":"HH:MM","saiAntes":"HH:MM","entDepois":"HH:MM","saiDepois":"HH:MM","motivo":"razão curta"}]}`
        }]
      })
    });
    const d = await r.json();
    const txt = d.content?.[0]?.text?.trim()||'{"ajustes":[]}';
    const clean = txt.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    const ajustes = parsed.ajustes||[];

    const escalaAjustada = escalaBase.map(p => {
      const aj = ajustes.find(a=>a.nome===p.nome);
      if(aj) return { ...p, ent: aj.entDepois, sai: aj.saiDepois, ajustado: true, motivo: aj.motivo, entAntes: aj.entAntes, saiAntes: aj.saiAntes };
      return p;
    });

    return { escala: escalaAjustada, ajustes, lacunasResolvidas: ajustes.length };
  } catch {
    return { escala: escalaBase, ajustes: [], lacunasResolvidas: 0 };
  }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [equipeRaw, escalaRaw] = await Promise.all([
    getSheet('Equipe!A2:I50'),
    getSheet('Escala!A2:F500'),
  ]);

  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  const hoje = getBRT();
  const inicio = new Date(hoje); inicio.setDate(hoje.getDate()+1);
  const fim = new Date(hoje); fim.setDate(hoje.getDate()+14);
  const ativos = equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo');

  const h3semanas = new Date(hoje); h3semanas.setDate(hoje.getDate()-21);
  const escalaHist = escalaRaw.filter(r=>r[0]>=fmtData(h3semanas)&&r[0]<=fmtData(hoje)&&r[3]&&r[4]&&r[5]!=='Folga');
  const turnos = {};
  ativos.forEach(p => {
    const regs = escalaHist.filter(r=>r[2]===p[0]);
    if(!regs.length) { turnos[p[0]]=null; return; }
    const freq={};
    regs.forEach(r=>{const k=`${r[3]}|${r[4]}`;freq[k]=(freq[k]||0)+1;});
    const [ent,sai] = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0].split('|');
    turnos[p[0]] = { ent, sai };
  });

  if (req.method === 'POST') {
    try {
      const body = req.body||{};
      const linhasNovas = [];
      for(let i=1;i<=14;i++){
        const d=new Date(hoje); d.setDate(hoje.getDate()+i);
        const df=fmtData(d);
        ativos.forEach(p=>{
          const t=turnos[p[0]];
          if(!t) return;
          const key = `${df}|${p[0]}`;
          const aj = body.ajustes?.[key];
          linhasNovas.push([df,'',p[0], aj?aj.ent:t.ent, aj?aj.sai:t.sai, aj?'Ajustado IA':'']);
        });
      }
      const passado = escalaRaw.filter(r=>r[0]<=fmtData(hoje));
      await setSheet('Escala!A2:F'+(passado.length+linhasNovas.length+2), [...passado, ...linhasNovas]);
      return res.status(200).json({ok:true, gravadas:linhasNovas.length});
    } catch(e) {
      return res.status(500).json({error:e.message});
    }
  }

  const eventos = await getEventosPeriodo(fmtAirtable(inicio), fmtAirtable(fim));

  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const diasProcessados = [];
  let totalLacunas = 0, totalAjustes = 0;

  for(let i=1;i<=14;i++){
    const d = new Date(hoje); d.setDate(hoje.getDate()+i);
    const df = fmtData(d);
    const dataAT = fmtAirtable(d);
    const evsDia = eventos.filter(e=>e.data===dataAT);
    const isFds = d.getDay()===0||d.getDay()===6;

    const escalaBase = ativos
      .filter(p=>turnos[p[0]])
      .map(p=>({nome:p[0], ent:turnos[p[0]].ent, sai:turnos[p[0]].sai}));

    const lacunasAntes = evsDia.filter(ev=>ev.hora&&!escalaBase.some(p=>estaDeServico(p.ent,p.sai,ev.hora)));
    totalLacunas += lacunasAntes.length;

    let resultado = { escala: escalaBase, ajustes: [], lacunasResolvidas: 0 };
    if(lacunasAntes.length > 0) {
      resultado = await ajustarDia(df, evsDia, escalaBase);
      totalAjustes += resultado.ajustes.length;
    }

    diasProcessados.push({
      d, df, dataAT, evsDia, isFds,
      diaSem: DIAS_PT[d.getDay()],
      escala: resultado.escala,
      ajustes: resultado.ajustes,
      lacunasAntes: lacunasAntes.length,
      lacunasResolvidas: resultado.lacunasResolvidas,
    });
  }

  const ajustesJSON = {};
  diasProcessados.forEach(dia => {
    dia.escala.forEach(p => {
      if(p.ajustado) ajustesJSON[`${dia.df}|${p.nome}`] = {ent:p.ent, sai:p.sai};
    });
  });

  const cabecalho = ativos.filter(p=>turnos[p[0]]).map(p=>{
    const t=turnos[p[0]];
    return `<th style="padding:6px 8px;font-size:9px;font-weight:600;color:#a0aec0;text-transform:uppercase;white-space:nowrap;background:#1e2230;border-bottom:1px solid #2d3748;min-width:90px">${p[0].split(' ')[0]}<br><span style="color:#7dd3fc;font-weight:700;font-size:8px">${t.ent}–${t.sai}</span></th>`;
  }).join('');

  const linhasTabela = diasProcessados.map(dia => {
    const pessoasHtml = ativos.filter(p=>turnos[p[0]]).map(p=>{
      const esc = dia.escala.find(e=>e.nome===p[0]);
      if(!esc) return `<td style="padding:4px 6px;text-align:center;font-size:10px;color:#4a5568">—</td>`;
      const ajustado = esc.ajustado;
      return `<td style="padding:4px 6px;text-align:center;font-size:10px;font-weight:600;white-space:nowrap;${ajustado?'background:#1f1a0d;':''}">
        ${ajustado?`<div style="font-size:9px;color:#718096;text-decoration:line-through">${esc.entAntes}–${esc.saiAntes}</div>`:''}
        <div style="color:${ajustado?'#f6ad55':'#7dd3fc'}">${esc.ent}–${esc.sai}</div>
        ${ajustado?`<div style="font-size:8px;color:#f6ad55">✱ ajustado</div>`:''}
      </td>`;
    }).join('');

    const lacunasRestantes = dia.lacunasAntes - dia.lacunasResolvidas;
    return `<tr style="background:${dia.isFds?'#1a1f2e':''}">
      <td style="padding:6px 10px;border-bottom:1px solid #2d3748;white-space:nowrap">
        <div style="font-size:11px;font-weight:700;color:${dia.isFds?'#f6ad55':'#e2e8f0'}">${dia.diaSem} ${dia.df}</div>
        <div style="font-size:9px;color:#718096;margin-top:1px">${dia.evsDia.length} eventos${dia.evsDia[0]?' · '+dia.evsDia[0].hora:''}</div>
        ${dia.ajustes.length>0?`<div style="font-size:9px;color:#f6ad55;margin-top:1px">✱ ${dia.ajustes.length} ajuste${dia.ajustes.length>1?'s':''}</div>`:''}
        ${lacunasRestantes>0?`<div style="font-size:9px;color:#fc8181;margin-top:1px">⚠ ${lacunasRestantes} sem cobertura</div>`:''}
      </td>
      ${pessoasHtml}
    </tr>`;
  }).join('');

  const ajustesResumoHtml = diasProcessados.filter(d=>d.ajustes.length>0).map(dia=>
    dia.ajustes.map(aj=>`
      <div style="padding:6px 0;border-bottom:1px solid #2d3748;display:flex;gap:10px;align-items:flex-start">
        <div style="min-width:60px;font-size:10px;font-weight:600;color:#a0aec0">${dia.df}</div>
        <div>
          <div style="font-size:11px;color:#e2e8f0"><span style="color:#f6ad55;font-weight:600">${aj.nome}</span> · <span style="text-decoration:line-through;color:#718096">${aj.entAntes}–${aj.saiAntes}</span> → <span style="color:#f6ad55;font-weight:700">${aj.entDepois}–${aj.saiDepois}</span></div>
          <div style="font-size:10px;color:#718096;margin-top:2px">${aj.motivo}</div>
        </div>
      </div>`).join('')
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Gerar Escala IA</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1c1f26;color:#e2e8f0}</style>
</head><body>
<div style="background:#161920;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100;border-bottom:1px solid #2d3748">
  <a href="/api/app" style="width:28px;height:28px;background:#2d3748;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-size:12px;font-weight:700;text-decoration:none">P</a>
  <div>
    <div style="font-size:14px;font-weight:600;color:#fff">Pulse — Escala IA ✨</div>
    <div style="font-size:11px;color:#718096">${fmtData(inicio)} a ${fmtData(fim)} · ${totalAjustes} ajustes automáticos · ${totalLacunas - totalAjustes > 0 ? (totalLacunas - totalAjustes)+' lacunas restantes' : 'cobertura completa ✓'}</div>
  </div>
  <div style="margin-left:auto"><a href="/api/app" style="background:none;border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;text-decoration:none">← Home</a></div>
</div>
<div style="max-width:1400px;margin:0 auto;padding:16px 20px">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
    <div style="background:#242836;border:1px solid #2d3748;border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:#718096;font-weight:600;text-transform:uppercase;margin-bottom:4px">Dias gerados</div><div style="font-size:24px;font-weight:700">14</div><div style="font-size:10px;color:#4a5568;margin-top:2px">${fmtData(inicio)} → ${fmtData(fim)}</div></div>
    <div style="background:#242836;border:1px solid #2d3748;border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:#718096;font-weight:600;text-transform:uppercase;margin-bottom:4px">Colaboradores</div><div style="font-size:24px;font-weight:700">${ativos.filter(p=>turnos[p[0]]).length}</div><div style="font-size:10px;color:#4a5568;margin-top:2px">com turno identificado</div></div>
    <div style="background:${totalAjustes>0?'#1f1a0d':'#242836'};border:1px solid ${totalAjustes>0?'#3d3010':'#2d3748'};border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:#718096;font-weight:600;text-transform:uppercase;margin-bottom:4px">Ajustes IA</div><div style="font-size:24px;font-weight:700;color:${totalAjustes>0?'#f6ad55':'#e2e8f0'}">${totalAjustes}</div><div style="font-size:10px;color:#4a5568;margin-top:2px">turnos ajustados</div></div>
    <div style="background:${totalLacunas-totalAjustes>0?'#1f1010':'#0d2010'};border:1px solid ${totalLacunas-totalAjustes>0?'#3d2020':'#0d2010'};border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:#718096;font-weight:600;text-transform:uppercase;margin-bottom:4px">Lacunas restantes</div><div style="font-size:24px;font-weight:700;color:${totalLacunas-totalAjustes>0?'#fc8181':'#68d391'}">${totalLacunas-totalAjustes}</div><div style="font-size:10px;color:#4a5568;margin-top:2px">${totalLacunas-totalAjustes>0?'sem cobertura':'cobertura completa'}</div></div>
  </div>
  ${ajustesResumoHtml?`<div style="background:#242836;border:1px solid #2d3748;border-radius:10px;padding:16px;margin-bottom:16px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#718096;margin-bottom:10px">✱ Ajustes realizados pela IA</div>${ajustesResumoHtml}</div>`:''}
  <div style="background:#242836;border:1px solid #2d3748;border-radius:10px;overflow:hidden;margin-bottom:16px">
    <div style="padding:10px 16px;border-bottom:1px solid #2d3748;display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#a0aec0">Proposta de escala</span>
      <span style="background:#1a2744;color:#63b3ed;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600">${ativos.filter(p=>turnos[p[0]]).length * 14} linhas</span>
      ${totalAjustes>0?`<span style="background:#2d1f00;color:#f6ad55;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600">✱ amarelo = ajustado</span>`:''}
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="padding:6px 10px;text-align:left;font-size:9px;font-weight:600;color:#718096;text-transform:uppercase;background:#1e2230;border-bottom:1px solid #2d3748;min-width:110px">Dia</th>${cabecalho}</tr></thead>
        <tbody>${linhasTabela}</tbody>
      </table>
    </div>
  </div>
  <div style="background:#242836;border:1px solid #2d3748;border-radius:10px;padding:16px;display:flex;align-items:center;gap:16px">
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600">Confirmar e gravar na planilha</div>
      <div style="font-size:11px;color:#718096;margin-top:2px">Grava ${ativos.filter(p=>turnos[p[0]]).length*14} linhas na aba Escala · ${totalAjustes} com turno ajustado pela IA</div>
    </div>
    <button onclick="confirmar()" id="btn" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;cursor:pointer">Gravar escala ✓</button>
  </div>
</div>
<script>
var AJUSTES = ${JSON.stringify(ajustesJSON)};
async function confirmar(){
  var btn=document.getElementById('btn');
  btn.textContent='Gravando...';btn.disabled=true;btn.style.background='#374151';
  try{
    var r=await fetch('/api/gerar-escala',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ajustes:AJUSTES})});
    var d=await r.json();
    if(d.ok){btn.textContent='✓ Gravado!';btn.style.background='#166534';setTimeout(()=>window.location='/api/escalas?v=semana&offset=1',1500);}
    else{btn.textContent='Gravar escala ✓';btn.disabled=false;btn.style.background='#1d4ed8';alert('Erro: '+d.error);}
  }catch(e){btn.textContent='Gravar escala ✓';btn.disabled=false;btn.style.background='#1d4ed8';alert('Erro de conexão');}
}
</script>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
