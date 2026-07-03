// api/ausencias.js — Central de ausências com timeline visual
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { solicitarBtn } from '../lib/solicitar-widget.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function hash(s){return createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32);}
function getSession(req){
  const cookies={};
  (req.headers.cookie||'').split(';').forEach(c=>{const p=c.trim().split('=');cookies[p.shift()]=p.join('=');});
  const t=cookies[COOKIE_NAME];if(!t)return null;
  try{
    const d=Buffer.from(t,'base64').toString('utf8');
    const last=d.lastIndexOf('|'),sec=d.lastIndexOf('|',last-1);
    const data=d.slice(0,sec),h=d.slice(sec+1,last),ts=d.slice(last+1);
    if(Date.now()-parseInt(ts,10)>7*24*3600*1000)return null;
    if(h!==hash(data+ts)||data.startsWith('~~OAUTH~~'))return null;
    return {nome:data.split('~~')[0]};
  }catch{return null;}
}
async function getSheet(range){
  try{const d=await sheetsRequest(SHEET_ID,`/values/${encodeURIComponent(range)}`);return d.values||[];}
  catch{return [];}
}
function fmtData(d){return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');}
function getBRT(){return new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}));}
function normDf(raw){
  if(!raw)return '';const s=String(raw).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){const p=s.split('-');return p[2].slice(0,2).padStart(2,'0')+'/'+p[1].padStart(2,'0');}
  if(/^\d{1,2}\/\d{1,2}/.test(s)){const p=s.split('/');return p[0].padStart(2,'0')+'/'+p[1].padStart(2,'0');}
  return s;
}
function dfParaDate(df,ano){const[d,m]=df.split('/').map(Number);return new Date(ano,m-1,d);}
function dentroAus(ini,fim,df,ano){
  try{const dtDf=dfParaDate(df,ano),dtIni=dfParaDate(ini,ano),dtFim=dfParaDate(fim||ini,ano);return dtDf>=dtIni&&dtDf<=dtFim;}catch{return false;}
}

export default async function handler(req,res){
  const session=getSession(req);
  if(!session)return res.redirect(302,'/api/app');

  const [equipeRaw,ausRaw]=await Promise.all([
    getSheet('Equipe!A2:I200'),
    getSheet('Ausências!A2:F500'),
  ]);

  const usuario=equipeRaw.find(r=>r[0]===session.nome);
  if(usuario?.[8]!=='gestor')return res.redirect(302,'/api/app');

  const hoje=getBRT();
  const hojeStr=fmtData(hoje);
  const ano=hoje.getFullYear();

  // Processar ausências
  const ausencias=ausRaw.filter(r=>r[0]&&r[1]).map(r=>({
    id:r[0]||'',nome:r[1]||'',tipo:r[2]||'',motivo:r[3]||'',
    ini:normDf(r[4]||''),fim:normDf(r[5]||r[4]||''),
    status: r[0].startsWith('APROVADO')?'aprovado':r[0]==='RECUSADO'?'recusado':r[0]==='CANCELADO'?'cancelado':'pendente'
  }));

  const porData=lista=>[...lista].sort((a,b)=>dfParaDate(a.ini,ano)-dfParaDate(b.ini,ano));

  const pendentes=porData(ausencias.filter(a=>a.status==='pendente'));
  const aprovadas=porData(ausencias.filter(a=>a.status==='aprovado'));
  const historico=porData(ausencias.filter(a=>a.status==='recusado'||a.status==='cancelado'));

  // Quem está ausente hoje e amanhã
  const d1=new Date(hoje);d1.setDate(hoje.getDate()+1);const d1Str=fmtData(d1);
  const ausentesHoje=aprovadas.filter(a=>dentroAus(a.ini,a.fim,hojeStr,ano));
  const ausentesAmanha=aprovadas.filter(a=>dentroAus(a.ini,a.fim,d1Str,ano));
  const proximosSete=aprovadas.filter(a=>{
    for(let i=0;i<=7;i++){const d=new Date(hoje);d.setDate(hoje.getDate()+i);if(dentroAus(a.ini,a.fim,fmtData(d),ano))return true;}return false;
  });

  // Timeline: período completo (proporcional às datas reais, sem grade de dias pra rolar)
  const colaboradores=[...new Set(aprovadas.map(a=>a.nome))];
  const TIPO_COR={'Férias':['#1c3a0a','#4ade80','🏖️'],'Folga programada':['#0a1c3a','#60a5fa','📅'],'Atestado médico':['#3a0a0a','#f87171','🏥'],'Troca de horário':['#1c1a3a','#c084fc','🔄']};
  const TIPO_COR_LIGHT={'Férias':['#dcfce7','#166534','🏖️'],'Folga programada':['#dbeafe','#1d4ed8','📅'],'Atestado médico':['#fee2e2','#991b1b','🏥'],'Troca de horário':['#f3e8ff','#7c3aed','🔄']};

  function badgeTipo(tipo,dark=true){
    const c=dark?TIPO_COR[tipo]||['#1e2230','#94a3b8','📋']:TIPO_COR_LIGHT[tipo]||['#f3f4f6','#374151','📋'];
    return `<span style="background:${c[0]};color:${c[1]};border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700">${c[2]} ${tipo}</span>`;
  }

  // Timeline HTML
  const MESES_ABR=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIAS_ABR=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIA_MS=86400000;
  const addDias=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};

  let timelineHtml;
  if(colaboradores.length===0){
    timelineHtml=`<div style="padding:32px;text-align:center;color:#718096;font-size:13px">Nenhuma ausência aprovada</div>`;
  } else {
    const comDatas=aprovadas.map(a=>({...a,iniD:dfParaDate(a.ini,ano),fimD:dfParaDate(a.fim||a.ini,ano)}));
    const rangeInicio=new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate());
    const fimMaisLonge=comDatas.reduce((max,a)=>a.fimD>max?a.fimD:max,addDias(rangeInicio,7));
    const rangeFim=addDias(fimMaisLonge,2);
    const totalMs=Math.max(rangeFim-rangeInicio,DIA_MS);
    const pct=d=>Math.min(100,Math.max(0,(d-rangeInicio)/totalMs*100));

    const marcadores=[];
    let cursor=new Date(rangeInicio);
    while(cursor<=rangeFim){
      marcadores.push({label:MESES_ABR[cursor.getMonth()].toUpperCase(),pct:pct(cursor)});
      cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);
    }

    // Mapa dia -> nomes ausentes, pra achar interseção entre colaboradores
    const diaParaNomes=new Map();
    comDatas.forEach(a=>{
      for(let t=a.iniD.getTime();t<=a.fimD.getTime();t+=DIA_MS){
        const key=Math.round(t/DIA_MS);
        if(!diaParaNomes.has(key))diaParaNomes.set(key,new Set());
        diaParaNomes.get(key).add(a.nome);
      }
    });
    const diasComOverlap=[...diaParaNomes.keys()].filter(k=>diaParaNomes.get(k).size>=2).sort((x,y)=>x-y);
    const blocos=[];
    diasComOverlap.forEach(k=>{
      const ultimo=blocos[blocos.length-1];
      if(ultimo&&k===ultimo.fimKey+1)ultimo.fimKey=k;
      else blocos.push({iniKey:k,fimKey:k});
    });

    const faixasHtml=blocos.map(b=>{
      const iniD=new Date(b.iniKey*DIA_MS);
      const fimD=new Date(b.fimKey*DIA_MS);
      const left=pct(iniD);
      const width=Math.max(pct(addDias(fimD,1))-left,1.2);
      let maxAusentes=0;
      for(let k=b.iniKey;k<=b.fimKey;k++)maxAusentes=Math.max(maxAusentes,diaParaNomes.get(k).size);
      return `<div style="position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:rgba(251,146,60,.14);border-left:1px dashed #fb923c;border-right:1px dashed #fb923c;z-index:0" title="${fmtData(iniD)}→${fmtData(fimD)} · ${maxAusentes} ausentes ao mesmo tempo"></div>
        <div style="position:absolute;left:${left}%;top:-16px;font-size:9px;font-weight:800;color:#fb923c;white-space:nowrap;z-index:2">⚠ ${fmtData(iniD)}→${fmtData(fimD)} · ${maxAusentes} ausentes</div>`;
    }).join('');

    const detalheDiasHtml=blocos.map(b=>{
      const dias=[];
      for(let k=b.iniKey;k<=b.fimKey;k++){
        const d=new Date(k*DIA_MS);
        dias.push(`<div>
          <div style="font-size:11px;font-weight:700;color:#e2e8f0">${DIAS_ABR[d.getDay()]} · ${fmtData(d)}</div>
          <div style="font-size:10px;color:#a0aec0">${[...diaParaNomes.get(k)].join(', ')}</div>
        </div>`);
      }
      return `<div style="background:#161920;border:1px solid #fb923c;border-radius:10px;padding:10px 14px;margin-bottom:10px">
        <div style="font-size:10px;font-weight:800;color:#fb923c;margin-bottom:8px">⚠ Dias com mais de 1 pessoa ausente ao mesmo tempo</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap">${dias.join('')}</div>
      </div>`;
    }).join('');

    const ROW_H=44, TICKS_H=20;
    const linhasHtml=colaboradores.map((nome,i)=>{
      const periodos=comDatas.filter(a=>a.nome===nome);
      return periodos.map(a=>{
        const [bg,c,ic]=TIPO_COR[a.tipo]||['#1e2230','#94a3b8','📋'];
        const left=pct(a.iniD);
        const width=Math.max(pct(addDias(a.fimD,1))-left,3);
        return `<div style="position:absolute;left:${left}%;width:${width}%;top:${i*ROW_H+2}px;height:${ROW_H-8}px;border-radius:6px;background:${bg};border:1px solid ${c};display:flex;align-items:center;justify-content:center;padding:0 4px;overflow:hidden;z-index:1" title="${a.tipo}: ${a.ini} → ${a.fim||a.ini}">
          <span style="font-size:9px;font-weight:800;color:${c};white-space:nowrap">${ic} ${a.ini} → ${a.fim||a.ini}</span>
        </div>`;
      }).join('');
    }).join('');

    const nomesHtml=colaboradores.map(nome=>{
      const periodos=comDatas.filter(a=>a.nome===nome);
      return `<div style="height:${ROW_H}px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2d3748">
        <div style="width:28px;height:28px;border-radius:50%;background:#1a2744;color:#63b3ed;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${nome.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap">${nome.split(' ').slice(0,2).join(' ')}</div>
          <div style="white-space:nowrap">${badgeTipo(periodos[0]?.tipo||'')}</div>
        </div>
      </div>`;
    }).join('');

    const marcadoresHtml=marcadores.map(m=>`<div style="position:absolute;left:${m.pct}%;font-size:10px;color:#4a5568;font-weight:700;white-space:nowrap">${m.label}</div>`).join('');

    timelineHtml=`
    <div id="aus-timeline-scroll" style="overflow-x:auto">
      <div style="display:flex;min-width:600px">
        <div style="width:160px;flex-shrink:0;padding-top:${TICKS_H}px">${nomesHtml}</div>
        <div style="flex:1;position:relative;min-width:0">
          <div style="position:relative;height:${TICKS_H}px">${marcadoresHtml}</div>
          <div style="position:relative;height:${colaboradores.length*ROW_H}px">
            ${faixasHtml}
            ${linhasHtml}
          </div>
        </div>
      </div>
    </div>
    ${detalheDiasHtml}`;
  }

  function renderCards(lista, comAcoes=false){
    if(!lista.length)return `<div style="padding:24px;text-align:center;color:#718096;font-size:13px">Nenhum registro</div>`;
    return lista.map(a=>{
      const [bg,c,ic]=TIPO_COR[a.tipo]||['#1e2230','#94a3b8','📋'];
      const hasAnexo=a.motivo&&a.motivo.includes('Anexo:');
      const anexoUrl=hasAnexo?a.motivo.split('Anexo:')[1].trim():'';
      const motivoTxt=hasAnexo?a.motivo.split('Anexo:')[0].trim():a.motivo;
      const periodo=a.ini+(a.fim&&a.fim!==a.ini?' → '+a.fim:'');
      return `<div class="aus-card" style="background:#1e2230;border:1px solid ${comAcoes?c:'#2d3748'};border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:8px">
        <div style="font-size:22px">${ic}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:13px;font-weight:700;color:#e2e8f0">${a.nome}</span>
            ${badgeTipo(a.tipo)}
          </div>
          <div style="font-size:12px;color:#63b3ed;font-weight:600;margin-bottom:2px">📅 ${periodo}</div>
          ${motivoTxt?`<div style="font-size:11px;color:#a0aec0">${motivoTxt}</div>`:''}
          ${hasAnexo?`<a href="${anexoUrl}" target="_blank" style="font-size:11px;color:#60a5fa">📎 Ver atestado</a>`:''}
          ${comAcoes?`<div style="font-size:10px;color:#4a5568;margin-top:3px">ID: ${a.id}</div>`:''}
        </div>
        <div class="aus-card-acoes" style="flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${comAcoes?`
            <button onclick="aprovar('${a.id}')" style="background:#166534;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:700;color:#86efac;cursor:pointer">✓ Aprovar</button>
            <button onclick="recusar('${a.id}')" style="background:none;border:1px solid #991b1b;border-radius:6px;padding:5px 12px;font-size:12px;color:#fc8181;cursor:pointer">✕ Recusar</button>
          `:`<span style="font-size:10px;color:${a.status==='aprovado'?'#4ade80':a.status==='recusado'?'#fc8181':'#718096'};font-weight:600;text-transform:uppercase">${a.status==='aprovado'?'✓ Aprovado':a.status==='recusado'?'✕ Recusado':'Cancelado'}</span>`}
        </div>
      </div>`;
    }).join('');
  }

  const html=`<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Ausências</title>
<style>
:root{--card:#242836;--header:#161920;--border:#2d3748;--border2:#2d3748;--bg2:#2d3140;--bg3:#2d3140;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1c1f26;color:#e2e8f0;min-height:100vh}
.tab-btn{padding:8px 16px;font-size:13px;font-weight:600;background:none;border:none;color:#718096;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
.tab-btn.ativo{color:#63b3ed;border-bottom-color:#3b82f6}
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:#e2e8f0;text-decoration:none;white-space:nowrap}
.menu-item:hover{background:#2d3140}
@media(max-width:640px){
  #aus-tempo-widget{display:none!important}
  #aus-header{padding:8px 12px!important;gap:8px!important}
  #aus-title{font-size:13px!important}
  #aus-header-right{gap:5px!important}
  #aus-metrics{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
  #aus-tabs{padding:0 8px!important;overflow-x:auto!important}
  .tab-btn{padding:8px 10px!important;font-size:12px!important;white-space:nowrap}
  .aus-card{flex-wrap:wrap!important;gap:10px!important}
  .aus-card-acoes{flex-direction:row!important;align-items:center!important;width:100%;justify-content:flex-end}
}
</style></head>
<body>
<div id="aus-header" style="background:#161920;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;border-bottom:1px solid #2d3748">
  <div style="width:28px;height:28px;border-radius:6px;background:#e53e3e;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0">P</div>
  <div style="min-width:0">
    <div id="aus-title" style="font-size:14px;font-weight:700">Ausências</div>
    <div id="aus-sub" style="font-size:10px;color:#718096">${ausentesHoje.length} hoje · ${pendentes.length} pendente${pendentes.length!==1?'s':''}</div>
  </div>
  <div class="hdr-btns" id="aus-header-right" style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <div id="aus-tempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="aus-tempo-icone">&#9203;</span>
      <span id="aus-tempo-temp" style="font-weight:700">--&deg;C</span>
      <span id="aus-tempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:#718096">BRT</span>
        <span id="aus-relogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <span id="aus-relogio-gmt" style="font-size:10px;font-weight:600;color:#4a5568;font-variant-numeric:tabular-nums"></span>
    </div>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" style="border:1px solid #3d4660;border-radius:6px;padding:4px 10px;font-size:15px;color:#a0aec0;background:none;cursor:pointer;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:#242836;border:1px solid #2d3748;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Inicio</a>
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausencias</a>
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
        <div style="height:1px;background:#2d3748;margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#fc8181">&#128682; Sair</button>
        </form>
      </div>
    </div>
  </div>
</div>

<div style="max-width:1100px;margin:0 auto;padding:20px 16px">

  <!-- Métricas -->
  <div id="aus-metrics" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px">
    <div style="background:#1e2230;border:1px solid ${pendentes.length?'#991b1b':'#2d3748'};border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:6px">Pendentes</div>
      <div style="font-size:28px;font-weight:800;color:${pendentes.length?'#fc8181':'#e2e8f0'}">${pendentes.length}</div>
      <div style="font-size:10px;color:#4a5568;margin-top:2px">aguardando aprovação</div>
    </div>
    <div style="background:#1e2230;border:1px solid #2d3748;border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:6px">Ausentes hoje</div>
      <div style="font-size:28px;font-weight:800;color:${ausentesHoje.length?'#fb923c':'#e2e8f0'}">${ausentesHoje.length}</div>
      <div style="font-size:10px;color:#4a5568;margin-top:2px">${ausentesHoje.map(a=>a.nome.split(' ')[0]).join(', ')||'Nenhum'}</div>
    </div>
    <div style="background:#1e2230;border:1px solid #2d3748;border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:6px">Ausentes amanhã</div>
      <div style="font-size:28px;font-weight:800;color:${ausentesAmanha.length?'#fb923c':'#e2e8f0'}">${ausentesAmanha.length}</div>
      <div style="font-size:10px;color:#4a5568;margin-top:2px">${ausentesAmanha.map(a=>a.nome.split(' ')[0]).join(', ')||'Nenhum'}</div>
    </div>
    <div style="background:#1e2230;border:1px solid #2d3748;border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:6px">Próximos 7 dias</div>
      <div style="font-size:28px;font-weight:800;color:#e2e8f0">${[...new Set(proximosSete.map(a=>a.nome))].length}</div>
      <div style="font-size:10px;color:#4a5568;margin-top:2px">colaboradores afetados</div>
    </div>
  </div>

  <!-- Timeline -->
  <div style="background:#1e2230;border:1px solid #2d3748;border-radius:12px;padding:16px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:700">📅 Linha do tempo — período completo</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <span style="font-size:10px;color:#4ade80">🏖️ Férias</span>
        <span style="font-size:10px;color:#60a5fa">📅 Folga</span>
        <span style="font-size:10px;color:#f87171">🏥 Atestado</span>
        <span style="font-size:10px;color:#c084fc">🔄 Troca</span>
      </div>
    </div>
    ${timelineHtml}
  </div>

  <!-- Abas -->
  <div style="background:#1e2230;border:1px solid #2d3748;border-radius:12px;overflow:hidden">
    <div id="aus-tabs" style="display:flex;border-bottom:1px solid #2d3748;padding:0 16px">
      <button class="tab-btn ativo" onclick="abrirAba('pendentes',this)">
        Pendentes ${pendentes.length?`<span style="background:#991b1b;color:#fca5a5;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-left:4px">${pendentes.length}</span>`:''}
      </button>
      <button class="tab-btn" onclick="abrirAba('aprovadas',this)">Aprovadas <span style="color:#4a5568;font-size:11px">(${aprovadas.length})</span></button>
      <button class="tab-btn" onclick="abrirAba('historico',this)">Histórico <span style="color:#4a5568;font-size:11px">(${historico.length})</span></button>
    </div>
    <div style="padding:16px">
      <div id="aba-pendentes">${renderCards(pendentes,true)}</div>
      <div id="aba-aprovadas" style="display:none">${renderCards(aprovadas)}</div>
      <div id="aba-historico" style="display:none">${renderCards(historico)}</div>
    </div>
  </div>

</div>

<div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999"></div>

<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
function atualizarRelogio(){
  var now=new Date();
  var p=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now);
  var bh=p.find(function(x){return x.type==='hour';}).value,bm=p.find(function(x){return x.type==='minute';}).value,bs=p.find(function(x){return x.type==='second';}).value;
  var elBrt=document.getElementById('aus-relogio-brt');if(elBrt)elBrt.textContent=bh+':'+bm+':'+bs;
  var elGmt=document.getElementById('aus-relogio-gmt');if(elGmt)elGmt.textContent=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0');
}
async function carregarTempo(){
  try{
    var loc=null;
    try{var r1=await fetch('https://ipapi.co/json/');var j1=await r1.json();if(j1.latitude)loc={lat:j1.latitude,lon:j1.longitude,city:j1.city};}catch(e){}
    if(!loc)loc={lat:-22.9068,lon:-43.1729,city:'Rio de Janeiro'};
    var wd=await(await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')).json();
    var temp=wd.current&&wd.current.temperature_2m!==undefined?Math.round(wd.current.temperature_2m):'--';
    var icons={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',99:'⛈️'};
    document.getElementById('aus-tempo-icone').textContent=icons[wd.current&&wd.current.weathercode||0]||'🌡️';
    document.getElementById('aus-tempo-temp').textContent=temp+'°C';
    document.getElementById('aus-tempo-cidade').textContent=loc.city||'';
  }catch(e){document.getElementById('aus-tempo-temp').textContent='--°C';}
}
atualizarRelogio();carregarTempo();setInterval(atualizarRelogio,1000);
function abrirAba(id,btn){
  ['pendentes','aprovadas','historico'].forEach(function(t){
    document.getElementById('aba-'+t).style.display=t===id?'block':'none';
  });
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('ativo');});
  btn.classList.add('ativo');
}
function toast(msg,bg){var t=document.getElementById('toast');t.textContent=msg;t.style.background=bg||'#1a1a1a';t.style.display='block';setTimeout(function(){t.style.display='none';},2800);}
async function aprovar(id){
  try{
    var r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({acao:'aprovar-ausencia',id:id})});
    var d=await r.json();
    if(d.ok){toast('✓ Ausência aprovada!','#166534');setTimeout(function(){location.reload();},1200);}
    else toast('Erro: '+(d.error||'?'),'#991b1b');
  }catch(e){toast('Erro de conexão','#991b1b');}
}
async function recusar(id){
  try{
    var r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({acao:'recusar-ausencia',id:id})});
    var d=await r.json();
    if(d.ok){toast('✕ Ausência recusada','#7f1d1d');setTimeout(function(){location.reload();},1200);}
    else toast('Erro: '+(d.error||'?'),'#991b1b');
  }catch(e){toast('Erro de conexão','#991b1b');}
}
</script>
</body></html>`;

  const solicitarHtml = await solicitarBtn(session.nome);

  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.status(200).send(html + solicitarHtml);
}
