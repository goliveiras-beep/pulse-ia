// antenas.js — lado do navegador da tela /api/antenas (fase 2 dos Registros técnicos).
// Portado do artefato "Preventiva das Antenas — Checklists": a lógica de checklists, SLA e dashboard é a
// original; mudou só a camada de dados (planilha via /api/antenas), a identidade (quem está logado) e a
// remoção de PIN, e-mail (Gmail), contrato em PDF e calendário próprio.
(function(){
"use strict";
const ANTENAS = [
  {id:"RX01",sat:"IS35e",pols:["L","R"]},{id:"RX02",sat:"SES14",pols:["L","R"]},
  {id:"RX03",sat:"SES14",pols:["L","R"]},{id:"RX04",sat:"IS34",pols:["V","H"]},
  {id:"RX05",sat:"D2",pols:["V","H"]},{id:"RX06",sat:"AMZ3",pols:["V","H"]}
];
const PLUS = [
 {k:"Antes",t:"Antes de começar",it:[
  ["P1","Janela combinada com a Central Técnica e níveis de sinal antes registrados"],
  ["P2","Fusos de Az/El travados; EPIs e ancoragem conferidos"]]},
 {k:"1",t:"Revisão geral",it:[
  ["R1","Refletor sem danos ou corrosão; drenos livres"],
  ["R2","Base, pedestal e aterramento íntegros"],
  ["R3","Alimentador, LNB, cabos e conectores íntegros"]]},
 {k:"2",t:"Reaperto",it:[
  ["A1","Base, pedestal e elevação reapertados"],
  ["A2","Refletor e suportes do alimentador reapertados e marcados"]]},
 {k:"3",t:"Fusos Az/El",it:[
  ["F1","Fusos limpos; rosca, porca e fole sem desgaste"],
  ["F2","Graxa nova aplicada; curso completo sem travar"]]},
 {k:"4",t:"Alimentadores",it:[
  ["L1","Alimentador, OMT e janela íntegros"],
  ["L2","Parafusos com zinabre limpos e lubrificados (trocados se preciso)"],
  ["L3","Integridade do Mayler"]]},
 {k:"5",t:"Vedação dos flanges",it:[
  ["V1","Flanges limpos; O-rings em bom estado"],
  ["V2","Graxa de silicone nas 2 entradas (alimentador, filtro, LNB)"]]},
 {k:"6",t:"Conectores F (RG-11)",it:[
  ["C1","Conector inspecionado, refeito se preciso, e apertado"],
  ["C2","Autofusão + silicone"]]},
 {k:"Fim",t:"Encerramento",it:[
  ["E1","Níveis depois iguais ou melhores que antes"],
  ["E2","Parábola liberada, área limpa e Central Técnica notificada"]]}
];
const BASICA = [
 {k:"I",t:"Inspeção",it:[
  ["1","Sinal dentro do habitual nos receptores"],
  ["2","Refletor e estrutura sem danos ou parafusos soltos; drenos livres"],
  ["3","Fusos com graxa; movimento Az/El normal"],
  ["4","Alimentadores e flanges sem zinabre ou infiltração"],
  ["5","Vedação dos conectores F íntegra"],
  ["6","Aterramento e painel em ordem"]]}
];
const TIPOS = {plus:{nome:"Preventiva Plus (anual)",sec:PLUS,niveis:true,cat:"preventiva"},basica:{nome:"Preventiva Básica (trimestral)",sec:BASICA,niveis:true,cat:"preventiva"},
  corretiva:{nome:"Corretiva",sec:BASICA,niveis:true,cat:"corretiva",chamado:true},emergencial:{nome:"Emergencial",sec:BASICA,niveis:true,cat:"emergencial",chamado:true}};
const CATS={preventiva:{nome:"Preventivas",cor:"#1F6F7A"},corretiva:{nome:"Corretivas",cor:"#C2861A"},emergencial:{nome:"Emergenciais",cor:"#B5402F"}};
const VALS = ["OK","NC","NA"];
const EQUIPE = (window.__AT && window.__AT.equipe) || [];
const MATERIAIS = ["Graxa para fusos","Graxa de silicone","Lubrificante protetivo","Fita de autofusão (rolos)","Silicone (tubos)","Conectores F para RG-11","Parafusos substituídos"];

const app = document.getElementById("app");
const AT = window.__AT || {}; const U = AT.usuario || {};
let db = true, me = {id: U.nome || null, name: U.nome || ""}, isOwner = !!U.isGestor, isView = !!U.isView;
let list = [], filter = "todos", unsubList = null, view = "lista", periodo = "T"+(Math.floor(new Date().getMonth()/3)+1), charts = [];
let sla = {emergencial:4,corretiva:48,emerg_d:1,corr_d:2,preventiva:15,nc_h:96,prev_int:90,plus_int:365,reinc_d:90,inicio:""};
let anoSel = new Date().getFullYear();
let antSel = "RX01", medSel = "cn";
let cur = null, curId = null, curAnt = "RX01", saveTimer = null, saving = false, pending = false;

const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hoje = () => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const fmtData = d => d ? esc(String(d).split("-").reverse().join("/")) : "";
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("on");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("on"),2600);}
const MOTIVOS_PARCIAL=["Condições climáticas","Falta de material ou peça","Janela de manutenção insuficiente","Equipamento em operação, sem liberação","Problema de acesso ao local","Ferramenta ou instrumento indisponível","Equipe insuficiente","Conflito de agenda da contratada","Outro"];
const RESP_MOTIVO={"Conflito de agenda da contratada":"contratada","Equipe insuficiente":"contratada","Ferramenta ou instrumento indisponível":"contratada",
  "Falta de material ou peça":"contratante","Equipamento em operação, sem liberação":"contratante","Janela de manutenção insuficiente":"contratante","Problema de acesso ao local":"contratante",
  "Condições climáticas":"neutro","Outro":"neutro"};
const RESP_TXT={contratada:"Responsabilidade da contratada (conta no SLA)",contratante:"Responsabilidade da LiveMode (não conta no SLA da contratada)",neutro:"Causa externa (não conta no SLA da contratada)"};
function respParcial(c){ return parcial(c)?(RESP_MOTIVO[c.execucao.motivo]||"neutro"):null; }
function cotaMes(ym){ const l=list.filter(c=>c.ident&&(c.ident.data||"").slice(0,7)===ym&&!ehContinuacao(c)&&c.id!==curId);
  return {interv:l.filter(c=>c.tipo==="corretiva").length,emerg:l.filter(c=>c.tipo==="emergencial").length}; }
function ehContinuacao(c){ return !!(c&&c.continuaDe); }
function parcial(c){ return !!(c&&c.execucao&&c.execucao.situacao==="parcial"); }
function pendParcial(c){ return parcial(c)&&c.status==="concluido"&&!c.execucao.retornoFeito&&!(c.execucao.continuacao&&list.some(x=>x.id===c.execucao.continuacao.id&&x.status!=="concluido")); }
function estadoRetorno(c){ const r=c.execucao&&c.execucao.retorno; if(!r) return "atencao"; const d=Math.floor((new Date(r+"T23:59:59")-new Date())/86400000); return d<0?"atrasado":d<=2?"atencao":"ok"; }
function statusInfo(c){
  if(c.status==="concluido"&&parcial(c)) return c.execucao.retornoFeito?["st-concluido","Concluído (parcial, retorno feito)"]:["st-aguardando","Concluído parcial"];
  if(c.status==="concluido") return c.avaliador&&c.avaliador.parecer==="Reprovado"?["st-reprovado","Reprovado"]:["st-concluido","Concluído completo"];
  if(c.status==="aguardando") return ["st-rascunho","Em preenchimento"];
  return ["st-rascunho","Em preenchimento"];
}
function progresso(c, antId){
  const t=TIPOS[c.tipo]; let tot=0, feitos=0;
  const ants = antId?[antId]:c.antenas;
  ants.forEach(a=>t.sec.forEach(s=>s.it.forEach(([code])=>{tot++; if(c.resp[code+"|"+a]) feitos++;})));
  return tot?feitos/tot:0;
}

/* ---------- dados (API do Pulse) ---------- */
const SLA_PADRAO = {emergencial:4,corretiva:48,emerg_d:1,corr_d:2,preventiva:15,nc_h:96,prev_int:90,plus_int:365,reinc_d:90,inicio:""};
async function api(action, corpo){
  const get = corpo === undefined;
  const r = await fetch('/api/antenas?action=' + action, get ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo)});
  let j = {}; try { j = await r.json(); } catch(e) {}
  if(!r.ok){ const err = new Error(j.error || ('Erro ' + r.status)); err.status = r.status; throw err; }
  return j;
}
const clone = o => JSON.parse(JSON.stringify(o));
const refrescar = () => { if(!curId){ if(view === "dash") renderDash(); else renderHome(); } };
const store = {
  async add(c){ const j = await api('criar', {doc:c}); list.unshift(Object.assign({id:j.id}, clone(c))); return {id:j.id}; },
  async set(id, doc){ await api('salvar', {id, doc}); list = list.map(x => x.id === id ? Object.assign({id}, clone(doc)) : x); refrescar(); },
  async update(id, patch){ await api('atualizar', {id, patch}); list = list.map(x => x.id === id ? Object.assign({}, x, clone(patch)) : x); refrescar(); },
  async del(id){ await api('apagar', {id}); list = list.filter(x => x.id !== id); refrescar(); },
  async setSla(v){ await api('sla', {sla:v}); }
};
async function recarregar(primeira){
  try{
    const j = await api('listar');
    list = j.checklists || [];
    sla = Object.assign({}, SLA_PADRAO, j.sla || {});
    if(!curId){ if(view === "dash") renderDash(); else renderHome(); }
  }catch(e){ if(primeira) toast("Não foi possível carregar os checklists."); }
}
(function(){ const im = document.getElementById('logoImg'); if(!im) return;
  const go = () => { try{ const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); window.__logoData = c.toDataURL('image/png'); }catch(e){} };
  if(im.complete && im.naturalWidth) go(); else im.addEventListener('load', go); })();

/* ---------- init ---------- */
async function init(){
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{ if(curId) salvar(); curId=null; cur=null; view=b.dataset.view;
    document.querySelectorAll("[data-view]").forEach(x=>x.toggleAttribute("aria-current",x===b)); if(view==="dash") renderDash(); else renderHome(); window.scrollTo(0,0); });
  renderHome();
  await recarregar(true);
  setInterval(()=>{ if(!curId && !document.hidden) recarregar(false); }, 30000);
}

/* ---------- home ---------- */
function renderHome(){
  curId=null; cur=null; view="lista"; charts.forEach(c=>c.destroy()); charts=[];
  document.querySelectorAll("[data-view]").forEach(x=>x.toggleAttribute("aria-current",x.dataset.view==="lista"));
  const filtrados = list.filter(c=>{
    if(filter==="todos") return true;
    if(filter==="pend"||filter==="rascunho") return c.status!=="concluido";
    return c.status===filter;
  });
  /* agrupa as continuações logo abaixo do relatório de origem */
  const items=[]; const ids=new Set(filtrados.map(c=>c.id));
  const filhos=id=>filtrados.filter(x=>x.continuaDe&&x.continuaDe.id===id).sort((a,b)=>(a.criadoEm||"").localeCompare(b.criadoEm||""));
  const poe=(c,n)=>{ items.push({c,n}); filhos(c.id).forEach(f=>poe(f,n+1)); };
  filtrados.filter(c=>!(c.continuaDe&&ids.has(c.continuaDe.id))).forEach(c=>poe(c,0));
  app.innerHTML = `
  ${!db?`<div class="notice">Entre com a sua conta da empresa para salvar os checklists e ver o histórico. Sem isso, o preenchimento funciona, mas não fica guardado.</div>`:""}
  ${isView?'<div class="notice">Sua conta é somente leitura: você acompanha os checklists e o dashboard, mas não cria nem altera registros.</div>':""}
  ${isView?"":`<div class="start">
    <button class="plus" data-new="plus"><strong>Nova Preventiva Plus</strong><span>Anual. 18 itens por antena.</span></button>
    <button class="basica" data-new="basica"><strong>Nova Preventiva Básica</strong><span>Inspeção rápida entre as Plus. 6 itens por antena.</span></button>
    <button class="corretiva" data-new="corretiva"><strong>Nova Corretiva</strong><span>Atendimento a falha. Relatório básico + dados do chamado.</span></button>
    <button class="emergencial" data-new="emergencial"><strong>Nova Emergencial</strong><span>Atendimento urgente. Relatório básico + tempos de resposta.</span></button>
  </div>`}
  <div id="pendBanner"></div>
  <section class="hist">
    <h2>Checklists registrados</h2>
    <div class="filters" role="group" aria-label="Filtrar">
      ${[["todos","Todos"],["rascunho","Em preenchimento"],["concluido","Concluídos"]].map(([k,l])=>`<button class="chip" data-f="${k}" aria-pressed="${filter===k}">${l}</button>`).join("")}
    </div>
    <div class="rows">
      ${items.length?items.map(({c,n})=>{const [cls,l]=statusInfo(c);const cont=c.execucao&&c.execucao.continuacao&&list.some(x=>x.id===c.execucao.continuacao.id)?c.execucao.continuacao:null;return `<div class="rw ${n?"rw-cont":""}" style="${n?`--niv:${n}`:""}"><button class="row" data-open="${esc(c.id)}">
        <span class="t">${n?'<span class="elo" aria-hidden="true">↳</span>':""}${esc(TIPOS[c.tipo]?TIPOS[c.tipo].nome:c.tipo)}${c.ident&&c.ident.os?` · OS ${esc(c.ident.os)}`:""}${c.ident&&c.ident.chamado?` · Chamado ${esc(c.ident.chamado)}`:""}</span>
        <span class="status ${cls}">${l}</span>
        <span class="m">${fmtData(c.ident&&c.ident.data)} · ${esc((c.antenas||[]).join(", "))} · ${Math.round(progresso(c)*100)}% preenchido</span>
        ${c.continuaDe||cont?`<span class="links">${c.continuaDe?`<span class="lk">Continuação da OS ${esc(c.continuaDe.os)}</span>`:""}${cont?`<span class="lk">Continuada na OS ${esc(cont.os)}</span>`:""}</span>`:""}
      </button>${isOwner?`<button class="del" data-del="${esc(c.id)}" aria-label="Apagar checklist">Apagar</button>`:""}</div>`}).join(""):`<div class="empty">${db?"Nenhum checklist ainda. Comece um atendimento acima.":"O histórico aparece aqui quando você estiver conectado."}</div>`}
    </div>
  </section>`;
  app.querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>novo(b.dataset.new));
  app.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{filter=b.dataset.f;renderHome();});
  app.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>abrir(b.dataset.open));
  app.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>apagar(b.dataset.del));
}

function proximaOS(data,ignorarId){
  const mm=data.slice(5,7), yyyy=data.slice(0,4); const pre="LM"+mm+yyyy; const re=new RegExp("^"+pre+"(\\d{3,})$");
  let max=0; list.forEach(c=>{ if(c.id===ignorarId) return; const m=(c.ident&&c.ident.os||"").match(re); if(m) max=Math.max(max,+m[1]); });
  return pre+String(max+1).padStart(3,"0");
}
async function novo(tipo,base){
  if(!base&&(tipo==="corretiva"||tipo==="emergencial")){ const q=cotaMes(hoje().slice(0,7)); const k=tipo==="corretiva"?"interv":"emerg"; const lim=tipo==="corretiva"?2:1;
    if(q[k]>=lim&&!(await perguntar(`A cota do contrato para ${tipo==="corretiva"?"intervenções técnicas (2 por mês)":"emergenciais (1 por mês, não acumulativa)"} deste mês já foi usada (${q[k]}). Um novo atendimento será cobrado à parte pela contratada. Criar mesmo assim?`,"Criar mesmo assim"))) return; }
  const c = {tipo, status:"rascunho", criadoEm:new Date().toISOString(), criadoPor: me&&me.id||null,
    antenas: TIPOS[tipo].chamado?[]:ANTENAS.map(a=>a.id), ident:{data:hoje(),os:proximaOS(hoje()),tecnicos:"",executor:"",obs:"",chamado:"",problema:"",abertura:"",normalizacao:"",agendamento:""},
    resp:{}, obs:{}, niveis:{}, ncs:[], ncAcoes:{}, materiais:{}, executor:null, avaliador:null};
  if(base){ /* continuação: copia tudo o que já foi registrado no relatório anterior */
    const raiz=base.continuaDe?base.continuaDe.raizOs:base.ident.os; const n=list.filter(x=>x.continuaDe&&x.continuaDe.raizOs===raiz).length+1;
    c.ident=Object.assign({},base.ident,{data:hoje(),os:raiz+"-C"+n,obs:""}); c.antenas=(base.antenas||[]).slice();
    ["resp","obs","niveis","ncAcoes","ajustePend"].forEach(k=>{ if(base[k]) c[k]=JSON.parse(JSON.stringify(base[k])); }); c.ncs=JSON.parse(JSON.stringify(base.ncs||[]));
    c.herdado=Object.keys(base.resp||{}).filter(k=>base.resp[k]==="OK");
    c.continuaDe={id:base.id||curId,os:base.ident.os,raizOs:raiz,raizId:(base.continuaDe&&base.continuaDe.raizId)||base.id||curId,pendente:(base.execucao&&base.execucao.pendente)||""};
    c.execucao={situacao:"completa"}; }
  if(db){
    try{ const ref = await store.add(c); curId=ref.id;
      if(base&&base.id){ try{ const o=list.find(x=>x.id===base.id); if(o){ const ex=Object.assign({},o.execucao,{continuacao:{id:ref.id,os:c.ident.os}}); await store.update(base.id,{execucao:ex}); } }catch(e){} } }
    catch(e){ toast("Não foi possível criar no servidor. Preenchendo sem salvar."); curId="local"; }
  } else curId="local";
  cur=c; curAnt=c.antenas[0]||null; renderChecklist(); window.scrollTo(0,0);
}
async function abrir(id){
  const c = list.find(x=>x.id===id); if(!c) return;
  let completo = c;
  try{ completo = (await api('doc&id='+encodeURIComponent(id))).doc; }catch(e){ toast("Não foi possível abrir o checklist."); return; }
  curId=id; cur=JSON.parse(JSON.stringify(completo)); delete cur.id;
  cur.obs=cur.obs||{}; curAnt = cur.antenas[0]||"RX01"; renderChecklist(); window.scrollTo(0,0);
}

/* ---------- save ---------- */
function agendarSalvar(){
  setSave("Alterações não salvas");
  clearTimeout(saveTimer); saveTimer=setTimeout(salvar,2000);
}
async function salvar(){
  if(isView) return;
  if(!db||curId==="local"||!curId){ setSave(db?"":"Sem conexão: não está sendo salvo"); return; }
  if(saving){ pending=true; return; }
  saving=true; setSave("Salvando…");
  try{ await store.set(curId,cur); setSave("Salvo"); }
  catch(e){ setSave("Falha ao salvar — tente de novo"); console.error(e); }
  saving=false; if(pending){pending=false; salvar();}
}
async function fecharOriginais(){
  if(!db||!cur||!cur.continuaDe||parcial(cur)) return;
  const raiz=cur.continuaDe.raizId, data=cur.ident.data;
  const alvos=list.filter(x=>(x.id===raiz||(x.continuaDe&&x.continuaDe.raizId===raiz))&&x.id!==curId&&parcial(x)&&!x.execucao.retornoFeito);
  for(const o of alvos){ try{ await store.update(o.id,{execucao:Object.assign({},o.execucao,{retornoFeito:data,retornoPor:cur.ident.os})}); }catch(e){} }
  if(alvos.length) toast("Relatório original atualizado: retorno realizado em "+fmtData(data)+".");
}
async function salvarAgora(){
  if(!db||curId==="local"||!curId) return false;
  clearTimeout(saveTimer);
  for(let i=0;i<40&&saving;i++) await new Promise(r=>setTimeout(r,100));
  saving=true; setSave("Salvando…");
  try{ await store.set(curId,cur); setSave("Salvo"); saving=false; return true; }
  catch(e){ console.error(e); setSave("Falha ao salvar"); saving=false; return false; }
}
function setSave(t){const el=document.getElementById("save"); if(el) el.textContent=t;}



/* ---------- PDF ---------- */
function nomeArq(c,ext){ return `${c.tipo==="plus"?"preventiva-plus":c.tipo==="basica"?"preventiva":c.tipo}-${c.ident.data||hoje()}${c.ident.os?"-OS"+c.ident.os:""}${c.ident.chamado?"-CH"+c.ident.chamado:""}.${ext}`.replace(/[^\w.\-]+/g,"_"); }
function encolherAssinatura(src){
  return new Promise(res=>{ if(!src) return res(null); const im=new Image(); im.onload=()=>{ const w=260,h=Math.round(260*im.height/im.width)||70; const cv=document.createElement("canvas"); cv.width=w; cv.height=h; const g=cv.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,w,h); g.drawImage(im,0,0,w,h); res({url:cv.toDataURL("image/jpeg",0.55),w,h}); }; im.onerror=()=>res(null); im.src=src; });
}
async function gerarPDF(c){
  if(!window.jspdf) throw new Error("gerador de PDF indisponível");
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"mm",format:"a4",compress:true});
  const t=TIPOS[c.tipo]; const W=210, M=14, CW=W-2*M; let y=0;
  const L=x=>String(x==null?"":x).replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2022]/g,"-");
  const navy=[14,59,67], cinza=[91,110,114], linha=[207,217,216];
  const cores={OK:[47,125,91],NC:[181,64,47],NA:[124,138,140]};
  const quebra=h=>{ if(y+h>285){ doc.addPage(); y=16; } };
  const titulo=txt=>{ quebra(12); y+=4; doc.setFont("helvetica","bold"); doc.setFontSize(11.5); doc.setTextColor(...navy); doc.text(L(txt),M,y); y+=2; doc.setDrawColor(...navy); doc.setLineWidth(0.5); doc.line(M,y,W-M,y); y+=5; doc.setTextColor(19,38,43); };
  const par=(txt,opt={})=>{ doc.setFont("helvetica",opt.bold?"bold":"normal"); doc.setFontSize(opt.size||9.5); doc.setTextColor(...(opt.cor||[19,38,43])); const ls=doc.splitTextToSize(L(txt),opt.w||CW); ls.forEach(l=>{ quebra(5); doc.text(l,opt.x||M,y); y+=4.3; }); };
  // cabeçalho
  doc.setFillColor(...navy); doc.rect(0,0,W,24,"F");
  let tx=M; const lg=document.getElementById&&document.getElementById("logoImg");
  if(window.__logoData){ try{ doc.addImage(window.__logoData,"PNG",W-M-27.8,4.5,27.8,15); }catch(e){} }
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.text(L(t.nome),tx,11);
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.text(L(`Relatório de manutenção · ${fmtData(c.ident.data)}${c.avaliador?" · Parecer: "+c.avaliador.parecer:""}`),tx,18);

  y=32;
  // identificação em 2 colunas
  const campos=[["Data da execução",fmtData(c.ident.data)],["Nº da OS",c.ident.os],["Antenas",(c.antenas||[]).join(", ")],["Técnicos da contratante",c.ident.tecnicos],["Técnicos da contratada",c.ident.executor||(c.executor&&c.executor.nome)||""]];
  if(c.continuaDe) campos.unshift(["Continuação da OS",c.continuaDe.os]);
  const at=atendimento(c); const tAt=at?fmtDur(at.min)+" (prazo "+fmtPrazo(at.prazo)+")"+(at.estado==="atrasado"?" - fora do prazo":""):"";
  if(t.chamado) campos.push(["Nº do chamado",c.ident.chamado],["Problema relatado",c.ident.problema],["Abertura do chamado",fmtDT(c.ident.abertura)],["Normalização",fmtDT(c.ident.normalizacao)],["Tempo de atendimento",tAt]);
  else campos.push(["Agendamento realizado",fmtDT(c.ident.agendamento)],["Tempo de atendimento",tAt]);
  if(c.ident.obs) campos.push(["Observações",c.ident.obs]);
  for(let i=0;i<campos.length;i+=2){ quebra(10); [campos[i],campos[i+1]].forEach((f,j)=>{ if(!f) return; const x=M+j*(CW/2); doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...cinza); doc.text(L(f[0]).toUpperCase(),x,y); doc.setFontSize(9.5); doc.setTextColor(19,38,43); doc.text(doc.splitTextToSize(L(f[1]||"—"),CW/2-4)[0],x,y+4.2); }); y+=10; }
  // resultado
  const total=c.antenas.length*t.sec.reduce((n,s)=>n+s.it.length,0); const cont={OK:0,NC:0,NA:0};
  Object.keys(c.resp||{}).forEach(k=>{ if(c.antenas.includes(k.split("|")[1])&&cont[c.resp[k]]!=null) cont[c.resp[k]]++; });
  if(!parcial(c)){ quebra(12); y+=2; doc.setFillColor(227,241,233); doc.rect(M,y-4,CW,9,"F"); doc.setFillColor(47,125,91); doc.rect(M,y-4,1.5,9,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(31,92,65); doc.text("ATIVIDADE COMPLETA",M+4,y+1.8); y+=9; }
  if(parcial(c)){ quebra(22); y+=2; doc.setFillColor(251,241,220); doc.setDrawColor(176,122,16); const ex=c.execucao;
    const ls=doc.splitTextToSize(L(`Pendente: ${ex.pendente||"-"}`),CW-8); const h=12+ls.length*4.3+(ex.retorno?4.3:0);
    doc.rect(M,y-4,CW,h,"F"); doc.setFillColor(176,122,16); doc.rect(M,y-4,1.5,h,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(122,84,8); doc.text(L("ATIVIDADE PARCIAL · motivo: "+(ex.motivo||"-")),M+4,y+1);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(19,38,43); ls.forEach((l,i)=>doc.text(l,M+4,y+6+i*4.3));
    if(ex.retorno) doc.text(L("Retorno previsto: "+fmtData(ex.retorno)),M+4,y+6+ls.length*4.3); y+=h+2; }
  titulo("Resultado");
  let bx=M; [["OK",cont.OK],["NC",cont.NC],["NA",cont.NA],["Sem resposta",total-cont.OK-cont.NC-cont.NA]].forEach(([k,v])=>{ doc.setFillColor(...(cores[k]||[200,205,205])); doc.roundedRect(bx,y-4,38,11,1.5,1.5,"F"); doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.text(String(v),bx+4,y+3.5); doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.text(L(k),bx+14,y+3); bx+=42; });
  y+=13;
  // matriz de itens
  titulo("Itens verificados");
  const ants=c.antenas; const colW=Math.min(16,(CW-90)/Math.max(ants.length,1)); const itemW=CW-colW*ants.length;
  const cab=()=>{ quebra(8); doc.setFillColor(220,230,229); doc.rect(M,y-4,CW,6.5,"F"); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(19,38,43); doc.text("Item",M+2,y); ants.forEach((a,i)=>doc.text(a,M+itemW+i*colW+colW/2,y,{align:"center"})); y+=5; };
  cab();
  t.sec.forEach(sec=>{
    quebra(7); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text(L(sec.t),M+1,y+1); y+=5;
    sec.it.forEach(([code,txt])=>{
      doc.setFont("helvetica","normal"); doc.setFontSize(8.5); const ls=doc.splitTextToSize(L(`${code}  ${txt}`),itemW-4); const h=ls.length*3.8+1.6;
      if(y+h>285){ doc.addPage(); y=16; cab(); }
      doc.setTextColor(19,38,43); ls.forEach((l,i)=>doc.text(l,M+2,y+i*3.8));
      ants.forEach((a,i)=>{ const v=(c.resp||{})[code+"|"+a]; doc.setFont("helvetica","bold"); doc.setTextColor(...(cores[v]||[170,178,178])); doc.text(v||"-",M+itemW+i*colW+colW/2,y,{align:"center"}); });
      doc.setDrawColor(...linha); doc.setLineWidth(0.2); doc.line(M,y+h-2.6,W-M,y+h-2.6); y+=h;
    });
  });
  // níveis
  const ajp=c.ajustePend||{}; const nk=[...new Set(Object.keys(c.niveis||{}).concat(Object.keys(ajp).filter(a=>ajp[a]).flatMap(a=>{const z=ANTENAS.find(x=>x.id===a);return z?z.pols.map(p=>a+"|"+p):[];})))].filter(k=>ants.includes(k.split("|")[0])).sort();
  if(t.niveis&&nk.length){
    titulo("Níveis de sinal (dB)");
    const cols=[["Antena",28],["Pol.",16],["C/N antes",34],["C/N depois",34],["Margin antes",35],["Margin depois",35]];
    quebra(8); doc.setFillColor(220,230,229); doc.rect(M,y-4,CW,6.5,"F"); doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(19,38,43);
    let x=M; cols.forEach(([n,w])=>{ doc.text(L(n),x+2,y); x+=w; }); y+=5;
    nk.forEach(k=>{ quebra(6); const [a,p]=k.split("|"); const v=c.niveis[k]; const an=ANTENAS.find(z=>z.id===a);
      const pend=!!ajp[a]; const vv=v||{};
      doc.setFont("helvetica","normal"); doc.setFontSize(9); let x=M; [`${a} ${an?an.sat:""}`,p,vv.antes,pend?"Pendente*":vv.depois,vv.margemAntes,pend?"Pendente*":vv.margemDepois].forEach((val,i)=>{ if(val==="Pendente*"){ doc.setTextColor(176,122,16); doc.setFont("helvetica","bold"); } doc.text(L(val||"-"),x+2,y); doc.setTextColor(19,38,43); doc.setFont("helvetica","normal"); x+=cols[i][1]; });
      doc.setDrawColor(...linha); doc.line(M,y+1.6,W-M,y+1.6); y+=5.5; });
    const pl=Object.keys(ajp).filter(a=>ajp[a]&&ants.includes(a));
    if(pl.length){ y+=1; par(`* Ajuste fino pendente em ${pl.join(", ")}: as medições finais serão registradas após o apontamento fino da antena.`,{cor:[122,84,8],size:8.5}); }
  }
  // NCs
  const lnc=listaNCs(c); titulo("Não conformidades");
  if(!lnc.length) par("Nenhuma.",{cor:cinza});
  lnc.forEach(n=>{ par(`${n.antena} · ${n.item}${n.texto?" — "+n.texto:""}${n.tipoRec?" ["+n.tipoRec+"]":""}`,{bold:true}); par(n.desc||"Sem descrição.",{x:M+4,w:CW-4}); if(n.acao) par("Ação: "+n.acao,{x:M+4,w:CW-4,cor:cinza}); par(n.resolvida==="S"?"Resolvida":"Pendente",{x:M+4,cor:n.resolvida==="S"?cores.OK:cores.NC,size:8.5}); y+=1.5; });
  // observações
  const ob=Object.keys(c.obs||{}).filter(k=>ants.includes(k.split("|")[1])&&(c.resp||{})[k]!=="NC").sort();
  if(ob.length){ titulo("Observações por item"); ob.forEach(k=>{ const [code,a]=k.split("|"); par(`${a} · ${code}: ${c.obs[k]}`); }); }
  // materiais
  const mats=MATERIAIS.filter(m=>(c.materiais||{})[m]);
  // assinaturas
  titulo("Conclusão"); quebra(42);
  const sigs=[await encolherAssinatura(c.avaliador&&c.avaliador.assinatura)];
  [[c.avaliador,"Avaliador",sigs[0]]].forEach(([r,l,img],i)=>{
    const x=M, w=CW/2;
    doc.setDrawColor(...linha); doc.roundedRect(x,y-3,w,38,1.5,1.5,"S");
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...navy); doc.text(l,x+3,y+2);
    doc.setFont("helvetica","normal"); doc.setTextColor(19,38,43);
    if(r){ doc.text(L(`${r.nome} · ${fmtData(r.data)}${r.parecer?" · "+r.parecer:""}`),x+3,y+7);
      if(img){ const ih=Math.min(22,(w-6)*img.h/img.w), iw=ih*img.w/img.h; doc.addImage(img.url,"JPEG",x+3,y+9,iw,ih); } }
    else doc.text("Não assinado",x+3,y+7);
  });
  y+=40;
  if(c.avaliador&&c.avaliador.obs){ par("Observações do avaliador: "+c.avaliador.obs); }
  const n=doc.getNumberOfPages(); for(let i=1;i<=n;i++){ doc.setPage(i); doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...cinza); doc.text(L(`CazéTV · ${t.nome} · ${fmtData(c.ident.data)}`),M,292); doc.text(`${i}/${n}`,W-M,292,{align:"right"}); }
  return doc;
}
function fmtDT(v){ if(!v) return ""; const [d,h]=v.split("T"); return fmtData(d)+(h?" "+esc(h.slice(0,5)):""); }

/* ---------- dashboard ---------- */
function nomeMes(ym){ const n=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]; return n[+ym.slice(5,7)-1]+"/"+ym.slice(2,4); }
function catDe(c){ return (TIPOS[c.tipo]||{}).cat||"preventiva"; }
function minutos(a,b){ if(!a||!b) return null; const d=(new Date(b)-new Date(a))/60000; return isFinite(d)&&d>=0?d:null; }
function fmtDur(m){ if(m==null) return "—"; if(m===0) return "mesmo dia"; if(m<60) return Math.round(m)+" min"; if(m<48*60){ const h=Math.floor(m/60), r=Math.round(m%60); return h+"h"+(r?String(r).padStart(2,"0"):""); } const d=Math.floor(m/1440), h=Math.round((m%1440)/60); return d+(d===1?" dia":" dias")+(h?" "+h+"h":""); }
function media(a){ const v=a.filter(x=>x!=null); return v.length?v.reduce((x,y)=>x+y,0)/v.length:null; }
/* prazos: emergencial/corretiva em horas, preventiva e NC em dias */
function prazoMin(c){ return (c.tipo==="emergencial"?sla.emerg_d:c.tipo==="corretiva"?sla.corr_d:sla.preventiva)*1440; }
function fmtPrazo(m){ return m%1440===0&&m>=1440?(m/1440)+(m===1440?" dia":" dias"):fmtDur(m); }
/* SLA de atendimento contado em dias corridos, só com datas */
function difDias(a,b){ const x=new Date(a.slice(0,10)+"T12:00:00"), y=new Date(b.slice(0,10)+"T12:00:00"); return Math.round((y-x)/86400000); }
function atendimento(c){
  const ch=TIPOS[c.tipo]&&TIPOS[c.tipo].chamado;
  const ini=(ch?c.ident.abertura:c.ident.agendamento)||""; if(!ini) return null;
  let fim=ch?((c.ident.normalizacao||"").slice(0,10)||(c.status==="concluido"?c.ident.data:null)):(c.status==="concluido"?c.ident.data:null);
  if(ehContinuacao(c)) return null; /* a continuação faz parte do atendimento original */
  /* atividade parcial: o atendimento só termina no retorno, se a causa for da contratada */
  const par=parcial(c); if(par&&respParcial(c)==="contratada") fim=c.execucao.retornoFeito||null;
  const d=difDias(ini,fim||ymdL(new Date())); if(isNaN(d)) return null;
  const pz=prazoMin(c), m=Math.max(0,d)*1440;
  return {min:m,dias:Math.max(0,d),aberto:!fim,parcial:par,prazo:pz,estado:m>pz?"atrasado":m>=pz*0.75?"atencao":"ok"};
}
function idadeNC(n,c){ const ini=(c.avaliador&&c.avaliador.em)||(c.executor&&c.executor.em)||(c.ident.data+"T12:00:00"); const fim=n.resolvida==="S"?(n.resolvidaEm||null):null;
  const m=minutos(ini,fim||new Date().toISOString())||0; const pz=sla.nc_h*60; return {min:m,estado:m>pz?"atrasado":m>pz*0.75?"atencao":"ok",resolvida:n.resolvida==="S"}; }
const COR_EST={ok:"var(--ok)",atencao:"var(--fix)",atrasado:"var(--nc)"};
const TXT_EST={ok:"No prazo",atencao:"Perto do prazo",atrasado:"Fora do prazo"};
function pill(est,txt){ return `<span class="pill" style="background:${COR_EST[est]}">${esc(txt||TXT_EST[est])}</span>`; }
function trimestreDe(d){ return d.getFullYear()+"-T"+(Math.floor(d.getMonth()/3)+1); }
/* data efetiva de entrega: completa = data da execução; parcial só conta depois do retorno */
function dataEfetiva(c){ if(!parcial(c)) return c.ident.data; return c.execucao.retornoFeito||null; }
function cadencia(){
  const prevAll=list.filter(c=>catDe(c)==="preventiva"&&!ehContinuacao(c)&&c.ident&&c.ident.data&&c.status==="concluido");
  const efet=prevAll.filter(c=>dataEfetiva(c)).sort((a,b)=>dataEfetiva(b).localeCompare(dataEfetiva(a)));
  const pend=prevAll.filter(c=>parcial(c)&&!c.execucao.retornoFeito).sort((a,b)=>b.ident.data.localeCompare(a.ident.data));
  const dias=d=>d?Math.floor((new Date()-new Date(d+"T12:00:00"))/86400000):null;
  const somaDias=(d,n)=>{const x=new Date(d+"T12:00:00"); x.setDate(x.getDate()+n); return ymdL(x);};
  const linha=(lista,pends,lim)=>{ const ult=lista[0]; const par=pends.find(c=>!ult||c.ident.data>=dataEfetiva(ult))||null;
    const d=dias(ult&&dataEfetiva(ult)); let est=d==null?"atrasado":d>lim?"atrasado":d>lim-15?"atencao":"ok";
    if(par&&est!=="ok"){ const r=estadoRetorno(par); est=r==="atrasado"?"atrasado":"atencao"; }
    return {ult,par,d,est,data:ult?dataEfetiva(ult):null,prox:ult?somaDias(dataEfetiva(ult),lim):null}; };
  const U=linha(efet,pend,sla.prev_int), P=linha(efet.filter(c=>c.tipo==="plus"),pend.filter(c=>c.tipo==="plus"),sla.plus_int);
  return {U,P,ult:U.ult,ultP:P.ult,dU:U.d,dP:P.d,estU:U.est,estP:P.est,proxU:U.prox,proxP:P.prox};
}
function ymdL(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function renderDash(){
  view="dash"; charts.forEach(c=>c.destroy()); charts=[];
  const agora=new Date(); let ini=null, fim=null;
  if(/^T[1-4]$/.test(periodo)){ const q=+periodo[1]; ini=ymdL(new Date(anoSel,(q-1)*3,1)); fim=ymdL(new Date(anoSel,q*3,0)); }
  else if(periodo==="ano"){ ini=anoSel+"-01-01"; fim=anoSel+"-12-31"; }
  else if(periodo==="12"){ ini=ymdL(new Date(agora.getFullYear(),agora.getMonth()-11,1)); }
  const dados=list.filter(c=>c.ident&&c.ident.data&&(!ini||c.ident.data>=ini)&&(!fim||c.ident.data<=fim));
  const anos=[...new Set(list.map(c=>c.ident&&c.ident.data&&+c.ident.data.slice(0,4)).filter(Boolean).concat([agora.getFullYear()]))].sort((a,b)=>b-a);
  const porCat={preventiva:0,corretiva:0,emergencial:0}; dados.filter(c=>!ehContinuacao(c)).forEach(c=>porCat[catDe(c)]++);
  const plus=dados.filter(c=>c.tipo==="plus").length;
  const andamento=dados.filter(c=>c.status!=="concluido").length;
  // NCs
  const ncsTodas=[]; dados.forEach(c=>{ try{ listaNCs(Object.assign({obs:{},ncs:[],resp:{}},c)).forEach(n=>{ ncsTodas.push(Object.assign({c,idade:idadeNC(n,c)},n)); }); }catch(e){} });
  const ncsPend=ncsTodas.filter(n=>n.resolvida!=="S").sort((a,b)=>b.idade.min-a.idade.min);
  const ncAtras=ncsPend.filter(n=>n.idade.estado==="atrasado").length, ncAten=ncsPend.filter(n=>n.idade.estado==="atencao").length;
  const ncRes=ncsTodas.filter(n=>n.resolvida==="S"&&n.resolvidaEm);
  const tResNC=media(ncRes.map(n=>n.idade.min));
  const ncResNoPrazo=ncRes.filter(n=>n.idade.min<=sla.nc_h*60).length;
  const estNC=ncAtras?"atrasado":ncAten?"atencao":"ok";
  // tempos de atendimento
  const ats=dados.map(c=>({c,a:atendimento(c)})).filter(x=>x.a);
  const fechados=ats.filter(x=>!x.a.aberto);
  const abertosAtras=ats.filter(x=>x.a.aberto&&x.a.estado==="atrasado"), abertosAten=ats.filter(x=>x.a.aberto&&x.a.estado==="atencao");
  const slaBase=fechados.length+abertosAtras.length, slaOk=fechados.filter(x=>x.a.min<=x.a.prazo).length;
  const slaPct=slaBase?Math.round(100*slaOk/slaBase):null;
  const linhaT=k=>{ const xs=ats.filter(x=>catDe(x.c)===k); const fe=xs.filter(x=>!x.a.aberto);
    const med=media(fe.map(x=>x.a.min)); const noPrazo=fe.filter(x=>x.a.min<=x.a.prazo).length; const atrasAbertos=xs.filter(x=>x.a.aberto&&x.a.estado==="atrasado").length;
    const pz=(k==="preventiva"?sla.preventiva:k==="corretiva"?sla.corr_d:sla.emerg_d)*1440; const est=med==null?(atrasAbertos?"atrasado":"ok"):(med>pz||atrasAbertos?"atrasado":med>pz*0.75?"atencao":"ok");
    return {k,med,noPrazo,tot:fe.length,atrasAbertos,pz,est,semDados:!xs.length}; };
  const tempos=["emergencial","corretiva","preventiva"].map(linhaT);
  const foraPrazo=ats.filter(x=>x.a.estado!=="ok").sort((a,b)=>(b.a.min/b.a.prazo)-(a.a.min/a.a.prazo));
  // indisponibilidade (emergenciais: abertura até normalização)
  const indisp=dados.filter(c=>c.tipo==="emergencial").map(c=>minutos(c.ident.abertura,c.ident.normalizacao)).filter(x=>x!=null).reduce((a,b)=>a+b,0);
  // reincidência: corretiva/emergencial na mesma antena até N dias após outra
  const falhas=list.filter(c=>TIPOS[c.tipo]&&TIPOS[c.tipo].chamado&&c.ident&&c.ident.data).sort((a,b)=>a.ident.data.localeCompare(b.ident.data));
  const reinc=[]; falhas.forEach((c,i)=>{ if(!dados.includes(c)) return; const ant=falhas.slice(0,i).filter(p=>(p.antenas||[]).some(a=>(c.antenas||[]).includes(a))&&minutos(p.ident.data+"T00:00",c.ident.data+"T00:00")<=sla.reinc_d*1440); if(ant.length) reinc.push({c,ant:ant[ant.length-1]}); });
  const nFalhas=dados.filter(c=>TIPOS[c.tipo]&&TIPOS[c.tipo].chamado).length;
  const reincPct=nFalhas?Math.round(100*reinc.length/nFalhas):null;
  // cumprimento das preventivas por trimestre
  const qIni=(()=>{ const first=list.filter(c=>c.ident&&c.ident.data).map(c=>c.ident.data).sort()[0]; const base=sla.inicio||first; return base?new Date(base+"T12:00:00"):agora; })();
  const qsAll=[]; for(let d=new Date(qIni.getFullYear(),Math.floor(qIni.getMonth()/3)*3,1); d<=agora; d=new Date(d.getFullYear(),d.getMonth()+3,1)) qsAll.push(d);
  const qInfo=qsAll.map(d=>{ const key=trimestreDe(d); const fimQ=new Date(d.getFullYear(),d.getMonth()+3,0); const ms=[0,1,2].map(i=>ymdL(new Date(d.getFullYear(),d.getMonth()+i,1)).slice(0,7));
    const prevQ=list.filter(c=>catDe(c)==="preventiva"&&!ehContinuacao(c)&&c.ident&&c.ident.data&&ms.includes(c.ident.data.slice(0,7)));
    const comp=prevQ.filter(c=>!parcial(c)||c.execucao.retornoFeito);
    return {key,label:"T"+(Math.floor(d.getMonth()/3)+1)+"/"+String(d.getFullYear()).slice(2),ini:ymdL(d),fim:ymdL(fimQ),n:comp.length,np:comp.filter(c=>c.tipo==="plus").length,npar:prevQ.length-comp.length,encerrado:fimQ<agora}; });
  const qPer=qInfo.filter(q=>(!ini||q.fim>=ini)&&(!fim||q.ini<=fim));
  const qDev=qPer.filter(q=>q.encerrado||q.n>0);
  const pmPct=qDev.length?Math.round(100*qDev.filter(q=>q.n>0).length/qDev.length):null;
  const qChart=(periodo==="tudo"||periodo==="12"||periodo==="ano")?qPer:qInfo.slice(-8);
  const cad=cadencia();
  const estPct=(v,bom,ruim)=>v==null?"ok":v>=bom?"ok":v>=ruim?"atencao":"atrasado";
  const estPM=pmPct==null?cad.estU:(estPct(pmPct,100,75)==="atrasado"||cad.estU==="atrasado"?"atrasado":estPct(pmPct,100,75)==="atencao"||cad.estU==="atencao"?"atencao":"ok");
  const estSLA=slaPct==null?(abertosAten.length?"atencao":"ok"):estPct(slaPct,90,75), estRe=reincPct==null?"ok":reincPct<=10?"ok":reincPct<=25?"atencao":"atrasado";
  const ajustesPend=[]; list.filter(c=>c.status==="concluido"&&c.ajustePend).forEach(c=>Object.keys(c.ajustePend).filter(a=>c.ajustePend[a]).forEach(a=>{
    const z=ANTENAS.find(x=>x.id===a); const feito=list.some(o=>o!==c&&o.ident&&o.ident.data>=c.ident.data&&(o.criadoEm||"")>(c.criadoEm||"")&&!(o.ajustePend&&o.ajustePend[a])&&z&&z.pols.some(p=>numBR(((o.niveis||{})[a+"|"+p]||{}).depois)!=null));
    if(!feito){ const d=Math.floor((new Date()-new Date(c.ident.data+"T12:00:00"))/86400000); ajustesPend.push({c,a,d,est:d>sla.nc_h/24?"atrasado":d>(sla.nc_h/24)*0.75?"atencao":"ok"}); } }));
  const parciaisPend=list.filter(pendParcial).map(c=>({c,est:estadoRetorno(c)})).sort((a,b)=>(a.c.execucao.retorno||"").localeCompare(b.c.execucao.retorno||""));
  /* cotas mensais do contrato: 2 intervenções técnicas (corretivas) e 1 emergencial, não acumulativa */
  const mesesCota=[...new Set(dados.filter(c=>!ehContinuacao(c)).map(c=>c.ident.data.slice(0,7)).concat([ymdL(agora).slice(0,7)]))].sort().reverse();
  const cotas=mesesCota.map(m=>{ const l=list.filter(c=>c.ident&&(c.ident.data||"").slice(0,7)===m&&!ehContinuacao(c)); return {m,i:l.filter(c=>c.tipo==="corretiva").length,e:l.filter(c=>c.tipo==="emergencial").length}; });
  const cotaAtual=cotas.find(x=>x.m===ymdL(agora).slice(0,7))||{i:0,e:0};
  const excessos=cotas.filter(x=>x.i>2||x.e>1);
  const relPend=[];
  const ult=dados.slice().sort((a,b)=>(b.ident.data||"").localeCompare(a.ident.data||"")).slice(0,10);
  // meses
  const meses=[]; const base=ini?new Date(ini+"T00:00:00"):(dados.length?new Date(dados.map(c=>c.ident.data).sort()[0]+"T00:00:00"):agora);
  const limite=fim?new Date(fim+"T00:00:00"):agora;
  for(let d=new Date(base.getFullYear(),base.getMonth(),1); d<=limite; d=new Date(d.getFullYear(),d.getMonth()+1,1)) meses.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));
  const curto=periodo==="ano"||/^T/.test(periodo);
  const trimDe=m=>"T"+(Math.floor((+m.slice(5)-1)/3)+1)+(curto?"":"/"+m.slice(2,4));
  const nomesMes=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const serieMes=k=>meses.map(m=>dados.filter(c=>catDe(c)===k&&c.ident.data.slice(0,7)===m).length);
  const score=(est,val,tit,sub)=>`<div class="score" style="border-top:5px solid ${COR_EST[est]}"><span class="sc-t">${tit}</span><b style="color:${COR_EST[est]}">${val}</b><span class="legend">${sub}</span></div>`;
  app.innerHTML=`
  <div class="bar"><h2>Contrato de manutenção · indicadores</h2>
    <div class="filters" role="group" aria-label="Período" style="margin:0 0 0 auto;align-items:center">
      <select id="anoSel" aria-label="Ano" class="chip" style="padding:4px 8px">${anos.map(a=>`<option ${a===anoSel?"selected":""}>${a}</option>`).join("")}</select>
      ${[["T1","1º tri"],["T2","2º tri"],["T3","3º tri"],["T4","4º tri"],["ano","Ano"]].map(([k,l])=>`<button class="chip" data-per="${k}" aria-pressed="${periodo===k}">${l}</button>`).join("")}
      <span style="width:1px;height:20px;background:var(--line);margin:0 2px"></span>
      ${[["12","Últimos 12 meses"],["tudo","Tudo"]].map(([k,l])=>`<button class="chip" data-per="${k}" aria-pressed="${periodo===k}">${l}</button>`).join("")}</div></div>
  ${!db?`<div class="notice">Entre com a sua conta da empresa para ver os dados.</div>`:""}
  <div class="contrato-bar"><span><b>Contrato STI Telecom</b> · vigência 03/07/2024 a 03/07/2027 · 1 preventiva por trimestre · 2 intervenções e 1 emergencial por mês · agendamento com 48h</span></div>
  ${cad.estU!=="ok"||cad.estP!=="ok"||ncAtras||parciaisPend.some(x=>x.est==="atrasado")||foraPrazo.some(x=>x.a.estado==="atrasado")?`<div class="alerta">
    <b>Atenção</b>
    <ul>${(()=>{ const li=(x,nome,lim)=>{ if(x.est==="ok") return "";
        if(x.par) return `<li>${nome} de ${fmtData(x.par.ident.data)} foi <b>parcial</b> e aguarda retorno${x.par.execucao.retorno?` (previsto para ${fmtData(x.par.execucao.retorno)}${estadoRetorno(x.par)==="atrasado"?", já vencido":""})`:""}. Só conta como entregue depois do retorno.</li>`;
        if(!x.ult) return `<li>Nenhuma ${nome.toLowerCase()} completa registrada.</li>`;
        return x.est==="atrasado"?`<li>Última ${nome.toLowerCase()} completa há ${x.d} dias (${fmtData(x.data)}). A próxima deveria ter sido feita até ${fmtData(x.prox)}.</li>`:`<li>A próxima ${nome.toLowerCase()} vence em ${fmtData(x.prox)}. Confirme o agendamento com a contratada.</li>`; };
      return (cad.U.par&&cad.U.par===cad.P.par?"":li(cad.U,"Preventiva",sla.prev_int))+li(cad.P,"Preventiva Plus",sla.plus_int); })()}
    ${(()=>{const n=parciaisPend.filter(x=>x.est==="atrasado"&&x.c!==cad.U.par&&x.c!==cad.P.par).length; return n?`<li>${n} atividade(s) parcial(is) com retorno previsto já vencido.</li>`:"";})()}
    ${ncAtras?`<li>${ncAtras>1?ncAtras+" não conformidades passaram":"1 não conformidade passou"} do prazo de ${sla.nc_h}h sem resolução.</li>`:""}
    ${foraPrazo.filter(x=>x.a.aberto&&x.a.estado==="atrasado").length?`<li>${foraPrazo.filter(x=>x.a.aberto&&x.a.estado==="atrasado").length} atendimento(s) em aberto já fora do prazo.</li>`:""}</ul></div>`:""}
  <div class="scores">
    ${score(estPM,pmPct==null?"—":pmPct+"%","Cumprimento das preventivas",pmPct==null?"sem trimestres encerrados no período":`${qDev.filter(q=>q.n>0).length} de ${qDev.length} trimestres com visita · meta 100%`)}
    ${score(estSLA,slaPct==null?"—":slaPct+"%","Atendimentos no prazo (SLA)",slaPct==null?(abertosAten.length?`${abertosAten.length} em andamento perto do prazo`:ats.length?"nenhum atendimento encerrado ainda":"preencha a data do agendamento ou do chamado"):`${slaOk} de ${slaBase} no prazo${abertosAtras.length?` (${abertosAtras.length} em aberto já atrasado${abertosAtras.length>1?"s":""})`:""}${abertosAten.length?` · ${abertosAten.length} perto do prazo`:""} · meta 90%`)}
    ${score(estNC,String(ncsPend.length),"Não conformidades pendentes",`${ncAtras} atrasada${ncAtras===1?"":"s"} · ${ncAten} vencendo · prazo ${sla.nc_h}h`)}
    ${score(estRe,reincPct==null?"—":reincPct+"%","Reincidência de falhas",nFalhas?`${reinc.length} de ${nFalhas} chamados na mesma antena em até ${sla.reinc_d} dias · meta ≤ 10%`:"sem corretivas ou emergenciais no período")}
  </div>
  <div class="dgrid3">
    <section class="card kpi-big" style="margin:0;border-top:5px solid ${COR_EST[cad.estU==="atrasado"||cad.estP==="atrasado"?"atrasado":cad.estU==="atencao"||cad.estP==="atencao"?"atencao":"ok"]}">
      <h3>Cadência das visitas</h3>
      <div class="trow"><span class="dot" style="background:${COR_EST[cad.estU]}"></span><span class="tk">Preventiva</span><span class="tv"><b>${cad.dU==null?"—":cad.dU+" dias"}</b> <span class="legend">desde a última</span></span>
        <span class="tn legend">${cad.ult?`Última completa em ${fmtData(cad.U.data)} · próxima até ${fmtData(cad.proxU)}`:"nenhuma completa"}${cad.U.par?` · <b style="color:var(--fix)">${cad.U.par.tipo==="plus"?"Plus":"preventiva"} parcial em ${fmtData(cad.U.par.ident.data)}, aguardando retorno</b>`:""} · a cada ${sla.prev_int} dias</span></div>
      <div class="trow"><span class="dot" style="background:${COR_EST[cad.estP]}"></span><span class="tk">Plus</span><span class="tv"><b>${cad.dP==null?"—":cad.dP+" dias"}</b> <span class="legend">desde a última</span></span>
        <span class="tn legend">${cad.ultP?`Última completa em ${fmtData(cad.P.data)} · próxima até ${fmtData(cad.proxP)}`:"nenhuma completa"}${cad.P.par?` · <b style="color:var(--fix)">parcial em ${fmtData(cad.P.par.ident.data)}, aguardando retorno</b>`:""} · anual</span></div>
    </section>
    <section class="card kpi-big" style="margin:0;border-top:5px solid ${COR_EST[tempos.some(x=>x.est==="atrasado")?"atrasado":tempos.some(x=>x.est==="atencao")?"atencao":"ok"]}">
      <h3>Tempo de atendimento</h3>
      ${tempos.map(x=>`<div class="trow"><span class="dot" style="background:${x.semDados?"var(--line)":COR_EST[x.est]}"></span>
        <span class="tk">${CATS[x.k].nome}</span>
        <span class="tv"><b>${x.semDados?"—":fmtDur(x.med)}</b> <span class="legend">média · prazo ${fmtPrazo(x.pz)}</span></span>
        <span class="tn legend">${x.tot?`${x.noPrazo}/${x.tot} no prazo`:"sem concluídos"}${x.atrasAbertos?` · <b style="color:var(--nc)">${x.atrasAbertos} em aberto atrasado${x.atrasAbertos>1?"s":""}</b>`:""}</span></div>`).join("")}
    </section>
    <section class="card kpi-big" style="margin:0;border-top:5px solid ${COR_EST[estNC]}">
      <h3>Resolução de não conformidades</h3>
      <div class="ncstats">
        <div><b>${fmtDur(tResNC)}</b><span>tempo médio de resolução</span></div>
        <div><b>${ncRes.length?Math.round(100*ncResNoPrazo/ncRes.length)+"%":"—"}</b><span>resolvidas em até ${sla.nc_h}h</span></div>
        <div><b>${fmtDur(indisp||null)}</b><span>indisponibilidade (emergenciais)</span></div>
        <div><b>${dados.length}</b><span>atendimentos no período${andamento?` · ${andamento} em aberto`:""}</span></div>
      </div>
    </section>
  </div>
  <section class="card"><h3>Cotas do contrato</h3>
    <p class="legend" style="margin:0 0 10px">Por mês: 2 intervenções técnicas (registradas como corretivas) e 1 emergencial, não acumulativa. O que passar disso é cobrado à parte pela contratada. Continuações de relatório não contam.</p>
    <div class="cotas">
      <div class="cota ${cotaAtual.i>2?"exc":cotaAtual.i===2?"cheia":""}"><span>Intervenções técnicas · ${nomeMes(ymdL(agora).slice(0,7))}</span><b>${cotaAtual.i} <small>de 2</small></b><div class="cbar"><i style="width:${Math.min(100,cotaAtual.i/2*100)}%"></i></div></div>
      <div class="cota ${cotaAtual.e>1?"exc":cotaAtual.e===1?"cheia":""}"><span>Emergenciais · ${nomeMes(ymdL(agora).slice(0,7))}</span><b>${cotaAtual.e} <small>de 1</small></b><div class="cbar"><i style="width:${Math.min(100,cotaAtual.e*100)}%"></i></div></div>
    </div>
    ${excessos.length?`<p style="margin:10px 0 0;color:var(--nc)"><b>Meses acima da cota no período:</b> ${excessos.map(x=>`${nomeMes(x.m)} (${x.i>2?(x.i-2)+" intervenção(ões) extra":""}${x.i>2&&x.e>1?", ":""}${x.e>1?(x.e-1)+" emergencial(is) extra":""})`).join(" · ")}. Confira a cobrança avulsa.</p>`:`<p class="legend" style="margin:10px 0 0">Nenhum mês acima da cota no período.</p>`}
  </section>
  <section class="card"><h3>Preventivas por trimestre</h3>
    <p class="legend" style="margin:0 0 8px">Meta: pelo menos 1 visita preventiva completa por trimestre. Amarelo são visitas parciais, que não contam para a meta. Vermelho são trimestres encerrados sem visita completa.</p>
    <div class="chartbox"><canvas id="chTri" aria-label="Preventivas realizadas por trimestre contra a meta"></canvas></div></section>
  <section class="card"><h3>Atendimentos por mês</h3>
    <div class="chartbox"><canvas id="chMes" aria-label="Atendimentos por mês e tipo"></canvas></div></section>
  ${secDesempenho()}
  <div class="pies">
    <section class="card" style="margin:0"><h3>Atendimentos por tipo</h3><div class="piebox"><canvas id="chTipo" aria-label="Distribuição por tipo"></canvas></div></section>
    <section class="card" style="margin:0"><h3>Prazos de atendimento</h3><div class="piebox"><canvas id="chPrazo" aria-label="Situação dos prazos de atendimento"></canvas></div></section>
    <section class="card" style="margin:0"><h3>Não conformidades</h3><div class="piebox"><canvas id="chNC" aria-label="Situação das não conformidades"></canvas></div></section>
  </div>
  <section class="card"><h3>Pendências para cobrar da contratada</h3>
    ${ncsPend.length||foraPrazo.length||parciaisPend.length||ajustesPend.length||relPend.length?`<div class="scroll"><table class="dt"><thead><tr><th>Situação</th><th>O quê</th><th>Data</th><th>Detalhe</th><th>Prazo</th></tr></thead><tbody>
    ${foraPrazo.map(x=>{const c=x.c;const ch=TIPOS[c.tipo]&&TIPOS[c.tipo].chamado;return `<tr data-open="${esc(c.id)}" style="cursor:pointer"><td>${pill(x.a.estado,x.a.aberto?(x.a.parcial?(x.a.estado==="atrasado"?"Parcial, fora do prazo":"Parcial, perto do prazo"):(x.a.estado==="atrasado"?"Em aberto, atrasado":"Em aberto, perto do prazo")):TXT_EST[x.a.estado])}</td><td>${tagTipo(c)} ${esc([c.ident.os,c.ident.chamado].filter(Boolean).join(" / "))}</td><td>${fmtDT(ch?c.ident.abertura:c.ident.agendamento)}</td><td>${x.a.aberto?"Em aberto há "+fmtDur(x.a.min):"Atendimento levou "+fmtDur(x.a.min)}${c.ident.problema?" · "+esc(c.ident.problema):""}</td><td>${fmtPrazo(x.a.prazo)}</td></tr>`}).join("")}
    ${ajustesPend.map(x=>`<tr data-open="${esc(x.c.id)}" style="cursor:pointer"><td>${pill(x.est,"Ajuste fino há "+x.d+(x.d===1?" dia":" dias"))}</td><td><b>${esc(x.a)}</b> ${tagTipo(x.c)} ${esc(x.c.ident.os||"")}</td><td>${fmtData(x.c.ident.data)}</td><td>Ajuste fino pendente: medições finais de C/N e Margin não registradas</td><td>${sla.nc_h}h</td></tr>`).join("")}
    ${relPend.map(x=>`<tr data-open="${esc(x.c.id)}" style="cursor:pointer"><td>${pill(x.est,"Relatório STI há "+x.d+(x.d===1?" dia":" dias"))}</td><td>${tagTipo(x.c)} ${esc(x.c.ident.os||"")}</td><td>${fmtData(x.c.ident.data)}</td><td>Relatório de Recomendações Técnicas da STI ainda não recebido (cláusula 6ª)</td><td>—</td></tr>`).join("")}
    ${parciaisPend.map(x=>{const c=x.c,e=c.execucao;return `<tr data-open="${esc(c.id)}" style="cursor:pointer"><td>${pill(x.est,x.est==="atrasado"?"Parcial, retorno vencido":"Parcial, aguardando retorno")}</td><td>${tagTipo(c)} ${esc(c.ident.os||"")}</td><td>${fmtData(c.ident.data)}</td><td>${esc(e.pendente||"-")}<br><span class="legend">Motivo: ${esc(e.motivo||"-")} · ${respParcial(c)==="contratada"?"responsabilidade da contratada":respParcial(c)==="contratante"?"responsabilidade da LiveMode":"causa externa"}</span></td><td>${e.retorno?"retorno "+fmtData(e.retorno):"sem data"}</td></tr>`}).join("")}
    ${ncsPend.map(n=>`<tr data-open="${esc(n.c.id)}" style="cursor:pointer"><td>${pill(n.idade.estado,"NC há "+fmtDur(n.idade.min))}</td><td><b>${esc(n.antena)} · ${esc(n.item)}</b> ${esc(n.texto||"")}</td><td>${fmtData(n.c.ident.data)}</td><td>${esc(n.desc||"—")}${n.acao?`<br><span class="legend">Ação: ${esc(n.acao)}</span>`:""}</td><td>${sla.nc_h}h</td></tr>`).join("")}
    </tbody></table></div>`:`<p class="legend">Nenhuma pendência no período.</p>`}
  </section>
  ${reinc.length?`<section class="card"><h3>Falhas reincidentes</h3><div class="scroll"><table class="dt"><thead><tr><th>Antena</th><th>Chamado</th><th>Data</th><th>Chamado anterior</th></tr></thead><tbody>
    ${reinc.map(r=>`<tr data-open="${esc(r.c.id)}" style="cursor:pointer"><td>${esc((r.c.antenas||[]).join(", "))}</td><td>${tagTipo(r.c)} ${esc(r.c.ident.chamado||r.c.ident.os||"")}${r.c.ident.problema?`<br><span class="legend">${esc(r.c.ident.problema)}</span>`:""}</td><td>${fmtData(r.c.ident.data)}</td><td>${fmtData(r.ant.ident.data)} · ${esc(r.ant.ident.problema||r.ant.ident.chamado||"")}</td></tr>`).join("")}</tbody></table></div></section>`:""}
  <section class="card"><h3>Últimos atendimentos</h3>
    ${ult.length?`<div class="scroll"><table class="dt"><thead><tr><th>Data</th><th>Tipo</th><th>Antenas</th><th>OS / chamado</th><th>Situação</th></tr></thead><tbody>
    ${ult.map(c=>{const [cls,l]=statusInfo(c);return `<tr data-open="${esc(c.id)}" style="cursor:pointer"><td>${fmtData(c.ident.data)}</td><td>${tagTipo(c)}</td><td>${esc((c.antenas||[]).join(", ")||"—")}</td><td>${esc([c.ident.os,c.ident.chamado].filter(Boolean).join(" / ")||"—")}${c.ident.problema?`<br><span class="legend">${esc(c.ident.problema)}</span>`:""}</td><td><span class="status ${cls}">${l}</span></td></tr>`}).join("")}</tbody></table></div>`:`<p class="legend">Nenhum atendimento no período.</p>`}
  </section>
  ${db?`<details class="card"><summary style="cursor:pointer;font-weight:600">Prazos e metas do contrato (SLA)</summary>
    <div class="grid2" style="margin-top:10px">
      <label class="f">Emergencial: do chamado à normalização (dias)<input type="number" min="0" data-sla="emerg_d" value="${sla.emerg_d}" ${isOwner?"":"disabled"}></label>
      <label class="f">Corretiva: do chamado à normalização (dias)<input type="number" min="0" data-sla="corr_d" value="${sla.corr_d}" ${isOwner?"":"disabled"}></label>
      <label class="f">Preventiva: do agendamento à execução (dias)<input type="number" min="1" data-sla="preventiva" value="${sla.preventiva}" ${isOwner?"":"disabled"}></label>
      <label class="f">Resolução de não conformidade (horas)<input type="number" min="1" data-sla="nc_h" value="${sla.nc_h}" ${isOwner?"":"disabled"}></label>
      <label class="f">Intervalo entre preventivas (dias)<input type="number" min="1" data-sla="prev_int" value="${sla.prev_int}" ${isOwner?"":"disabled"}></label>
      <label class="f">Intervalo entre Plus (dias)<input type="number" min="1" data-sla="plus_int" value="${sla.plus_int}" ${isOwner?"":"disabled"}></label>
      <label class="f">Janela de reincidência (dias)<input type="number" min="1" data-sla="reinc_d" value="${sla.reinc_d}" ${isOwner?"":"disabled"}></label>
      <label class="f">Início do contrato (para contar trimestres)<input type="date" data-sla-d="inicio" value="${esc(sla.inicio||"")}" ${isOwner?"":"disabled"}></label>
    </div>
    <p class="legend" style="margin:8px 0">Amarelo: atendimento acima de 75% do prazo, NC acima de 75% do prazo, ou preventiva a menos de 15 dias do vencimento. Vermelho: prazo vencido.</p>
    <p class="legend" style="margin:0 0 8px">Base: contrato STI Telecom (cláusulas 2ª e 6ª). Emergencial e corretiva em 2 dias pela regra de agendamento com 48h; preventiva trimestral (90 dias). Prazo de agendamento à execução, intervalo da Plus e resolução de NC são metas internas.</p>
    ${isOwner?`<button class="btn primary" id="salvaSla">Salvar prazos</button>`:`<p class="legend">Só o gestor altera os prazos.</p>`}
  </details>`:""}`;
  app.querySelectorAll("[data-per]").forEach(b=>b.onclick=()=>{periodo=b.dataset.per;renderDash();});
  const as=document.getElementById("anoSel"); if(as) as.onchange=()=>{anoSel=+as.value; if(periodo==="12"||periodo==="tudo") periodo="ano"; renderDash();};
  const ss=document.getElementById("salvaSla");
  if(ss) ss.onclick=async()=>{ const v={}; let ok=true; app.querySelectorAll("[data-sla]").forEach(i=>{const n=parseFloat(i.value); if(!(n>0)) ok=false; v[i.dataset.sla]=n;});
    app.querySelectorAll("[data-sla-d]").forEach(i=>{ v[i.dataset.slaD]=i.value||""; });
    if(!ok) return toast("Informe prazos maiores que zero.");
    try{ await store.setSla(v); sla=Object.assign({},sla,v); toast("Prazos salvos."); }catch(e){ toast("Não foi possível salvar os prazos."); } };
  app.querySelectorAll("tr[data-open]").forEach(r=>r.onclick=()=>{view="lista";document.querySelectorAll("[data-view]").forEach(x=>x.toggleAttribute("aria-current",x.dataset.view==="lista"));abrir(r.dataset.open);});
  if(window.Chart){
    const cs=getComputedStyle(document.documentElement); const cor=n=>cs.getPropertyValue(n).trim(); const txt=cor("--muted")||"#5B6E72", grid=cor("--line")||"#CFD9D8";
    const ds=f=>Object.keys(CATS).map(k=>({label:CATS[k].nome,data:f(k),backgroundColor:CATS[k].cor,borderRadius:3}));
    const opt={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{color:txt,boxWidth:12}}},scales:{x:{stacked:true,ticks:{color:txt},grid:{display:false}},y:{stacked:true,beginAtZero:true,ticks:{color:txt,precision:0},grid:{color:grid}}}};
    // trimestres
    const verm=cor("--nc")||"#B5402F";
    charts.push(new Chart(document.getElementById("chTri"),{data:{labels:qChart.map(q=>q.label),datasets:[
      {type:"bar",label:"Preventivas",data:qChart.map(q=>q.n-q.np),backgroundColor:"#5FA8B3",borderRadius:3,stack:"s"},
      {type:"bar",label:"Plus",data:qChart.map(q=>q.np),backgroundColor:"#6B4FA0",borderRadius:3,stack:"s"},
      {type:"bar",label:"Parcial",data:qChart.map(q=>q.npar),backgroundColor:cor("--fix")||"#B07A10",borderRadius:3,stack:"s"},
      {type:"bar",label:"Sem visita",data:qChart.map(q=>q.n===0&&q.encerrado?0.15:0),backgroundColor:verm,stack:"s"},
      {type:"line",label:"Meta",data:qChart.map(()=>1),borderColor:cor("--fix")||"#B07A10",borderDash:[6,4],pointRadius:0,borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{color:txt,boxWidth:12}},tooltip:{callbacks:{label:x=>x.dataset.label==="Sem visita"?(x.raw?"Trimestre encerrado sem preventiva":null):`${x.dataset.label}: ${x.raw}`}}},
        scales:{x:{stacked:true,ticks:{color:txt},grid:{display:false}},y:{stacked:true,beginAtZero:true,suggestedMax:2,ticks:{color:txt,precision:0},grid:{color:grid}}}}}));
    const lab=meses.map((m,i)=>{const mm=+m.slice(5)-1; const nm=nomesMes[mm]+(curto?"":"/"+m.slice(2,4)); return (mm%3===0||i===0)?[nm,trimDe(m)]:[nm,""];});
    charts.push(new Chart(document.getElementById("chMes"),{type:"bar",data:{labels:lab,datasets:ds(serieMes)},options:opt}));
    const pie=(id,labels,data,colors)=>{ const tot=data.reduce((a,b)=>a+b,0); const el=document.getElementById(id);
      if(!tot){ el.parentElement.innerHTML=`<p class="legend" style="text-align:center;margin-top:60px">Sem dados no período.</p>`; return; }
      charts.push(new Chart(el,{type:"doughnut",data:{labels,datasets:[{data,backgroundColor:colors,borderColor:cor("--panel")||"#fff",borderWidth:2}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:"58%",plugins:{legend:{position:"bottom",labels:{color:txt,boxWidth:12,generateLabels:ch=>ch.data.labels.map((l,i)=>({text:`${l}: ${ch.data.datasets[0].data[i]}`,fillStyle:colors[i],strokeStyle:colors[i],fontColor:txt,hidden:false,index:i}))}},
        tooltip:{callbacks:{label:x=>`${x.label}: ${x.raw} (${Math.round(x.raw*100/tot)}%)`}}}}})); };
    pie("chTipo",["Plus","Preventiva","Corretiva","Emergencial"],[plus,porCat.preventiva-plus,porCat.corretiva,porCat.emergencial],["#6B4FA0","#5FA8B3",CATS.corretiva.cor,CATS.emergencial.cor]);
    const est=k=>ats.filter(x=>x.a.estado===k).length;
    pie("chPrazo",["No prazo","Perto do prazo","Fora do prazo"],[est("ok"),est("atencao"),est("atrasado")],[cor("--ok")||"#2F7D5B",cor("--fix")||"#B07A10",verm]);
    const resolv=ncsTodas.filter(n=>n.resolvida==="S").length;
    pie("chNC",["Resolvidas","Pendentes no prazo","Vencendo","Atrasadas"],[resolv,ncsPend.length-ncAtras-ncAten,ncAten,ncAtras],[cor("--na")||"#7C8A8C",cor("--ok")||"#2F7D5B",cor("--fix")||"#B07A10",verm]);
    desenharDesempenho(txt,grid);
  } else app.querySelectorAll(".chartbox").forEach(b=>b.innerHTML=`<p class="legend">Gráfico indisponível.</p>`);
  app.querySelectorAll("[data-ant-sel]").forEach(b=>b.onclick=()=>{antSel=b.dataset.antSel;renderDash();});
  app.querySelectorAll("[data-med-sel]").forEach(b=>b.onclick=()=>{medSel=b.dataset.medSel;renderDash();});
}

/* ---------- desempenho das antenas (histórico de C/N e C/N Margin) ---------- */
function numBR(x){ const n=parseFloat(String(x==null?"":x).replace(",",".")); return isNaN(n)?null:n; }
function fmtNum(n){ return n==null?"—":String(Math.round(n*10)/10).replace(".",","); }
function historicoAntena(id){
  const a=ANTENAS.find(x=>x.id===id); const kA=medSel==="cn"?"antes":"margemAntes", kD=medSel==="cn"?"depois":"margemDepois";
  const vis=list.filter(c=>c.ident&&c.ident.data&&(c.antenas||[]).includes(id)&&a.pols.some(p=>{const v=(c.niveis||{})[id+"|"+p]||{};return numBR(v[kA])!=null||numBR(v[kD])!=null;}))
    .sort((x,y)=>(x.ident.data+(x.criadoEm||"")).localeCompare(y.ident.data+(y.criadoEm||"")));
  return {a,kA,kD,vis};
}
function ultimaTendencia(id,p){
  const {kD,kA,vis}=historicoAntena(id); const vals=vis.map(c=>{const v=(c.niveis||{})[id+"|"+p]||{};return numBR(v[kD])!=null?numBR(v[kD]):numBR(v[kA]);}).filter(x=>x!=null);
  const ult=vals[vals.length-1], ant=vals[vals.length-2]; return {ult:ult==null?null:ult,delta:ult!=null&&ant!=null?Math.round((ult-ant)*10)/10:null};
}
function secDesempenho(){
  const {a,kA,kD,vis}=historicoAntena(antSel);
  const seta=d=>d==null?"":d>0?`<span style="color:var(--ok)">▲ ${fmtNum(d)}</span>`:d<0?`<span style="color:var(--nc)">▼ ${fmtNum(-d)}</span>`:`<span class="legend">= 0</span>`;
  return `<section class="card"><h3>Desempenho das antenas</h3>
    <p class="legend" style="margin:0 0 10px">Histórico completo das medições registradas nos checklists, independente do período escolhido. A seta compara a última medição com a visita anterior.</p>
    <div class="antcards">${ANTENAS.map(x=>`<button class="antcard" data-ant-sel="${x.id}" aria-pressed="${x.id===antSel}"><b>${x.id}</b><small>${x.sat}</small>
      ${x.pols.map(p=>{const t=ultimaTendencia(x.id,p);return `<span class="ac-l">${p}: <b>${fmtNum(t.ult)}</b> ${seta(t.delta)}</span>`}).join("")}</button>`).join("")}</div>
    <div class="bar" style="margin:12px 0 6px"><b>${a.id} · ${a.sat}</b>
      <div class="filters" role="group" aria-label="Medida" style="margin:0 0 0 auto">${[["cn","C/N"],["mg","C/N Margin"]].map(([k,l])=>`<button class="chip" data-med-sel="${k}" aria-pressed="${medSel===k}">${l}</button>`).join("")}</div></div>
    ${vis.length?`<div class="chartbox"><canvas id="chDes" aria-label="Histórico de ${medSel==="cn"?"C/N":"C/N Margin"} da ${a.id}"></canvas></div>
    <div class="scroll" style="margin-top:10px"><table class="dt"><thead><tr><th>Data</th><th>Tipo</th><th>OS</th>${a.pols.map(p=>`<th>${p} antes</th><th>${p} depois</th>`).join("")}</tr></thead><tbody>
    ${vis.slice().reverse().map(c=>`<tr data-open="${esc(c.id)}" style="cursor:pointer"><td>${fmtData(c.ident.data)}</td><td>${tagTipo(c)}</td><td>${esc(c.ident.os||"—")}</td>${a.pols.map(p=>{const v=(c.niveis||{})[a.id+"|"+p]||{};return `<td>${fmtNum(numBR(v[kA]))}</td><td><b>${fmtNum(numBR(v[kD]))}</b></td>`}).join("")}</tr>`).join("")}</tbody></table></div>`
    :`<p class="legend">Ainda não há medições de ${medSel==="cn"?"C/N":"C/N Margin"} registradas para a ${a.id}.</p>`}
  </section>`;
}
function desenharDesempenho(txt,grid){
  const el=document.getElementById("chDes"); if(!el||!window.Chart) return;
  const {a,kA,kD,vis}=historicoAntena(antSel);
  const cores=["#1F6F7A","#C2861A"];
  const labels=vis.map(c=>fmtData(c.ident.data).slice(0,5)+"/"+c.ident.data.slice(2,4));
  const ds=[]; a.pols.forEach((p,i)=>{
    ds.push({label:`${p} depois`,data:vis.map(c=>numBR(((c.niveis||{})[a.id+"|"+p]||{})[kD])),borderColor:cores[i],backgroundColor:cores[i],tension:.25,spanGaps:true,pointRadius:4});
    ds.push({label:`${p} antes`,data:vis.map(c=>numBR(((c.niveis||{})[a.id+"|"+p]||{})[kA])),borderColor:cores[i],backgroundColor:"transparent",borderDash:[5,4],tension:.25,spanGaps:true,pointRadius:3,pointStyle:"rectRot"});
  });
  charts.push(new Chart(el,{type:"line",data:{labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{position:"bottom",labels:{color:txt,boxWidth:14}},tooltip:{callbacks:{label:x=>`${x.dataset.label}: ${fmtNum(x.raw)} dB`,title:it=>{const c=vis[it[0].dataIndex];return `${fmtData(c.ident.data)} · ${TIPOS[c.tipo]?TIPOS[c.tipo].nome:c.tipo}${c.ident.os?" · "+c.ident.os:""}`;}}}},
    scales:{x:{ticks:{color:txt},grid:{display:false}},y:{ticks:{color:txt,callback:v=>String(v).replace(".",",")},grid:{color:grid},title:{display:true,text:"dB",color:txt}}}}}));
}
function tagTipo(c){ const k=catDe(c); const t=TIPOS[c.tipo]; return `<span class="tag" style="background:${c.tipo==="plus"?"#6B4FA0":CATS[k].cor}">${esc(c.tipo==="plus"?"Plus":c.tipo==="basica"?"Preventiva":t?t.nome:c.tipo)}</span>`; }

/* ---------- checklist ---------- */
function travadoExec(){ return cur.status==="concluido" || isView; }
function aplicarSomenteLeitura(){
  app.querySelectorAll("input,select,textarea,[data-code],#allok,#addnc,[data-exec],[data-delnc],#avOk,#avLimpa,#btnCont,#tecBtn").forEach(el=>{ el.disabled=true; });
}
function renderChecklist(){
  const t = TIPOS[cur.tipo]; const lock = travadoExec();
  const [cls,l]=statusInfo(cur);
  app.innerHTML = `
  <div class="bar">
    <button class="btn link" id="voltar">‹ Voltar à lista</button>${isOwner&&curId&&curId!=="local"?`<button class="btn" id="apagarAtual" style="margin-left:auto;color:var(--nc)">Apagar checklist</button>`:""}
  </div>
  <div class="bar" style="margin-top:0">
    <h2>${esc(t.nome)}</h2><span class="status ${cls}">${l}</span><span class="save" id="save"></span>
  </div>
  ${cur.continuaDe?`<div class="cont-box" style="margin:0 0 12px">Continuação da <b>OS ${esc(cur.continuaDe.os)}</b>.${cur.continuaDe.pendente?` Pendente no relatório anterior: <i>${esc(cur.continuaDe.pendente)}</i>`:""} Os itens marcados com <span class="herd">anterior</span> vieram de lá e podem ser revisados. <button type="button" class="btn" data-abre-orig="${esc(cur.continuaDe.id)}">Ver relatório anterior</button></div>`:""}
  <div style="display:none">
  </div>
  ${lock?`<div class="notice">Checklist concluído. Os itens estão travados. A ação e a situação das não conformidades continuam editáveis para acompanhar a resolução.</div>`:""}
  <section class="card">
    <h3>Identificação</h3>
    <div class="grid2">
      ${TIPOS[cur.tipo].chamado?`<label class="f">Abertura do chamado (e-mail à contratada)<input type="date" data-id="abertura" value="${esc((cur.ident.abertura||"").slice(0,10))}" ${lock?"disabled":""}></label>`
        :`<label class="f">Agendamento realizado<input type="date" data-id="agendamento" value="${esc(cur.ident.agendamento||"")}" ${lock?"disabled":""}></label>`}
      <label class="f">Nº da OS<input data-id="os" value="${esc(cur.ident.os)}" readonly title="Gerado automaticamente: LM + mês + ano + sequência" style="background:var(--soft);font-weight:600"></label>
      <label class="f">Data da execução<input type="date" data-id="data" value="${esc(cur.ident.data)}" ${lock?"disabled":""}></label>
      <div class="f-dd"><span>Técnicos da contratante</span>
        ${(()=>{const sel=(cur.ident.tecnicos||"").split(",").map(x=>x.trim()).filter(Boolean); const extras=sel.filter(x=>!EQUIPE.includes(x));
          return `<button type="button" class="dd-btn" id="tecBtn" aria-haspopup="listbox" aria-expanded="false" ${lock?"disabled":""}><span id="tecTxt">${sel.length?esc(sel.join(", ")):'<span class="legend">Selecione</span>'}</span><span aria-hidden="true">▾</span></button>
          <div class="dd-list" id="tecList" role="listbox" aria-multiselectable="true" hidden>${EQUIPE.concat(extras).map(n=>`<label class="dd-opt"><input type="checkbox" data-tec="${esc(n)}" ${sel.includes(n)?"checked":""}> ${esc(n)}</label>`).join("")}</div>`;})()}
      </div>
      <label class="f">Técnicos da contratada<input data-id="executor" placeholder="ex.: nome do técnico que executou" value="${esc(cur.ident.executor||(cur.executor&&cur.executor.nome)||"")}" ${lock?"disabled":""}></label>
      <label class="f">Observações<input data-id="obs" placeholder="ex.: tempo, janela, outros" value="${esc(cur.ident.obs||"")}" ${lock?"disabled":""}></label>
      ${TIPOS[cur.tipo].chamado?`<label class="f">Nº do chamado<input data-id="chamado" value="${esc(cur.ident.chamado||"")}" ${lock?"disabled":""}></label>
      <label class="f">Problema relatado<input data-id="problema" placeholder="ex.: perda de sinal na pol. V" value="${esc(cur.ident.problema||"")}" ${lock?"disabled":""}></label>
      <label class="f">Serviço normalizado<input type="date" data-id="normalizacao" value="${esc((cur.ident.normalizacao||"").slice(0,10))}" ${lock?"disabled":""}></label>`:""}
    </div>
    <p class="legend" style="margin:14px 0 6px">Antenas atendidas</p>
    <div class="ants">${ANTENAS.map(a=>`<label><input type="checkbox" data-ant="${a.id}" ${cur.antenas.includes(a.id)?"checked":""} ${lock?"disabled":""}> ${a.id}</label>`).join("")}</div>
  </section>
    <nav class="tabs" role="tablist" aria-label="Antena">${cur.antenas.map(id=>{const a=ANTENAS.find(x=>x.id===id);const p=progresso(cur,id);return `<button class="tab" role="tab" data-tab="${id}" aria-selected="${id===curAnt}"><b>${id}</b><small>${a.sat}</small><div class="meter"><i style="width:${Math.round(p*100)}%"></i></div></button>`}).join("")}</nav>
  <div id="antbody"></div>
  <section class="card">
    <h3>Não conformidades</h3>
    <div class="nc-list" id="ncs"></div>
    <button class="btn" id="addnc" ${lock?"disabled":""}>Adicionar outra não conformidade</button>
  </section>
  <section class="card" id="assin"></section>`;
  app.querySelectorAll("[data-abre-orig]").forEach(b=>b.onclick=()=>{ salvar(); abrir(b.dataset.abreOrig); });
  document.getElementById("voltar").onclick=()=>{ salvar(); renderHome(); window.scrollTo(0,0); };
  const ap=document.getElementById("apagarAtual"); if(ap) ap.onclick=()=>apagar(curId);
  const tb=document.getElementById("tecBtn"), tl=document.getElementById("tecList");
  if(tb&&tl){
    const fecha=()=>{ tl.hidden=true; tb.setAttribute("aria-expanded","false"); document.removeEventListener("click",fora,true); };
    const fora=e=>{ if(!tl.contains(e.target)&&!tb.contains(e.target)) fecha(); };
    tb.onclick=()=>{ if(tl.hidden){ tl.hidden=false; tb.setAttribute("aria-expanded","true"); setTimeout(()=>document.addEventListener("click",fora,true),0); } else fecha(); };
    tl.querySelectorAll("[data-tec]").forEach(cb=>cb.onchange=()=>{
      const marc=[...tl.querySelectorAll("[data-tec]")].filter(x=>x.checked).map(x=>x.dataset.tec);
      cur.ident.tecnicos=marc.join(", ");
      document.getElementById("tecTxt").innerHTML=marc.length?esc(marc.join(", ")):'<span class="legend">Selecione</span>';
      agendarSalvar(); fecha(); });
  }
  app.querySelectorAll("[data-id]").forEach(i=>i.oninput=()=>{cur.ident[i.dataset.id]=i.value;
    if(i.dataset.id==="data"&&i.value&&!lock&&!cur.continuaDe){ const pre="LM"+i.value.slice(5,7)+i.value.slice(0,4); if(!(cur.ident.os||"").startsWith(pre)){ cur.ident.os=proximaOS(i.value,curId); const o=app.querySelector('[data-id="os"]'); if(o) o.value=cur.ident.os; } }
    agendarSalvar();});

  app.querySelectorAll("[data-ant]").forEach(i=>i.onchange=()=>{
    const id=i.dataset.ant;
    cur.antenas = i.checked ? ANTENAS.map(a=>a.id).filter(x=>x===id||cur.antenas.includes(x)) : cur.antenas.filter(x=>x!==id);
    if(!cur.antenas.includes(curAnt)) curAnt=cur.antenas[0];
    agendarSalvar(); renderChecklist();
  });
  app.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{curAnt=b.dataset.tab;renderChecklist();});
  document.getElementById("addnc").onclick=()=>{cur.ncs.push({antena:curAnt,item:"",desc:"",acao:"",resolvida:"N",auto:false});agendarSalvar();renderNCs();};
  renderAntena(); renderNCs(); renderAssinaturas();
  if(isView) aplicarSomenteLeitura();
}

function renderAntena(){
  const body=document.getElementById("antbody"); if(!body) return;
  if(!curAnt){ body.innerHTML=`<div class="card empty">Selecione ao menos uma antena.</div>`; return; }
  const t=TIPOS[cur.tipo]; const a=ANTENAS.find(x=>x.id===curAnt); const lock=travadoExec();
  let h=lock?"":`<div class="bar" style="margin:6px 0"><span class="legend">OK = conforme · NC = não conforme · NA = não se aplica</span><button class="btn" id="allok" style="margin-left:auto">Marcar o restante como OK</button></div>`;
  if(t.niveis){
    const ajP=!!(cur.ajustePend&&cur.ajustePend[a.id]);
    h+=`<section class="card ${ajP?"aj-pend":""}"><h3>Sinal ${a.id} · ${a.sat} (dB)</h3>
    <label class="aj-chk"><input type="checkbox" id="ajPend" ${ajP?"checked":""} ${lock?"disabled":""}> Ajuste fino pendente nesta antena</label>
    ${ajP?`<p class="aj-msg">O apontamento fino não foi concluído. As medições de "Depois" ficam bloqueadas e saem no relatório como <b>Pendente (ajuste fino)</b>.</p>`:""}
    <div class="scroll"><table class="levels"><thead><tr><th>Pol.</th><th>Medida</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
    ${a.pols.map(p=>{const v=cur.niveis[a.id+"|"+p]||{};const inp=(k)=>{const dep=/epois$/.test(k); return dep&&ajP?`<input value="Pendente" disabled class="aj-in" aria-label="Pendente: ajuste fino">`:`<input inputmode="decimal" data-nv="${p}|${k}" value="${esc(v[k]||"")}" ${lock?"disabled":""}>`;};return `<tr><td rowspan="2"><b>${p}</b></td><td>C/N</td><td>${inp("antes")}</td><td>${inp("depois")}</td></tr><tr><td>C/N Margin</td><td>${inp("margemAntes")}</td><td>${inp("margemDepois")}</td></tr>`}).join("")}
    </tbody></table></div></section>`;
  }
  h+=t.sec.map(s=>`<section class="sec"><div class="sec-h"><h3>${esc(s.t)}</h3></div>
    ${s.it.map(([code,txt])=>{const v=cur.resp[code+"|"+a.id];const ob=cur.obs[code+"|"+a.id]||"";return `<div class="item"><p><span class="code">${code}</span>${esc(txt)}${(cur.herdado||[]).includes(code+"|"+a.id)&&v==="OK"?' <span class="herd">anterior</span>':""}</p>
      <div class="ctl"><div class="seg" role="group" aria-label="${code}">${VALS.map(x=>`<button data-code="${code}" data-v="${x}" aria-pressed="${v===x}" ${lock?"disabled":""}>${x}</button>`).join("")}</div></div>
      ${lock?(ob?`<p class="obstxt">${esc(ob)}</p>`:""):`<div class="obsrow" ${ob||(v&&v!=="OK")?"":"hidden"}><input data-obs="${code}" placeholder="${v&&v!=="OK"?"Por que não está OK?":"Observação sobre "+code+" nesta antena"}" value="${esc(ob)}"></div>`}</div>`}).join("")}
  </section>`).join("");
  body.innerHTML=h;
  body.querySelectorAll("[data-obs]").forEach(i=>i.oninput=()=>{const key=i.dataset.obs+"|"+a.id;if(i.value.trim())cur.obs[key]=i.value;else delete cur.obs[key];
    if(cur.resp[key]==="NC") renderNCs();agendarSalvar();});
  body.querySelectorAll("[data-nv]").forEach(i=>i.addEventListener("input",()=>{ const v=i.value.replace(/[^0-9,.\-]/g,"").replace(/[.,]{2,}/g,","); if(v!==i.value) i.value=v; },true));
  body.querySelectorAll("[data-nv]").forEach(i=>i.oninput=()=>{const [p,k]=i.dataset.nv.split("|");const key=a.id+"|"+p;cur.niveis[key]=Object.assign({},cur.niveis[key],{[k]:i.value});agendarSalvar();});
  const ajc=document.getElementById("ajPend");
  if(ajc) ajc.onchange=()=>{ cur.ajustePend=Object.assign({},cur.ajustePend,{[a.id]:ajc.checked}); if(!ajc.checked) delete cur.ajustePend[a.id];
    if(ajc.checked) a.pols.forEach(p=>{const key=a.id+"|"+p; if(cur.niveis[key]){ delete cur.niveis[key].depois; delete cur.niveis[key].margemDepois; }});
    agendarSalvar(); renderAntena(); };
  body.querySelectorAll("[data-code]").forEach(b=>b.onclick=()=>{
    const key=b.dataset.code+"|"+a.id; const v=b.dataset.v;
    cur.resp[key] = cur.resp[key]===v ? null : v; if(!cur.resp[key]) delete cur.resp[key];
    b.parentElement.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(cur.resp[key]===x.dataset.v)));
    const row=b.closest(".item").querySelector(".obsrow");
    if(row){const inp=row.querySelector("input");const nok=cur.resp[key]&&cur.resp[key]!=="OK";
      inp.placeholder=nok?"Por que não está OK?":"Observação sobre "+b.dataset.code+" nesta antena";
      if(nok){row.hidden=false;if(!inp.value)inp.focus();} else if(!inp.value) row.hidden=true;}
    renderNCs();
    atualizarMeter(); agendarSalvar(); renderAssinaturas();
  });
  const ao=document.getElementById("allok");
  if(ao) ao.onclick=()=>{
    t.sec.forEach(s=>s.it.forEach(([code])=>{const key=code+"|"+a.id; if(!cur.resp[key]) cur.resp[key]="OK";}));
    agendarSalvar(); renderAntena(); atualizarMeter(); renderAssinaturas();
  };
}
function atualizarMeter(){
  app.querySelectorAll("[data-tab]").forEach(b=>{const i=b.querySelector(".meter i");if(i)i.style.width=Math.round(progresso(cur,b.dataset.tab)*100)+"%";});
}
function itemTexto(tipo,code){for(const s of TIPOS[tipo].sec) for(const [k,t] of s.it) if(k===code) return t; return "";}
function listaNCs(c){
  const t=TIPOS[c.tipo]; const out=[]; const acoes=c.ncAcoes||{};
  c.antenas.forEach(a=>t.sec.forEach(s=>s.it.forEach(([code,txt])=>{const k=code+"|"+a;
    if(c.resp[k]==="NC"){ const old=(c.ncs||[]).find(n=>n.auto!==false&&n.antena===a&&n.item===code)||{}; const ac=acoes[k]||{};
      out.push({key:k,auto:true,antena:a,item:code,texto:txt,desc:(c.obs||{})[k]||"",acao:ac.acao!=null?ac.acao:(old.acao||""),resolvida:ac.resolvida||old.resolvida||"N",resolvidaEm:ac.resolvidaEm||old.resolvidaEm||null,tipoRec:ac.tipoRec||old.tipoRec||""});}})));
  (c.ncs||[]).forEach((n,i)=>{ const dup=n.auto!==false&&n.item&&c.resp[n.item+"|"+n.antena]==="NC"; if(!n.auto&&!dup) out.push(Object.assign({},n,{idx:i,auto:false,texto:itemTexto(c.tipo,n.item)})); });
  return out;
}
function renderNCs(){
  const el=document.getElementById("ncs"); if(!el) return; const lock=travadoExec();
  cur.ncAcoes=cur.ncAcoes||{};
  const todas=listaNCs(cur); const autos=todas.filter(n=>n.auto); const manuais=todas.filter(n=>!n.auto);
  const sel=(attr,v)=>`<select ${attr} aria-label="Situação"><option value="N" ${v!=="S"?"selected":""}>Pendente</option><option value="S" ${v==="S"?"selected":""}>Resolvida</option></select>`;
  let h="";
  h+=autos.length?`<div class="nc-auto">${autos.map(n=>`<div class="nca">
      <p class="nca-t"><b>${esc(n.antena)} · ${esc(n.item)}</b> ${esc(n.texto)}</p>
      <p class="nca-d">${n.desc?esc(n.desc):`<span class="legend">Sem observação. Descreva no item ${esc(n.item)} da ${esc(n.antena)}.</span>`}</p>
      <div class="nca-f nca-f3"><select data-nca="${n.key}|tipoRec" aria-label="Tipo de recomendação"><option value="">Tipo…</option><option value="Emergencial" ${n.tipoRec==="Emergencial"?"selected":""}>Emergencial</option><option value="Corretiva" ${n.tipoRec==="Corretiva"?"selected":""}>Corretiva</option></select><input data-nca="${n.key}|acao" placeholder="Ação tomada / proposta" aria-label="Ação" value="${esc(n.acao)}">${sel(`data-nca="${n.key}|resolvida"`,n.resolvida)}</div>
    </div>`).join("")}</div>`
    :`<p class="legend" style="margin-top:0">Nenhum item marcado como NC. Os itens marcados como NC acima aparecem aqui automaticamente, com a observação de cada um.</p>`;
  if(manuais.length) h+=`<p class="legend" style="margin:14px 0 6px">Adicionadas manualmente</p>`+manuais.map(n=>`<div class="ncr">
    <select data-nc="${n.idx}|antena" aria-label="Antena" ${lock?"disabled":""}>${ANTENAS.map(a=>`<option ${n.antena===a.id?"selected":""}>${a.id}</option>`).join("")}</select>
    <input data-nc="${n.idx}|item" placeholder="Item" aria-label="Item" value="${esc(n.item)}" ${lock?"disabled":""}>
    <input data-nc="${n.idx}|desc" placeholder="Descrição" aria-label="Descrição" value="${esc(n.desc)}" ${lock?"disabled":""}>
    <input data-nc="${n.idx}|acao" placeholder="Ação tomada / proposta" aria-label="Ação" value="${esc(n.acao)}">
    ${sel(`data-nc="${n.idx}|resolvida"`,n.resolvida)}
    <button class="x" data-delnc="${n.idx}" aria-label="Remover" ${lock?"disabled":""}>×</button></div>`).join("");
  el.innerHTML=h;
  el.querySelectorAll("[data-nca]").forEach(i=>{const ev=i.tagName==="SELECT"?"onchange":"oninput";i[ev]=()=>{const p=i.dataset.nca.split("|");const key=p[0]+"|"+p[1],k=p[2];cur.ncAcoes[key]=Object.assign({},cur.ncAcoes[key],{[k]:i.value}); if(k==="resolvida"){ if(i.value==="S") cur.ncAcoes[key].resolvidaEm=new Date().toISOString(); else delete cur.ncAcoes[key].resolvidaEm; } agendarSalvar();};});
  el.querySelectorAll("[data-nc]").forEach(i=>{const ev=i.tagName==="SELECT"?"onchange":"oninput";i[ev]=()=>{const [idx,k]=i.dataset.nc.split("|");cur.ncs[+idx][k]=i.value; if(k==="resolvida"){ if(i.value==="S") cur.ncs[+idx].resolvidaEm=new Date().toISOString(); else delete cur.ncs[+idx].resolvidaEm; } agendarSalvar();};});
  el.querySelectorAll("[data-delnc]").forEach(b=>b.onclick=()=>{cur.ncs.splice(+b.dataset.delnc,1);agendarSalvar();renderNCs();});
}

/* ---------- signatures ---------- */
function faltantes(){
  const t=TIPOS[cur.tipo]; let f=0;
  cur.antenas.forEach(a=>t.sec.forEach(s=>s.it.forEach(([code])=>{if(!cur.resp[code+"|"+a]) f++;})));
  return f;
}
function padHTML(id){return `<canvas class="pad" id="${id}" aria-label="Área para assinar com o dedo ou o mouse"></canvas>`;}
function makePad(id){
  const c=document.getElementById(id); if(!c) return null;
  const r=c.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  c.width=Math.round(r.width*dpr); c.height=Math.round(r.height*dpr);
  const g=c.getContext("2d"); g.scale(dpr,dpr); g.lineWidth=2.2; g.lineCap="round"; g.lineJoin="round"; g.strokeStyle="#13262B";
  let drawing=false, has=false, last=null;
  const pos=e=>{const b=c.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];};
  c.onpointerdown=e=>{drawing=true;has=true;last=pos(e);c.setPointerCapture(e.pointerId);};
  c.onpointermove=e=>{if(!drawing)return;const p=pos(e);g.beginPath();g.moveTo(last[0],last[1]);g.lineTo(p[0],p[1]);g.stroke();last=p;};
  c.onpointerup=c.onpointercancel=()=>{drawing=false;};
  return {has:()=>has, clear:()=>{g.clearRect(0,0,c.width,c.height);has=false;},
    png:()=>{const o=document.createElement("canvas");o.width=400;o.height=Math.round(400*c.height/c.width);const og=o.getContext("2d");og.fillStyle="#FFFFFF";og.fillRect(0,0,o.width,o.height);og.drawImage(c,0,0,o.width,o.height);return o.toDataURL("image/jpeg",0.7);}};
}

function renderAssinaturas(){
  const el=document.getElementById("assin"); if(!el) return;
  const av=cur.avaliador, ex=cur.executor, falta=faltantes();
  const prevStatus=cur.status;
  const ex2=cur.execucao||{situacao:"completa"}; const par=ex2.situacao==="parcial"; const fechado=cur.status==="concluido";
  el.innerHTML=`<h3>Conclusão</h3>
  <div class="sig exec-box ${par?"parcial":""}">
    <h4>Situação da atividade</h4>
    ${fechado?`<p class="${par?"":"signed"}" style="margin:0 0 6px">${par?`<b style="color:var(--fix)">Atividade parcial</b> · motivo: ${esc(ex2.motivo||"-")}`:"Atividade completa"}</p>
      ${par?`<p style="margin:0 0 6px"><b>Pendente:</b> ${esc(ex2.pendente||"-")}${ex2.retorno?`<br><b>Retorno previsto:</b> ${fmtData(ex2.retorno)}`:""}</p>
      <p class="legend" style="margin:0 0 8px">${RESP_TXT[RESP_MOTIVO[ex2.motivo]||"neutro"]}</p>
      ${(()=>{ const cont=ex2.continuacao&&list.find(x=>x.id===ex2.continuacao.id);
        if(ex2.retornoFeito) return "";
        if(cont) return `<div class="cont-box">Continuação: <b>OS ${esc(cont.ident.os)}</b> · ${cont.status==="concluido"?(parcial(cont)?"concluída parcial":"concluída"):"em preenchimento"} <button type="button" class="btn" data-abre="${esc(cont.id)}">Abrir continuação</button></div>`;
        return `<div class="cont-box">Para terminar o que ficou pendente, abra um relatório de continuação: ele traz tudo o que já foi registrado aqui. <button type="button" class="btn primary" id="btnCont">Dar continuidade</button></div>`; })()}
      ${ex2.retornoFeito?`<p class="signed" style="margin:0">Retorno realizado em ${fmtData(ex2.retornoFeito)}${ex2.retornoPor?` (OS ${esc(ex2.retornoPor)})`:""}</p>`:""}`:""}`
    :`<div class="seg seg-wide" role="group" aria-label="Situação da atividade"><button type="button" data-exec="completa" aria-pressed="${!par}">Completa</button><button type="button" data-exec="parcial" aria-pressed="${par}">Parcial</button></div>
      <div id="parcialCampos" ${par?"":"hidden"} style="margin-top:10px">
        <div class="grid2">
          <label class="f">Motivo <span class="legend" id="exResp">${ex2.motivo?"· "+RESP_TXT[RESP_MOTIVO[ex2.motivo]||"neutro"]:""}</span><select id="exMotivo"><option value="">Selecione</option>${MOTIVOS_PARCIAL.map(m=>`<option ${ex2.motivo===m?"selected":""}>${m}</option>`).join("")}</select></label>
          <label class="f">Retorno previsto<input type="date" id="exRetorno" value="${esc(ex2.retorno||"")}"></label>
          <label class="f" style="grid-column:1/-1">O que ficou pendente<input id="exPendente" placeholder="ex.: vedação dos flanges da RX03 e RX04 não realizada" value="${esc(ex2.pendente||"")}"></label>
        </div>
      </div>`}
  </div>
  ${ex?`<p class="legend" style="margin:0 0 8px">Registro anterior: execução assinada por ${esc(ex.nome)} em ${fmtData(ex.data)}.</p>`:""}
  <div class="sig">
    <h4>Avaliador</h4>
    ${av?`<p class="signed">${esc(av.parecer)} por ${esc(av.nome)} em ${fmtData(av.data)}</p>${av.obs?`<p>${esc(av.obs)}</p>`:""}<img class="sigimg" src="${esc(av.assinatura)}" alt="Assinatura do avaliador">`:
     `<div class="grid2"><label class="f">Nome<input id="avNome" value="${esc(me.name)}" readonly></label><label class="f">Data<input type="date" id="avData" value="${hoje()}"></label>
      <label class="f">Parecer<select id="avPar"><option>Aprovado</option><option>Aprovado com ressalvas</option><option>Aceite condicionado às pendências do relatório</option><option>Reprovado</option></select></label>
      <label class="f">Observações<input id="avObs"></label></div>
      <p class="legend" style="margin:10px 0 4px">Assine abaixo</p>${padHTML("avPad")}
      <div class="acts"><button class="btn" id="avLimpa">Limpar</button><button class="btn primary" id="avOk">Assinar e concluir</button>
      ${falta?`<span class="legend">${falta} ${falta===1?"item sem resposta":"itens sem resposta"}</span>`:""}</div>`}
  </div>
  <div class="acts" style="margin-top:14px;display:flex;gap:8px"><button class="btn" id="baixar">Baixar PDF</button></div>`;
  el.querySelectorAll("[data-exec]").forEach(b=>b.onclick=()=>{ cur.execucao=Object.assign({},cur.execucao,{situacao:b.dataset.exec});
    el.querySelectorAll("[data-exec]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); document.getElementById("parcialCampos").hidden=b.dataset.exec!=="parcial";
    el.querySelector(".exec-box").classList.toggle("parcial",b.dataset.exec==="parcial"); agendarSalvar(); });
  [["exMotivo","motivo"],["exRetorno","retorno"],["exPendente","pendente"]].forEach(([id,k])=>{ const i=document.getElementById(id); if(i){ const f=()=>{ cur.execucao=Object.assign({situacao:"parcial"},cur.execucao,{[k]:i.value}); agendarSalvar(); }; i.addEventListener("input",f); i.addEventListener("change",f); } });
  const bc=document.getElementById("btnCont"); if(bc) bc.onclick=async()=>{ if(!(await perguntar("Abrir um relatório de continuação? Ele mantém o número desta OS com um final de continuidade (-C1, -C2…), fica ligado a este relatório e já traz os itens, observações, níveis e não conformidades daqui.","Dar continuidade"))) return; const base=Object.assign({id:curId},JSON.parse(JSON.stringify(cur))); await novo(cur.tipo,base); };
  el.querySelectorAll("[data-abre]").forEach(b=>b.onclick=()=>{ salvar(); abrir(b.dataset.abre); });
  const rs=document.getElementById("relSit"), rd=document.getElementById("relData");
  if(rs){ const f=()=>{ cur.relSTI={sit:rs.value,data:rd.value||(rs.value==="S"?hoje():"")}; if(rs.value==="S"&&!rd.value) rd.value=cur.relSTI.data; salvar(); }; rs.onchange=f; rd.addEventListener("input",f); rd.addEventListener("change",f); }
  const em=document.getElementById("exMotivo"); if(em) em.addEventListener("change",()=>{ const r=document.getElementById("exResp"); if(r) r.textContent=em.value?"· "+RESP_TXT[RESP_MOTIVO[em.value]||"neutro"]:""; });
  const rf=document.getElementById("exRetFeito"); if(rf){ const f=()=>{ cur.execucao=Object.assign({},cur.execucao,{retornoFeito:rf.value||null}); salvar(); }; rf.addEventListener("input",f); rf.addEventListener("change",f); }
  if(!av){
    const pad=makePad("avPad");
    document.getElementById("avLimpa").onclick=()=>pad.clear();
    document.getElementById("avOk").onclick=async()=>{
      const nome=document.getElementById("avNome").value.trim();
      if(!nome) return toast("Selecione o nome do avaliador.");
      if(!pad.has()) return toast("Assine no quadro antes de concluir.");
      if(falta && !(await perguntar(`${falta} ${falta===1?"item está":"itens estão"} sem resposta. Concluir mesmo assim?`,"Concluir"))) return;
      if(parcial(cur)){ const e=cur.execucao; if(!e.motivo) return toast("Atividade parcial: selecione o motivo."); if(!(e.pendente||"").trim()) return toast("Atividade parcial: descreva o que ficou pendente."); }
      cur.avaliador={nome,data:document.getElementById("avData").value,parecer:document.getElementById("avPar").value,obs:document.getElementById("avObs").value.trim(),assinatura:pad.png(),userId:me&&me.id||null,em:new Date().toISOString()};
      cur.status="concluido";
      {const b=document.getElementById("avOk"); if(b){b.disabled=true;b.textContent="Salvando…";}}
      salvarAgora().then(ok=>{ if(!ok){ cur.status=prevStatus; cur.avaliador=null; renderChecklist(); perguntar("A conclusão não foi salva. Recarregue a página e assine de novo.",null); return; }
        renderChecklist(); toast("Checklist concluído."); fecharOriginais(); });
    };
  }
  const bx=document.getElementById("baixar");
  if(bx) bx.onclick=async()=>{
    try{ const d=await gerarPDF(cur); d.save(nomeArq(cur,"pdf")); toast("PDF salvo."); }
    catch(e){ if(e&&e.code!=="declined") toast("Não foi possível baixar o relatório."); }
  };
}

/* ---------- report ---------- */
function relatorio(c){
  const t=TIPOS[c.tipo];
  const th=c.antenas.map(a=>`<th>${a}</th>`).join("");
  const cor={OK:"#2F7D5B",NC:"#B5402F",NA:"#7C8A8C"};
  const rows=t.sec.map(s=>`<tr><td colspan="${c.antenas.length+1}" style="background:#0E3B43;color:#fff;font-weight:600">${esc(s.t)}</td></tr>`+
    s.it.map(([code,txt])=>`<tr><td>${code} ${esc(txt)}</td>${c.antenas.map(a=>{const v=c.resp[code+"|"+a]||"";return `<td style="text-align:center;font-weight:600;color:${cor[v]||"#999"}">${v||"—"}${c.obs&&c.obs[code+"|"+a]?"*":""}</td>`}).join("")}</tr>`).join("")).join("");
  const niv=t.niveis?`<h2>Níveis de sinal (dB)</h2><table><tr><th>Antena</th><th>Satélite</th><th>Pol.</th><th>C/N antes</th><th>C/N depois</th><th>Margin antes</th><th>Margin depois</th></tr>${c.antenas.map(id=>{const a=ANTENAS.find(x=>x.id===id);return a.pols.map(p=>{const v=c.niveis[id+"|"+p]||{};return `<tr><td>${id}</td><td>${a.sat}</td><td>${p}</td><td>${esc(v.antes||"")}</td><td>${esc(v.depois||"")}</td><td>${esc(v.margemAntes||"")}</td><td>${esc(v.margemDepois||"")}</td></tr>`}).join("")}).join("")}</table>`:"";
  const obsK=Object.keys(c.obs||{}).filter(k=>c.resp[k]!=="NC");
  const obsT=obsK.length?`<h2>Observações por item</h2><table><tr><th>Antena</th><th>Item</th><th>Observação</th></tr>${obsK.sort().map(k=>{const [code,ant]=k.split("|");return `<tr><td>${esc(ant)}</td><td>${esc(code)}</td><td>${esc(c.obs[k])}</td></tr>`}).join("")}</table>`:"";
  const ncs=obsT+`<h2>Não conformidades</h2>${listaNCs(c).length?`<table><tr><th>Antena</th><th>Item</th><th>Descrição</th><th>Ação</th><th>Situação</th></tr>${listaNCs(c).map(n=>`<tr><td>${esc(n.antena)}</td><td>${esc(n.item)}${n.texto?" — "+esc(n.texto):""}</td><td>${esc(n.desc)}</td><td>${esc(n.acao)}</td><td>${n.resolvida==="S"?"Resolvida":"Pendente"}</td></tr>`).join("")}</table>`:"<p>Nenhuma.</p>"}`;
  const mats="";
  const sig=(r,l)=>r?`<td style="vertical-align:top"><b>${l}</b><br>${esc(r.nome)} · ${fmtData(r.data)}${r.parecer?`<br>Parecer: ${esc(r.parecer)}`:""}${r.obs?`<br>${esc(r.obs)}`:""}<br><img src="${esc(r.assinatura)}" style="max-width:260px;border:1px solid #ccc"></td>`:`<td><b>${l}</b><br>Não assinado</td>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(t.nome)}</title><style>body{font:14px/1.45 Arial,sans-serif;color:#13262B;max-width:900px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%;margin:8px 0 18px}td,th{border:1px solid #CFD9D8;padding:5px 7px;text-align:left}h1{font-size:22px}h2{font-size:17px;margin-top:22px}</style></head><body>
  <h1>${esc(t.nome)}</h1>
  <table><tr><td>Data</td><td>${fmtData(c.ident.data)}</td><td>Nº da OS</td><td>${esc(c.ident.os)}</td></tr><tr><td>Técnicos</td><td>${esc(c.ident.tecnicos)}</td><td>Observações</td><td>${esc(c.ident.obs||[c.ident.clima,c.ident.janela].filter(Boolean).join(" · "))}</td></tr></table>
  <h2>Itens</h2><p>OK = conforme · NC = não conforme · NA = não se aplica</p>
  <table><tr><th>Item</th>${th}</tr>${rows}</table>${niv}${ncs}${mats}
  <h2>Conclusão</h2><table><tr>${sig(c.avaliador,"Avaliador")}</tr></table></body></html>`;
}

async function apagar(id){
  if(!db||!id) return;
  const c=list.find(x=>x.id===id)||(id===curId?cur:null);
  const concl=c&&c.status==="concluido";
  if(!isOwner) return toast("Só o gestor pode apagar checklists.");
  const desc=c?`${TIPOS[c.tipo]?TIPOS[c.tipo].nome:""}${c.ident&&c.ident.os?" · OS "+c.ident.os:""} de ${fmtData(c.ident&&c.ident.data)}`:"este checklist";
  if(!(await perguntar(concl?`Apagar ${desc}? Ele já foi concluído e assinado: as assinaturas, as não conformidades e o registro saem do histórico e do dashboard. Isso não pode ser desfeito.`:`Apagar ${desc}? Isso não pode ser desfeito.`,"Apagar"))) return;
  const aberto=(id===curId);
  if(aberto){ clearTimeout(saveTimer); curId=null; cur=null; }
  try{ await store.del(id); toast("Checklist apagado.");
    /* se era uma continuação, solta a ligação no relatório de origem */
    const o=c&&c.continuaDe&&list.find(x=>x.id===c.continuaDe.id);
    if(o&&o.execucao&&o.execucao.continuacao&&o.execucao.continuacao.id===id){ const ex=Object.assign({},o.execucao); delete ex.continuacao; try{ await store.update(o.id,{execucao:ex}); }catch(e){} } }
  catch(e){ toast("Não foi possível apagar o checklist."); }
  if(aberto||!curId){ renderHome(); window.scrollTo(0,0); }
}
function perguntar(msg,okLabel){
  return new Promise(res=>{
    const o=document.createElement("div"); o.className="modal";
    o.innerHTML=`<div class="modal-box" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="acts">${okLabel?`<button class="btn" data-r="0">Cancelar</button><button class="btn primary" data-r="1">${esc(okLabel)}</button>`:`<button class="btn primary" data-r="0">Entendi</button>`}</div></div>`;
    document.body.appendChild(o);
    o.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{o.remove();res(b.dataset.r==="1");});
    const f=o.querySelector(".btn.primary"); if(f) f.focus();
  });
}
init();
})();
