// api/publicar.js — salva horizonte de publicação da escala e sincroniza a Agenda do Google
// de cada colaborador que já autorizou (ver lib/google-calendar.js e Equipe!M)
export const config = { maxDuration: 60 };
import { sheetsRequest } from '../google-auth.js';
import { sincronizarAgendaPessoa } from '../google-calendar.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function hash(s){ return createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32); }
function getSession(req){
  const cookies={};
  (req.headers.cookie||'').split(';').forEach(c=>{const p=c.trim().split('=');cookies[p.shift()]=p.join('=');});
  const t=cookies[COOKIE_NAME]; if(!t) return null;
  try{
    const d=Buffer.from(t,'base64').toString('utf8');
    const last=d.lastIndexOf('|'),sec=d.lastIndexOf('|',last-1);
    const data=d.slice(0,sec),h=d.slice(sec+1,last),ts=d.slice(last+1);
    if(Date.now()-parseInt(ts,10)>7*24*3600*1000) return null;
    if(h!==hash(data+ts)||data.startsWith('~~OAUTH~~')) return null;
    return {nome:data.split('~~')[0]};
  } catch{return null;}
}

async function getSheet(range){
  try{const d=await sheetsRequest(SHEET_ID,`/values/${encodeURIComponent(range)}`);return d.values||[];}
  catch{return [];}
}

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function normalizarNome(s) {
  return String(s||'').toLowerCase()
    .replace(/[áàâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìîï]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c').replace(/ñ/g,'n')
    .trim();
}

// Sincroniza a Agenda do Google de todo colaborador ativo que já autorizou (Equipe!M preenchida),
// do dia de hoje até o horizonte publicado. Roda em paralelo entre pessoas — cada uma é independente.
async function sincronizarTodasAgendas(horizonteStr) {
  const hoje = getBRT();
  hoje.setHours(0,0,0,0);
  let dataFim;
  if (horizonteStr) {
    const [dh, mh] = horizonteStr.split('/').map(Number);
    dataFim = new Date(hoje.getFullYear(), mh - 1, dh);
    if (dataFim < hoje) dataFim.setFullYear(dataFim.getFullYear() + 1); // horizonte vira o ano
  } else {
    dataFim = new Date(hoje); dataFim.setDate(dataFim.getDate() + 14); // sem horizonte definido: sincroniza 14 dias
  }

  const [equipeRaw, escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:M200'),
    getSheet('Escala!A2:F5000'),
    getSheet('Ausências!A2:F500'),
  ]);

  const comAgenda = equipeRaw.filter(r => r[0] && (r[10]||'ativo').toLowerCase() === 'ativo' && r[12]);

  const resultados = await Promise.all(comAgenda.map(async p => {
    const nome = p[0], refreshToken = p[12];
    const nomeNorm = normalizarNome(nome);
    const escalaPessoa = escalaRaw.filter(r => r[2] && normalizarNome(r[2]) === nomeNorm);
    const ausenciasPessoa = ausenciasRaw.filter(r => r[1] && normalizarNome(r[1]) === nomeNorm && String(r[0]||'').startsWith('APROVADO'));
    try {
      await sincronizarAgendaPessoa(refreshToken, nome, escalaPessoa, ausenciasPessoa, hoje, dataFim);
      return { nome, ok: true };
    } catch (e) {
      return { nome, ok: false, erro: e.message };
    }
  }));
  return resultados;
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');

  // GET: retorna horizonte atual
  if(req.method==='GET'){
    const session=getSession(req);
    if(!session) return res.status(401).json({error:'Não autenticado'});
    const cfg=await getSheet('PulseConfig!A2:B20');
    const row=cfg.find(r=>r[0]==='publicacao_horizonte');
    return res.status(200).json({ok:true, horizonte:row?.[1]||''});
  }

  if(req.method!=='POST') return res.status(405).end();

  const session=getSession(req);
  if(!session) return res.status(401).json({error:'Não autenticado'});

  // Verificar gestor
  const eq=await getSheet('Equipe!A2:I200');
  const u=eq.find(r=>r[0]===session.nome);
  if(u?.[8]!=='gestor') return res.status(403).json({error:'Acesso negado'});

  const {horizonte, action}=req.body||{};

  // action=sync: só resincroniza as agendas com o horizonte atual (sem alterá-lo) — botão manual
  if (action === 'sync') {
    try {
      const cfg=await getSheet('PulseConfig!A2:B20');
      const row=cfg.find(r=>r[0]==='publicacao_horizonte');
      const resultados = await sincronizarTodasAgendas(row?.[1]||'');
      return res.status(200).json({ok:true, sincronizados:resultados.filter(r=>r.ok).length, falhas:resultados.filter(r=>!r.ok)});
    } catch(e) {
      return res.status(500).json({error:e.message});
    }
  }

  // Passo 1: garantir que a aba existe (tenta ler, se falhar cria)
  try {
    await sheetsRequest(SHEET_ID,`/values/PulseConfig!A1`);
  } catch(e) {
    // Aba não existe — cria
    try {
      await sheetsRequest(SHEET_ID,':batchUpdate','POST',{
        requests:[{addSheet:{properties:{title:'PulseConfig'}}}]
      });
      await sheetsRequest(SHEET_ID,`/values/PulseConfig!A1:B1?valueInputOption=USER_ENTERED`,'PUT',{values:[['chave','valor']]});
    } catch(e2) {
      // pode já existir numa corrida — ignora
    }
  }

  // Passo 2: upsert publicacao_horizonte
  try {
    const cfg=await getSheet('PulseConfig!A2:B20');
    const idx=cfg.findIndex(r=>r[0]==='publicacao_horizonte');
    if(idx>=0){
      await sheetsRequest(SHEET_ID,`/values/${encodeURIComponent(`PulseConfig!B${idx+2}`)}?valueInputOption=USER_ENTERED`,'PUT',{values:[[horizonte||'']]});
    } else {
      await sheetsRequest(SHEET_ID,`/values/PulseConfig!A:B:append?valueInputOption=USER_ENTERED`,'POST',{values:[['publicacao_horizonte',horizonte||'']]});
    }
    // Passo 3: sincroniza a Agenda do Google de quem já autorizou, refletindo o novo horizonte
    let resultadosSync = [];
    try { resultadosSync = await sincronizarTodasAgendas(horizonte||''); } catch(e) { /* não bloqueia a publicação */ }
    return res.status(200).json({ok:true, horizonte:horizonte||'', sincronizados:resultadosSync.filter(r=>r.ok).length});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
}
