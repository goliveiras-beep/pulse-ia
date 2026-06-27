// api/dashboard.js — Visão do Gestor
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const AIRTABLE_BASE = 'appwE9LmmTxynTGFY';
const AIRTABLE_TABLE = 'tblpibvwAIGBQXr0H';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset())*60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }

function estaDeServico(ent, sai, horaEv) {
  if(!ent||!sai||!horaEv) return false;
  const i=toMin(ent), f=toMin(sai), e=toMin(horaEv);
  return f>i ? e>=i&&e<=f : e>=i||e<=f;
}
function statusTurno(ent, sai, horaEv) {
  if(!ent||!sai||!horaEv) return null;
  const ev=toMin(horaEv), i=toMin(ent), f=toMin(sai);
  if(Math.abs(i-ev)<=60) return 'entrando';
  if(Math.abs(f-ev)<=60) return 'saindo';
  return null;
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
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
      nucleo:Array.isArray(r.fields['Núcleo'])?r.fields['Núcleo'].join(', '):(r.fields['Núcleo']||''),
    })).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  } catch { return []; }
}

// Salva ajuste na aba Ajustes do Sheets
async function salvarAjuste(ajuste) {
  const agora=getBRT();
  const ts=agora.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const row=[ts, ajuste.data, ajuste.colaborador, ajuste.acao, ajuste.entrada||'', ajuste.saida||'', ajuste.obs||''];
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,
    `/values/Ajustes!A1:append?valueInputOption=USER_ENTERED`,'POST',{values:[row]});
}

// Atualiza linha na aba Escala
async function atualizarEscala(data, colaborador, entrada, saida, obs) {
  const escala=await getSheet('Escala!A2:F500');
  const idx=escala.findIndex(r=>r[0]===data&&r[2]===colaborador);
  if(idx>=0) {
    const row=idx+2;
    await sheetsRequest(process.env.GOOGLE_SHEET_ID,
      `/values/Escala!D${row}:F${row}?valueInputOption=USER_ENTERED`,'PUT',
      {values:[[entrada||'',saida||'',obs||'']]});
  } else {
    await sheetsRequest(process.env.GOOGLE_SHEET_ID,
      `/values/Escala!A1:append?valueInputOption=USER_ENTERED`,'POST',
      {values:[[data,'',colaborador,entrada||'',saida||'',obs||'']]});
  }
}

export default async function handler(req, res) {
  // Processar ajustes via POST
  if(req.method==='POST') {
    try {
      const {acao,data,colaborador,entrada,saida,obs}=req.body;
      await atualizarEscala(data,colaborador,entrada,saida,acao==='folga'?'Folga':obs||'');
      await salvarAjuste({data,colaborador,acao,entrada,saida,obs});
      return res.status(200).json({ok:true});
    } catch(e) {
      return res.status(500).json({error:e.message});
    }
  }

  const hoje=getBRT();
  const d1=new Date(hoje); d1.setDate(hoje.getDate()+1);
  const hojeStr=fmtData(hoje), d1Str=fmtData(d1);
  const DIAS_PT=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIAS_FULL=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  const dow=hoje.getDay();
  const seg=new Date(hoje); seg.setDate(hoje.getDate()-dow+1);
  const dias=Array.from({length:7},(_,i)=>{const d=new Date(seg);d.setDate(seg.getDate()+i);return d;});
  const segStr=fmtData(dias[0]), domStr=fmtData(dias[6]);

  const [escalaRaw,ausenciasRaw,equipeRaw,eventosD1]=await Promise.all([
    getSheet('Escala!A2:F500'),
    getSheet('Ausências!A2:I500'),
    getSheet('Equipe!A2:G50'),
    getEventos(fmtAirtable(d1)),
  ]);

  const escala=escalaRaw.filter(r=>r[0]>=segStr&&r[0]<=domStr);
  const ausencias=ausenciasRaw.filter(r=>r[4]>=segStr&&r[4]<=domStr);
  const equipe=equipeRaw;
  const nomes=equipe.length>0?equipe.map(r=>r[0]):[...new Set(escalaRaw.map(r=>r[2]))];
  const escalaD1=escala.filter(r=>r[0]===d1Str);

  const eventosCruzados=eventosD1.map(ev=>{
    const disponiveis=[],atencao=[],ausentes=[];
    escalaD1.forEach(r=>{
      const [,, nome,,, obs]=r, entrada=r[3], saida=r[4];
      const ausente=ausencias.find(a=>a[1]===nome&&(a[4]===d1Str||a[5]===d1Str));
      if(ausente||obs==='Folga'||obs==='Folga/Ausente'||(!entrada&&!saida)){
        ausentes.push({nome,motivo:ausente?ausente[3]:'Folga'}); return;
      }
      if(estaDeServico(entrada,saida,ev.hora)){
        const st=statusTurno(entrada,saida,ev.hora);
        st?atencao.push({nome,entrada,saida,status:st}):disponiveis.push({nome,entrada,saida});
      }
    });
    return{...ev,disponiveis,atencao,ausentes,semCobertura:disponiveis.length===0&&atencao.length===0};
  });

  const semCobertura=eventosCruzados.filter(e=>e.semCobertura).length;
  const comAtencao=eventosCruzados.filter(e=>e.atencao.length>0).length;
  const trabalhando=escalaD1.filter(r=>r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Folga/Ausente').length;
  const folgasD1=escalaD1.filter(r=>!r[3]||r[5]==='Folga'||r[5]==='Folga/Ausente').length;
  const cobertura=equipe.length>0?Math.round(trabalhando/equipe.length*100):0;
  const atualizado=hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

  function av(nome,bg='#dbeafe',c='#1d4ed8'){
    return `<div style="width:26px;height:26px;border-radius:50%;background:${bg};color:${c};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>`;
  }

  const eventosHTML=eventosCruzados.length===0
    ?`<div style="padding:20px;text-align:center;color:#aaa;font-size:13px">Nenhum evento para ${d1Str}</div>`
    :eventosCruzados.map(ev=>{
      const [bc,bb,ic,itxt]=ev.semCobertura?['#fef2f2','#fca5a5','⚠️','#991b1b']:
        ev.atencao.length?['#fffbeb','#fcd34d','⚡','#92400e']:['#f0fdf4','#86efac','✓','#166534'];
      return `<div style="border:1px solid ${bb};border-radius:8px;margin-bottom:10px;overflow:hidden">
        <div style="background:${bc};padding:8px 12px;display:flex;align-items:center;gap:10px">
          <div style="font-size:13px;font-weight:700;color:#1d4ed8;min-width:52px">${ev.hora||'—'}</div>
          <div style="flex:1"><div style="font-size:12px;font-weight:700">${ev.nome}</div><div style="font-size:10px;color:#888">${ev.tipo}${ev.nucleo?' · '+ev.nucleo:''}</div></div>
          <div style="font-size:11px;font-weight:700;color:${itxt}">${ic} ${ev.semCobertura?'Sem cobertura':ev.atencao.length?'Troca de turno':'OK'}</div>
        </div>
        <div style="padding:8px 12px">
          ${ev.disponiveis.map(p=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f5f5f5">${av(p.nome)}<span style="flex:1;font-size:11px;font-weight:600">${p.nome}</span><span style="font-size:11px;color:#1d4ed8;font-weight:600">${p.entrada}→${p.saida}</span></div>`).join('')}
          ${ev.atencao.map(p=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #fef9c3">${av(p.nome,'#fef3c7','#92400e')}<span style="flex:1;font-size:11px;font-weight:600">${p.nome}</span><span style="font-size:11px;color:#555">${p.entrada}→${p.saida}</span><span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700">${p.status}</span></div>`).join('')}
          ${ev.semCobertura?`<div style="text-align:center;padding:6px;color:#991b1b;font-size:11px;font-weight:600">Nenhum colaborador neste horário</div>`:''}
          ${ev.ausentes.length?`<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">${ev.ausentes.map(p=>`<span style="background:#f3f4f6;color:#9ca3af;border-radius:3px;padding:1px 6px;font-size:10px">${p.nome.split(' ')[0]}</span>`).join('')}</div>`:''}
        </div>
      </div>`;
    }).join('');

  let tabelaHTML='';
  nomes.forEach(nome=>{
    const cargo=equipe.find(r=>r[0]===nome)?.[1]||'';
    tabelaHTML+=`<tr><td style="padding:6px 10px;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;align-items:center;gap:7px">${av(nome)}<div><div style="font-size:11px;font-weight:600;white-space:nowrap">${nome}</div>${cargo?`<div style="font-size:10px;color:#aaa">${cargo}</div>`:''}</div></div></td>`;
    dias.forEach(d=>{
      const df=fmtData(d), isD1=df===d1Str, isHoje=df===hojeStr;
      const reg=escala.find(r=>r[0]===df&&r[2]===nome);
      const ausente=ausencias.find(a=>a[1]===nome&&(a[4]===df||a[5]===df));
      const bg=isD1?'#eff6ff':isHoje?'#fafafa':'';
      tabelaHTML+=`<td style="padding:5px 8px;border-bottom:1px solid #f5f5f5;text-align:center;background:${bg};cursor:pointer" onclick="abrirAjuste('${df}','${nome}','${reg?reg[3]:''}','${reg?reg[4]:''}','${reg?reg[5]:''}')">`;
      if(ausente) tabelaHTML+=`<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">${ausente[3]||'Aus.'}</span>`;
      else if(reg){
        const{3:ent,4:sai,5:obs}=reg;
        if(obs==='Folga') tabelaHTML+=`<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Folga</span>`;
        else if(!ent&&!sai) tabelaHTML+=`<span style="color:#d1d5db;font-size:11px">—</span>`;
        else tabelaHTML+=`<span style="font-size:11px;color:${isD1?'#1d4ed8':'#333'};font-weight:${isD1?700:500}">${ent}→${sai}</span>`;
      } else tabelaHTML+=`<span style="color:#e5e7eb;font-size:11px">+</span>`;
      tabelaHTML+=`</td>`;
    });
    tabelaHTML+=`</tr>`;
  });

  // Links da equipe
  const linksHTML=nomes.map(nome=>{
    const slug=nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-');
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5">
      ${av(nome)}
      <span style="flex:1;font-size:12px;font-weight:600">${nome}</span>
      <a href="/api/meu-turno?nome=${slug}" target="_blank" style="font-size:11px;color:#1d4ed8;text-decoration:none;border:1px solid #dbeafe;border-radius:4px;padding:2px 8px">Ver turno</a>
    </div>`;
  }).join('');

  const html=`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Gestor</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a;font-size:14px}
.header{background:#fff;border-bottom:1px solid #e5e5e5;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:30px;height:30px;background:#1a1a1a;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700}
.ht{font-size:14px;font-weight:600}
.hs{font-size:11px;color:#888}
.hr{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn{background:none;border:1px solid #e5e5e5;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;color:#555}
.btn:hover{background:#f0f0f0}
.wrap{max-width:1200px;margin:0 auto;padding:16px 20px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.metric{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px}
.ml{font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.mv{font-size:26px;font-weight:700;line-height:1}
.ms{font-size:10px;color:#aaa;margin-top:3px}
.blue{border-color:#dbeafe;background:#eff6ff}.blue .mv{color:#1d4ed8}
.red{border-color:#fca5a5;background:#fef2f2}.red .mv{color:#dc2626}
.amber{border-color:#fcd34d;background:#fffbeb}.amber .mv{color:#d97706}
.layout{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden}
.card-header{padding:10px 14px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px}
.card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#555}
.badge{border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600}
.badge.blue{background:#dbeafe;color:#1d4ed8}
.badge.red{background:#fee2e2;color:#991b1b}
.badge.amber{background:#fef3c7;color:#92400e}
.badge.green{background:#dcfce7;color:#166534}
.card-body{padding:10px 14px}
.full{grid-column:1/-1}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:650px}
th{padding:6px 8px;text-align:center;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;border-bottom:1px solid #f0f0f0;background:#fafafa;white-space:nowrap}
th.tnome{text-align:left;width:150px}
th.thoje{color:#555;background:#f5f5f5}
th.td1{background:#eff6ff;color:#1d4ed8;border-bottom:2px solid #3b82f6}
td{padding:5px 8px;border-bottom:1px solid #f5f5f5;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafafa!important}
.legenda{display:flex;gap:12px;padding:8px 14px;border-top:1px solid #f0f0f0;flex-wrap:wrap}
.leg{display:flex;align-items:center;gap:4px;font-size:10px;color:#888}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:#fff;border-radius:10px;padding:20px;width:340px;max-width:90vw}
.modal h3{font-size:14px;font-weight:600;margin-bottom:14px}
.field{margin-bottom:10px}
.field label{display:block;font-size:11px;color:#555;font-weight:600;margin-bottom:3px}
.field input,.field select{width:100%;border:1px solid #e5e5e5;border-radius:6px;padding:6px 10px;font-size:13px;outline:none}
.field input:focus,.field select:focus{border-color:#3b82f6}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.btn-primary{background:#1d4ed8;color:#fff;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;font-weight:600}
.btn-primary:hover{background:#1e40af}
.btn-danger{background:#dc2626;color:#fff;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;font-weight:600}
.toast{position:fixed;bottom:20px;right:20px;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;z-index:300;display:none}
@media(max-width:768px){.metrics{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.wrap{padding:10px}}
</style>
</head><body>

<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse — Visão do gestor</div><div class="hs">Semana ${segStr}–${domStr} · D+1: ${DIAS_FULL[d1.getDay()]} ${d1Str}</div></div>
  <div class="hr"><span style="font-size:11px;color:#aaa">${atualizado}</span><button class="btn" onclick="location.reload()">↻ Atualizar</button></div>
</div>

<div class="wrap">
  <div class="metrics">
    <div class="metric blue"><div class="ml">Trabalhando D+1</div><div class="mv">${trabalhando}</div><div class="ms">${cobertura}% de cobertura · ${equipe.length} na equipe</div></div>
    <div class="metric ${folgasD1>2?'amber':''}"><div class="ml">Folgas D+1</div><div class="mv">${folgasD1}</div><div class="ms">${ausenciasRaw.filter(a=>a[4]===d1Str).length} via Pulse</div></div>
    <div class="metric ${semCobertura>0?'red':''}"><div class="ml">Sem cobertura</div><div class="mv">${semCobertura}</div><div class="ms">de ${eventosD1.length} eventos D+1</div></div>
    <div class="metric ${comAtencao>0?'amber':''}"><div class="ml">Trocas de turno</div><div class="mv">${comAtencao}</div><div class="ms">eventos com entrada/saída</div></div>
  </div>

  <div class="layout">
    <div class="card">
      <div class="card-header"><span class="card-title">Eventos D+1 × escala</span><span class="badge ${semCobertura>0?'red':comAtencao>0?'amber':'green'}">${eventosD1.length} eventos</span></div>
      <div class="card-body" style="max-height:520px;overflow-y:auto">${eventosHTML}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card" style="flex:1">
        <div class="card-header"><span class="card-title">Plantão D+1</span><span class="badge blue">${trabalhando} ativos</span></div>
        <div class="card-body" style="max-height:260px;overflow-y:auto">
          ${escalaD1.filter(r=>r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Folga/Ausente').sort((a,b)=>a[3].localeCompare(b[3])).map(r=>`
          <div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid #f5f5f5">${av(r[2])}<span style="flex:1;font-size:11px;font-weight:600">${r[2]}</span><span style="font-size:11px;color:#1d4ed8;font-weight:700">${r[3]}→${r[4]}</span></div>`).join('')}
          ${escalaD1.filter(r=>!r[3]||r[5]==='Folga'||r[5]==='Folga/Ausente').map(r=>`
          <div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid #f5f5f5;opacity:.4">${av(r[2],'#f3f4f6','#9ca3af')}<span style="flex:1;font-size:11px;font-weight:600;color:#9ca3af">${r[2]}</span><span style="background:#f3f4f6;color:#9ca3af;border-radius:3px;padding:1px 5px;font-size:10px">${r[5]||'—'}</span></div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Links da equipe</span><span class="badge blue">${nomes.length}</span></div>
        <div class="card-body" style="max-height:220px;overflow-y:auto">${linksHTML}</div>
      </div>
    </div>

    <div class="card full">
      <div class="card-header"><span class="card-title">Escala semanal — clique para ajustar</span><span class="badge blue">${nomes.length} colaboradores</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th class="tnome">Colaborador</th>${dias.map(d=>{const df=fmtData(d),isD1=df===d1Str,isHoje=df===hojeStr;return`<th class="${isD1?'td1':isHoje?'thoje':''}">${DIAS_PT[d.getDay()]}<br><span style="font-weight:400">${df}</span>${isD1?'<br><span style="font-size:8px;color:#3b82f6">D+1</span>':''}${isHoje?'<br><span style="font-size:8px;color:#888">hoje</span>':''}</th>`;}).join('')}</tr></thead>
        <tbody>${tabelaHTML}</tbody>
      </table></div>
      <div class="legenda">
        <div class="leg"><span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Folga</span>folga</div>
        <div class="leg"><span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Aus.</span>ausência via Pulse</div>
        <div class="leg" style="color:#aaa">Clique em qualquer célula para editar</div>
      </div>
    </div>
  </div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h3 id="modal-titulo">Ajustar escala</h3>
    <input type="hidden" id="aj-data"><input type="hidden" id="aj-nome">
    <div class="field"><label>Colaborador</label><input id="aj-colab" readonly style="background:#f9f9f9;color:#888"></div>
    <div class="field"><label>Data</label><input id="aj-data-show" readonly style="background:#f9f9f9;color:#888"></div>
    <div class="field"><label>Ação</label>
      <select id="aj-acao" onchange="toggleAcao()">
        <option value="horario">Alterar horário</option>
        <option value="folga">Colocar folga</option>
        <option value="remover">Remover da escala</option>
      </select>
    </div>
    <div id="aj-horarios">
      <div class="field"><label>Entrada</label><input type="time" id="aj-entrada"></div>
      <div class="field"><label>Saída</label><input type="time" id="aj-saida"></div>
    </div>
    <div class="field"><label>Observação</label><input type="text" id="aj-obs" placeholder="opcional"></div>
    <div class="modal-btns">
      <button class="btn" onclick="fecharModal()">Cancelar</button>
      <button class="btn-primary" onclick="salvarAjuste()">Salvar</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function abrirAjuste(data,nome,entrada,saida,obs){
  document.getElementById('aj-data').value=data;
  document.getElementById('aj-nome').value=nome;
  document.getElementById('aj-colab').value=nome;
  document.getElementById('aj-data-show').value=data;
  document.getElementById('aj-entrada').value=entrada||'';
  document.getElementById('aj-saida').value=saida||'';
  document.getElementById('aj-obs').value=obs||'';
  document.getElementById('aj-acao').value='horario';
  toggleAcao();
  document.getElementById('modal').classList.add('open');
}
function fecharModal(){ document.getElementById('modal').classList.remove('open'); }
function toggleAcao(){
  const acao=document.getElementById('aj-acao').value;
  document.getElementById('aj-horarios').style.display=acao==='horario'?'block':'none';
}
async function salvarAjuste(){
  const data=document.getElementById('aj-data').value;
  const colaborador=document.getElementById('aj-nome').value;
  const acao=document.getElementById('aj-acao').value;
  const entrada=document.getElementById('aj-entrada').value;
  const saida=document.getElementById('aj-saida').value;
  const obs=document.getElementById('aj-obs').value;
  try{
    const r=await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({acao,data,colaborador,entrada,saida,obs})});
    const d=await r.json();
    if(d.ok){ fecharModal(); mostrarToast('Escala atualizada!'); setTimeout(()=>location.reload(),1200); }
    else mostrarToast('Erro: '+d.error,'#dc2626');
  }catch(e){ mostrarToast('Erro: '+e.message,'#dc2626'); }
}
function mostrarToast(msg,bg='#1a1a1a'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.background=bg; t.style.display='block';
  setTimeout(()=>t.style.display='none',2500);
}
document.getElementById('modal').addEventListener('click',e=>{ if(e.target===e.currentTarget)fecharModal(); });
</script>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
