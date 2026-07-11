// api/publicar.js — salva horizonte de publicação da escala
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
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

  const {horizonte}=req.body||{};

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
    return res.status(200).json({ok:true, horizonte:horizonte||''});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
}
