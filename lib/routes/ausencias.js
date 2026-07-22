// api/ausencias.js — Central de ausências com timeline visual
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
import { solicitarBtn } from '../solicitar-widget.js';
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
function escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function dentroAus(ini,fim,df,ano){
  try{const dtDf=dfParaDate(df,ano),dtIni=dfParaDate(ini,ano),dtFim=dfParaDate(fim||ini,ano);return dtDf>=dtIni&&dtDf<=dtFim;}catch{return false;}
}

export default async function handler(req,res){
  const session=getSession(req);
  if(!session)return res.redirect(302,'/api/app');

  // Equipe (9 col): 0=nome, 1=cargo, 2=nucleo, 3=email, 4=slackId, 5=regime, 6=status, 7=senha (hash), 8=perfil (gestor/colaborador)
  // Ausências (6 col): 0=id/status (prefixo APROVADO-.../RECUSADO/CANCELADO, senão pendente), 1=nome, 2=tipo, 3=motivo, 4=início DD/MM, 5=fim DD/MM
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

  // Lista de nomes pra o gestor escolher no formulário de nova ausência
  const nomesEquipe=equipeRaw.filter(r=>r[0]).map(r=>r[0]).sort((a,b)=>a.localeCompare(b,'pt-BR'));

  // Timeline: período completo (proporcional às datas reais, sem grade de dias pra rolar)
  const colaboradores=[...new Set(aprovadas.map(a=>a.nome))];
  const TIPO_COR={'Férias':['#1c3a0a','#4ade80','🏖️'],'Folga programada':['#0a1c3a','#60a5fa','📅'],'Atestado médico':['#3a0a0a','#f87171','🏥'],'Viagem':['#0a2e3a','#22d3ee','✈️'],'Troca de horário':['#1c1a3a','#c084fc','🔄']};
  const TIPO_COR_LIGHT={'Férias':['#dcfce7','#166534','🏖️'],'Folga programada':['#dbeafe','#1d4ed8','📅'],'Atestado médico':['#fee2e2','#991b1b','🏥'],'Viagem':['#cffafe','#0e7490','✈️'],'Troca de horário':['#f3e8ff','#7c3aed','🔄']};

  function badgeTipo(tipo,dark=true){
    const c=dark?TIPO_COR[tipo]||['#1e2230','#94a3b8','📋']:TIPO_COR_LIGHT[tipo]||['#f3f4f6','#374151','📋'];
    return `<span style="background:${c[0]};color:${c[1]};border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700">${c[2]} ${tipo}</span>`;
  }

  // Timeline HTML
  const MESES_ABR=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIA_MS=86400000;
  const addDias=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};

  let timelineHtml;
  if(colaboradores.length===0){
    timelineHtml=`<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px">Nenhuma ausência aprovada</div>`;
  } else {
    // Se a ausência vira o ano (ex: início 28/12, fim 05/01), o fim tem que valer pro ano
    // seguinte — senão a data de fim cai "antes" da de início e a barra fica com largura errada.
    const comDatas=aprovadas.map(a=>{
      const iniD=dfParaDate(a.ini,ano);
      const fimStr=a.fim||a.ini;
      const fimMes=Number(fimStr.split('/')[1]);
      const fimAno=fimMes<iniD.getMonth()+1?ano+1:ano;
      return {...a,iniD,fimD:dfParaDate(fimStr,fimAno)};
    });
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
      return `<div style="position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:rgba(251,146,60,.14);border-left:1px dashed #fb923c;border-right:1px dashed #fb923c;z-index:0" title="${fmtData(iniD)}→${fmtData(fimD)} · ${maxAusentes} ausentes ao mesmo tempo"></div>`;
    }).join('');

    // Marcador compacto (só ícone, sem texto solto) de onde tem sobreposição — mesma informação
    // que o aviso de texto que quebrava antes, mas sem risco de um atropelar o outro.
    const OVERLAP_TICK_H=14;
    const overlapTicksHtml=blocos.map(b=>{
      const iniD=new Date(b.iniKey*DIA_MS);
      const fimD=new Date(b.fimKey*DIA_MS);
      const left=pct(iniD);
      let maxAusentes=0;
      for(let k=b.iniKey;k<=b.fimKey;k++)maxAusentes=Math.max(maxAusentes,diaParaNomes.get(k).size);
      return `<div style="position:absolute;left:${left}%;top:0;font-size:10px;line-height:${OVERLAP_TICK_H}px;color:#fb923c;cursor:default" title="${fmtData(iniD)}→${fmtData(fimD)} · ${maxAusentes} ausentes ao mesmo tempo">⚠</div>`;
    }).join('');

    // Um cartão compacto por período de sobreposição (não um bloco gigante listando dia a dia —
    // quando as mesmas 2-3 pessoas ficam ausentes juntas por semanas seguidas, repetir o mesmo
    // nome em 20 sub-cartões não ajuda ninguém a ler mais rápido).
    const detalheBlocosHtml=blocos.map(b=>{
      const iniD=new Date(b.iniKey*DIA_MS);
      const fimD=new Date(b.fimKey*DIA_MS);
      const numDias=b.fimKey-b.iniKey+1;
      const nomesEnvolvidos=new Set();
      let maxAusentes=0;
      for(let k=b.iniKey;k<=b.fimKey;k++){
        diaParaNomes.get(k).forEach(n=>nomesEnvolvidos.add(n));
        maxAusentes=Math.max(maxAusentes,diaParaNomes.get(k).size);
      }
      return `<div style="background:var(--bg);border:1px solid var(--border);border-left:3px solid #fb923c;border-radius:8px;padding:10px 12px;min-width:180px;flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;color:var(--text)">${fmtData(iniD)} → ${fmtData(fimD)}</span>
          <span style="font-size:9px;font-weight:700;color:#fb923c;background:rgba(251,146,60,.14);border-radius:999px;padding:2px 8px">até ${maxAusentes} ao mesmo tempo</span>
        </div>
        <div style="font-size:9px;color:var(--text3);margin-bottom:4px">${numDias} dia${numDias>1?'s':''}</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.5">${[...nomesEnvolvidos].join(', ')}</div>
      </div>`;
    }).join('');
    const detalheDiasHtml=blocos.length?`
      <div style="margin-top:14px">
        <div style="font-size:11px;font-weight:700;color:#fb923c;margin-bottom:8px">⚠ Períodos com mais de 1 pessoa ausente ao mesmo tempo</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${detalheBlocosHtml}</div>
      </div>`:'';

    const ROW_H=46, TICKS_H=20;
    const corpoAltura=colaboradores.length*ROW_H;

    // Faixa zebrada por linha — ajuda a acompanhar a régua de uma pessoa até a outra ponta
    // do gráfico, tanto na coluna de nomes quanto na área rolável das barras.
    const zebraHtml=colaboradores.map((_,i)=>i%2===0?'':`<div style="position:absolute;left:0;right:0;top:${i*ROW_H}px;height:${ROW_H}px;background:var(--bg2);z-index:0"></div>`).join('');

    // Linhas verticais nos limites de cada mês, atravessando toda a altura do gráfico (régua de
    // referência pra alinhar visualmente onde cada barra começa/termina em relação ao mês).
    const gridHtml=marcadores.map(m=>`<div style="position:absolute;left:${m.pct}%;top:0;bottom:0;width:1px;background:var(--border);z-index:0"></div>`).join('');

    const linhasHtml=colaboradores.map((nome,i)=>{
      const periodos=comDatas.filter(a=>a.nome===nome);
      return periodos.map(a=>{
        const [bg,c]=TIPO_COR[a.tipo]||['#1e2230','#94a3b8'];
        const left=pct(a.iniD);
        const width=Math.max(pct(addDias(a.fimD,1))-left,3);
        // Barra estreita não cabe "DD/MM → DD/MM" sem cortar — fica só o bloco colorido nesse
        // caso (a cor já identifica o tipo junto com o badge da linha; a data completa continua
        // disponível no title ao passar o mouse ou no clique).
        const label=width>=8?`${a.ini} → ${a.fim||a.ini}`:'';
        return `<div class="aus-bar" onclick="abrirEditarAusencia(this)" data-id="${escAttr(a.id)}" data-nome="${escAttr(a.nome)}" data-tipo="${escAttr(a.tipo)}" data-ini="${escAttr(a.ini)}" data-fim="${escAttr(a.fim||a.ini)}" data-motivo="${escAttr(a.motivo||'')}" style="position:absolute;left:${left}%;width:${width}%;top:${i*ROW_H+3}px;height:${ROW_H-10}px;border-radius:6px;background:${bg};border:1px solid ${c};box-shadow:0 1px 3px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;padding:0 4px;overflow:hidden;z-index:1;cursor:pointer" title="${a.tipo}: ${a.ini} → ${a.fim||a.ini} (clique pra editar)">
          <span style="font-size:9px;font-weight:800;color:${c};white-space:nowrap">${label}</span>
        </div>`;
      }).join('');
    }).join('');

    const nomesHtml=colaboradores.map((nome,i)=>{
      const periodos=comDatas.filter(a=>a.nome===nome);
      return `<div style="height:${ROW_H}px;display:flex;align-items:center;gap:8px;padding:0 10px 0 4px;border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg2)'}">
        <div style="width:28px;height:28px;border-radius:50%;background:#1a2744;color:#63b3ed;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${nome.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap">${nome.split(' ').slice(0,2).join(' ')}</div>
          <div style="white-space:nowrap">${badgeTipo(periodos[0]?.tipo||'')}</div>
        </div>
      </div>`;
    }).join('');

    const marcadoresHtml=marcadores.map(m=>`<div style="position:absolute;left:${m.pct}%;font-size:10px;color:var(--text4);font-weight:700;white-space:nowrap">${m.label}</div>`).join('');

    timelineHtml=`
    <style>
      .aus-bar{transition:filter .12s ease,box-shadow .12s ease}
      .aus-bar:hover{filter:brightness(1.3);box-shadow:0 2px 10px rgba(0,0,0,.35);z-index:2 !important}
    </style>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px">
    <div style="display:flex;min-width:600px">
      <div style="width:160px;flex-shrink:0;padding-top:${TICKS_H+OVERLAP_TICK_H}px;position:sticky;left:0;background:var(--card);z-index:3;box-shadow:2px 0 6px rgba(0,0,0,.08)">${nomesHtml}</div>
      <div style="flex:1;position:relative;min-width:0">
        <div style="position:relative;height:${OVERLAP_TICK_H+TICKS_H+corpoAltura}px">
          ${gridHtml}
          <div style="position:relative;height:${OVERLAP_TICK_H}px">${overlapTicksHtml}</div>
          <div style="position:relative;height:${TICKS_H}px">${marcadoresHtml}</div>
          <div style="position:relative;height:${corpoAltura}px">
            ${zebraHtml}
            ${faixasHtml}
            ${linhasHtml}
          </div>
        </div>
      </div>
    </div>
    </div>
    ${detalheDiasHtml}`;
  }

  function botoesGerenciar(a,compacto=false){
    const attrs=`data-id="${escAttr(a.id)}" data-nome="${escAttr(a.nome)}" data-tipo="${escAttr(a.tipo)}" data-ini="${escAttr(a.ini)}" data-fim="${escAttr(a.fim||a.ini)}" data-motivo="${escAttr(a.motivo||'')}"`;
    if(compacto){
      return `<button onclick="abrirEditarAusencia(this)" ${attrs} style="background:none;border:1px solid var(--btn-border);border-radius:5px;padding:3px 8px;font-size:11px;color:var(--text2);cursor:pointer">✏️</button>
        <button onclick="excluirAusenciaGestor('${a.id}')" style="background:none;border:1px solid #991b1b;border-radius:5px;padding:3px 8px;font-size:11px;color:#fc8181;cursor:pointer">🗑</button>`;
    }
    return `<button onclick="abrirEditarAusencia(this)" ${attrs} style="background:none;border:1px solid var(--btn-border);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--text2);cursor:pointer">✏️ Editar</button>
      <button onclick="excluirAusenciaGestor('${a.id}')" style="background:none;border:1px solid #991b1b;border-radius:6px;padding:5px 12px;font-size:12px;color:#fc8181;cursor:pointer">🗑 Excluir</button>`;
  }

  function renderCards(lista, comAcoes=false, podeGerenciar=false){
    if(!lista.length)return `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Nenhum registro</div>`;
    return lista.map(a=>{
      const [bg,c,ic]=TIPO_COR[a.tipo]||['#1e2230','#94a3b8','📋'];
      const hasAnexo=a.motivo&&a.motivo.includes('Anexo:');
      const anexoUrl=hasAnexo?a.motivo.split('Anexo:')[1].trim():'';
      const motivoTxt=hasAnexo?a.motivo.split('Anexo:')[0].trim():a.motivo;
      const periodo=a.ini+(a.fim&&a.fim!==a.ini?' → '+a.fim:'');
      return `<div style="background:var(--card);border:1px solid ${comAcoes?c:'var(--border)'};border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:8px">
        <div style="font-size:22px">${ic}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:13px;font-weight:700;color:var(--text)">${a.nome}</span>
            ${badgeTipo(a.tipo)}
          </div>
          <div style="font-size:12px;color:#63b3ed;font-weight:600;margin-bottom:2px">📅 ${periodo}</div>
          ${motivoTxt?`<div style="font-size:11px;color:var(--text2)">${motivoTxt}</div>`:''}
          ${hasAnexo?`<a href="${anexoUrl}" target="_blank" style="font-size:11px;color:#60a5fa">📎 Ver atestado</a>`:''}
          ${comAcoes||podeGerenciar?`<div style="font-size:10px;color:var(--text4);margin-top:3px">ID: ${a.id}</div>`:''}
        </div>
        <div style="flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${comAcoes?`
            <button onclick="aprovar('${a.id}')" style="background:#166534;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:700;color:#86efac;cursor:pointer">✓ Aprovar</button>
            <button onclick="recusar('${a.id}')" style="background:none;border:1px solid #991b1b;border-radius:6px;padding:5px 12px;font-size:12px;color:#fc8181;cursor:pointer">✕ Recusar</button>
          `:podeGerenciar?botoesGerenciar(a):`<span style="font-size:10px;color:${a.status==='aprovado'?'#4ade80':a.status==='recusado'?'#fc8181':'#718096'};font-weight:600;text-transform:uppercase">${a.status==='aprovado'?'✓ Aprovado':a.status==='recusado'?'✕ Recusado':'Cancelado'}</span>`}
        </div>
      </div>`;
    }).join('');
  }

  function renderTabela(lista, comAcoes=false, podeGerenciar=false){
    if(!lista.length)return `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Nenhum registro</div>`;
    const linhas=lista.map(a=>{
      const periodo=a.ini+(a.fim&&a.fim!==a.ini?' → '+a.fim:'');
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px;color:var(--text);font-weight:600;white-space:nowrap">${a.nome}</td>
        <td style="padding:8px;white-space:nowrap">${badgeTipo(a.tipo)}</td>
        <td style="padding:8px;color:#63b3ed;font-weight:600;white-space:nowrap">${periodo}</td>
        <td style="padding:8px">${comAcoes?`
          <div style="display:flex;gap:6px">
            <button onclick="aprovar('${a.id}')" style="background:#166534;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;color:#86efac;cursor:pointer">✓</button>
            <button onclick="recusar('${a.id}')" style="background:none;border:1px solid #991b1b;border-radius:5px;padding:3px 9px;font-size:11px;color:#fc8181;cursor:pointer">✕</button>
          </div>`:podeGerenciar?`<div style="display:flex;gap:6px">${botoesGerenciar(a,true)}</div>`:`<span style="font-size:10px;font-weight:600;text-transform:uppercase;color:${a.status==='aprovado'?'#4ade80':a.status==='recusado'?'#fc8181':'var(--text3)'}">${a.status==='aprovado'?'✓ Aprovado':a.status==='recusado'?'✕ Recusado':'Cancelado'}</span>`}</td>
      </tr>`;
    }).join('');
    return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:6px 8px;font-size:10px;color:var(--text3);text-transform:uppercase">Nome</th>
        <th style="text-align:left;padding:6px 8px;font-size:10px;color:var(--text3);text-transform:uppercase">Tipo</th>
        <th style="text-align:left;padding:6px 8px;font-size:10px;color:var(--text3);text-transform:uppercase">Período</th>
        <th style="text-align:left;padding:6px 8px;font-size:10px;color:var(--text3);text-transform:uppercase">${comAcoes||podeGerenciar?'Ações':'Status'}</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;
  }

  const html=`<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Ausências</title>
<style>
:root{--bg:#f5f5f5;--header:#1a1a1a;--card:#fff;--bg2:#f0f0f0;--border:#e5e5e5;--text:#1a1a1a;--text2:#555;--text3:#888;--text4:#aaa;--input:#fff;--btn-border:#ccc;}
html.dark{--bg:#1c1f26;--header:#161920;--card:#1e2230;--bg2:#2d3140;--border:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;--input:#161920;--btn-border:#3d4660;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.tab-btn{padding:8px 16px;font-size:13px;font-weight:600;background:none;border:none;color:var(--text3);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
.tab-btn.ativo{color:#63b3ed;border-bottom-color:#3b82f6}
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:var(--text);text-decoration:none;white-space:nowrap}
.menu-item:hover{background:var(--bg2)}
@media(max-width:640px){
  .hdr-btns>*{display:none!important}
  .hdr-btns>.m-keep{display:flex!important;align-items:center}
  #abas-header-aus{flex-wrap:wrap;padding:8px 12px!important}
  #abas-header-aus .tab-btn{padding:6px 10px;font-size:12px}
  #metricas-aus{grid-template-columns:repeat(2,1fr)!important}
}
</style></head>
<body>
<div style="background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;border-bottom:1px solid var(--border)">
  <div style="width:28px;height:28px;border-radius:6px;background:#e53e3e;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0">P</div>
  <div>
    <div style="font-size:14px;font-weight:700;color:#fff">Ausências</div>
    <div style="font-size:10px;color:#718096">${ausentesHoje.length} hoje · ${pendentes.length} pendente${pendentes.length!==1?'s':''}</div>
  </div>
  <div class="hdr-btns" style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <button onclick="abrirNovaAusencia()" class="m-keep" style="border:1px solid #166534;background:#0d2010;border-radius:6px;padding:5px 12px;font-size:11px;color:#86efac;cursor:pointer;font-weight:600">+ Nova ausência</button>
    <div id="aus-tempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="aus-tempo-icone">⏳</span>
      <span id="aus-tempo-temp" style="font-weight:700">--°C</span>
      <span id="aus-tempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div class="m-keep" style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:#718096">BRT</span>
        <span id="aus-relogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span style="font-size:8px;color:#718096">GMT</span>
        <span id="aus-relogio-gmt" style="font-size:10px;font-weight:600;color:#4a5568;font-variant-numeric:tabular-nums"></span>
      </div>
    </div>
    <button id="tt" onclick="toggleTheme()" class="m-keep" style="border:1px solid var(--btn-border);border-radius:5px;padding:3px 8px;font-size:14px;background:none;cursor:pointer">🌙</button>
    <div class="m-keep" style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" style="border:1px solid var(--btn-border);border-radius:6px;padding:4px 10px;font-size:15px;color:var(--text2);background:none;cursor:pointer;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Inicio</a>
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausencias</a>
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
        <a href="/api/equipamentos" class="menu-item">&#128230; Equipamentos</a>
        <a href="/api/chamados" class="menu-item">&#127915; Chamados</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>
  </div>
</div>

<div id="modal-nova-aus-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:998;align-items:center;justify-content:center" onclick="if(event.target===this)fecharNovaAusencia()">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;width:340px;max-width:90vw">
    <div id="na-titulo" style="font-size:14px;font-weight:700;margin-bottom:14px;color:var(--text)">Nova ausência (já aprovada)</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600">Colaborador</label>
        <select id="na-colaborador" style="width:100%;margin-top:4px;background:var(--input);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px">
          ${nomesEquipe.map(n=>`<option value="${n}">${n}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600">Tipo</label>
        <select id="na-tipo" style="width:100%;margin-top:4px;background:var(--input);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px">
          <option value="Férias">🏖️ Férias</option>
          <option value="Folga programada">📅 Folga programada</option>
          <option value="Atestado médico">🏥 Atestado médico</option>
          <option value="Viagem">✈️ Viagem</option>
          <option value="Troca de horário">🔄 Troca de horário</option>
        </select>
      </div>
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600">Início</label>
          <input type="date" id="na-inicio" style="width:100%;margin-top:4px;background:var(--input);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px">
        </div>
        <div style="flex:1">
          <label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600">Fim</label>
          <input type="date" id="na-fim" style="width:100%;margin-top:4px;background:var(--input);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px">
        </div>
      </div>
      <div>
        <label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600">Motivo (opcional)</label>
        <textarea id="na-motivo" rows="2" style="width:100%;margin-top:4px;background:var(--input);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px;resize:none;font-family:inherit"></textarea>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button id="na-btn-excluir" onclick="excluirDoModal()" style="display:none;background:none;border:1px solid #991b1b;border-radius:6px;padding:8px 12px;font-size:12px;color:#fc8181;cursor:pointer">🗑 Excluir</button>
      <button onclick="fecharNovaAusencia()" style="flex:1;background:none;border:1px solid var(--btn-border);border-radius:6px;padding:8px;font-size:12px;color:var(--text2);cursor:pointer">Cancelar</button>
      <button id="na-btn-salvar" onclick="salvarAusenciaGestor()" style="flex:1;background:#166534;border:none;border-radius:6px;padding:8px;font-size:12px;font-weight:700;color:#86efac;cursor:pointer">Criar</button>
    </div>
  </div>
</div>

<div style="max-width:1100px;margin:0 auto;padding:20px 16px">

  <!-- Métricas -->
  <div id="metricas-aus" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px">
    <div style="background:var(--card);border:1px solid ${pendentes.length?'#991b1b':'var(--border)'};border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:6px">Pendentes</div>
      <div style="font-size:28px;font-weight:800;color:${pendentes.length?'#fc8181':'var(--text)'}">${pendentes.length}</div>
      <div style="font-size:10px;color:var(--text4);margin-top:2px">aguardando aprovação</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:6px">Ausentes hoje</div>
      <div style="font-size:28px;font-weight:800;color:${ausentesHoje.length?'#fb923c':'var(--text)'}">${ausentesHoje.length}</div>
      <div style="font-size:10px;color:var(--text4);margin-top:2px">${ausentesHoje.map(a=>a.nome.split(' ')[0]).join(', ')||'Nenhum'}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:6px">Ausentes amanhã</div>
      <div style="font-size:28px;font-weight:800;color:${ausentesAmanha.length?'#fb923c':'var(--text)'}">${ausentesAmanha.length}</div>
      <div style="font-size:10px;color:var(--text4);margin-top:2px">${ausentesAmanha.map(a=>a.nome.split(' ')[0]).join(', ')||'Nenhum'}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:6px">Próximos 7 dias</div>
      <div style="font-size:28px;font-weight:800;color:var(--text)">${[...new Set(proximosSete.map(a=>a.nome))].length}</div>
      <div style="font-size:10px;color:var(--text4);margin-top:2px">colaboradores afetados</div>
    </div>
  </div>

  <!-- Timeline -->
  <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:24px;box-shadow:0 1px 2px rgba(20,20,20,.05),0 6px 16px -8px rgba(20,20,20,.10)">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:700;color:var(--text)">📅 Linha do tempo — período completo</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:600;background:#1c3a0a;color:#4ade80;border-radius:999px;padding:3px 9px">🏖️ Férias</span>
        <span style="font-size:10px;font-weight:600;background:#0a1c3a;color:#60a5fa;border-radius:999px;padding:3px 9px">📅 Folga</span>
        <span style="font-size:10px;font-weight:600;background:#3a0a0a;color:#f87171;border-radius:999px;padding:3px 9px">🏥 Atestado</span>
        <span style="font-size:10px;font-weight:600;background:#0a2e3a;color:#22d3ee;border-radius:999px;padding:3px 9px">✈️ Viagem</span>
        <span style="font-size:10px;font-weight:600;background:#1c1a3a;color:#c084fc;border-radius:999px;padding:3px 9px">🔄 Troca</span>
      </div>
    </div>
    ${timelineHtml}
  </div>

  <!-- Abas -->
  <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
    <div id="abas-header-aus" style="display:flex;align-items:center;border-bottom:1px solid var(--border);padding:0 16px">
      <button class="tab-btn ativo" onclick="abrirAba('pendentes',this)">
        Pendentes ${pendentes.length?`<span style="background:#991b1b;color:#fca5a5;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-left:4px">${pendentes.length}</span>`:''}
      </button>
      <button class="tab-btn" onclick="abrirAba('aprovadas',this)">Aprovadas <span style="color:var(--text4);font-size:11px">(${aprovadas.length})</span></button>
      <button class="tab-btn" onclick="abrirAba('historico',this)">Histórico <span style="color:var(--text4);font-size:11px">(${historico.length})</span></button>
      <div style="display:flex;gap:4px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:3px;margin-left:auto">
        <button id="view-grade-aus" onclick="setViewAus('grade')" title="Tabela" style="background:none;color:var(--text3);border:none;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer">&#9638;</button>
        <button id="view-lista-aus" onclick="setViewAus('lista')" title="Lista" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer">&#9776;</button>
      </div>
    </div>
    <div style="padding:16px">
      <div id="aba-pendentes">
        <div id="aba-pendentes-lista">${renderCards(pendentes,true)}</div>
        <div id="aba-pendentes-grade" style="display:none">${renderTabela(pendentes,true)}</div>
      </div>
      <div id="aba-aprovadas" style="display:none">
        <div id="aba-aprovadas-lista">${renderCards(aprovadas,false,true)}</div>
        <div id="aba-aprovadas-grade" style="display:none">${renderTabela(aprovadas,false,true)}</div>
      </div>
      <div id="aba-historico" style="display:none">
        <div id="aba-historico-lista">${renderCards(historico)}</div>
        <div id="aba-historico-grade" style="display:none">${renderTabela(historico)}</div>
      </div>
    </div>
  </div>

</div>

<div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999"></div>

<script>
var ANO_ATUAL_AUS=${ano};
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
var _viewAus=localStorage.getItem('aus-view')||'lista';
function aplicarViewAus(){
  ['pendentes','aprovadas','historico'].forEach(function(t){
    var l=document.getElementById('aba-'+t+'-lista'), g=document.getElementById('aba-'+t+'-grade');
    if(l)l.style.display=_viewAus==='lista'?'block':'none';
    if(g)g.style.display=_viewAus==='grade'?'block':'none';
  });
  var bg=document.getElementById('view-grade-aus'), bl=document.getElementById('view-lista-aus');
  if(bg&&bl){
    bg.style.background=_viewAus==='grade'?'#1a1a1a':'none'; bg.style.color=_viewAus==='grade'?'#fff':'var(--text3)';
    bl.style.background=_viewAus==='lista'?'#1a1a1a':'none'; bl.style.color=_viewAus==='lista'?'#fff':'var(--text3)';
  }
}
function setViewAus(mode){_viewAus=mode;localStorage.setItem('aus-view',mode);aplicarViewAus();}
aplicarViewAus();
function toast(msg,bg){var t=document.getElementById('toast');t.textContent=msg;t.style.background=bg||'#1a1a1a';t.style.display='block';setTimeout(function(){t.style.display='none';},2800);}
function toggleTheme(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'☀️':'🌙';}
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
var naEditandoId=null;
function resetModalNovaAusencia(){
  naEditandoId=null;
  document.getElementById('na-titulo').textContent='Nova ausência (já aprovada)';
  document.getElementById('na-btn-salvar').textContent='Criar';
  document.getElementById('na-btn-excluir').style.display='none';
  document.getElementById('na-colaborador').value=document.getElementById('na-colaborador').options[0]?document.getElementById('na-colaborador').options[0].value:'';
  document.getElementById('na-tipo').value='Férias';
  document.getElementById('na-inicio').value='';
  document.getElementById('na-fim').value='';
  document.getElementById('na-motivo').value='';
}
function abrirNovaAusencia(){resetModalNovaAusencia();document.getElementById('modal-nova-aus-overlay').style.display='flex';}
function fecharNovaAusencia(){document.getElementById('modal-nova-aus-overlay').style.display='none';}
function fmtDtNA(s){if(!s)return '';var p=s.split('-');return p[2]+'/'+p[1];}
function dfParaISO(df){if(!df)return '';var p=df.split('/');return ANO_ATUAL_AUS+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');}
function abrirEditarAusencia(btn){
  var d=btn.dataset;
  naEditandoId=d.id;
  document.getElementById('na-titulo').textContent='Editar ausência';
  document.getElementById('na-btn-salvar').textContent='Salvar';
  document.getElementById('na-btn-excluir').style.display='block';
  document.getElementById('na-colaborador').value=d.nome;
  document.getElementById('na-tipo').value=d.tipo;
  document.getElementById('na-inicio').value=dfParaISO(d.ini);
  document.getElementById('na-fim').value=dfParaISO(d.fim);
  document.getElementById('na-motivo').value=d.motivo||'';
  document.getElementById('modal-nova-aus-overlay').style.display='flex';
}
function excluirDoModal(){
  if(!naEditandoId)return;
  excluirAusenciaGestor(naEditandoId);
}
async function salvarAusenciaGestor(){
  var colaborador=document.getElementById('na-colaborador').value;
  var tipo=document.getElementById('na-tipo').value;
  var inicio=fmtDtNA(document.getElementById('na-inicio').value);
  var fim=fmtDtNA(document.getElementById('na-fim').value)||inicio;
  var motivo=document.getElementById('na-motivo').value;
  if(!colaborador||!tipo||!inicio){toast('Preencha colaborador, tipo e data de início','#991b1b');return;}
  var body={acao:naEditandoId?'editar-ausencia':'criar-ausencia-gestor',colaborador:colaborador,tipo:tipo,motivo:motivo,dataInicio:inicio,dataFim:fim};
  if(naEditandoId)body.id=naEditandoId;
  try{
    var r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(d.ok){toast(naEditandoId?'✓ Ausência atualizada!':'✓ Ausência criada e aprovada!','#166534');setTimeout(function(){location.reload();},1000);}
    else toast('Erro: '+(d.error||'?'),'#991b1b');
  }catch(e){toast('Erro de conexão','#991b1b');}
}
async function excluirAusenciaGestor(id){
  if(!confirm('Excluir esta ausência? Essa ação não pode ser desfeita.'))return;
  try{
    var r=await fetch('/api/equipe-view',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({acao:'excluir-ausencia',id:id})});
    var d=await r.json();
    if(d.ok){toast('🗑 Ausência excluída','#7f1d1d');setTimeout(function(){location.reload();},1000);}
    else toast('Erro: '+(d.error||'?'),'#991b1b');
  }catch(e){toast('Erro de conexão','#991b1b');}
}
</script>
</body></html>`;

  const solicitarHtml = await solicitarBtn(session.nome);

  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.status(200).send(html + solicitarHtml);
}
