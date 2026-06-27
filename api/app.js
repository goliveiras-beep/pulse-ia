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
      local:(r.fields['Padrão de Produção aux']||r.fields['Name (from Padrão de Produção)']||(Array.isArray(r.fields['Padrão de Produção'])?r.fields['Padrão de Produção'][0]:''))||'',
    })).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  } catch { return []; }
}

function gerarFraseEncerrado(nomeEvento) {
  const frases = [
    'Esse aqui ja foi, e foi bonito!','Menos um, galera. Segue o baile!','Missao cumprida. Proximo!',
    'Entregue! Pode riscar da lista.','Foi de primeira, sem drama!','Producao entregue com louvor!',
    'Ja era. E foi sucesso!','Passou voando, como devia!','Check! Ta no saco.',
    'Era uma vez... e ja acabou.','Fechou bonito, equipe!','Evento no retrovisor!',
    'Tcharaaaan! Encerrado.','Foi, voltou, deu certo!','Mais um na conta da galera!',
    'Operacao realizada, pode fechar!','Esse a gente dominou!','Sem susto, sem drama. OK!',
    'Cumpriu o horario certinho!','Equipe nota 10 nesse aqui!',
  ];
  const idx = nomeEvento.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % frases.length;
  return frases[idx];
}

async function getFraseDoDia(dataStr) {
  try {
    try {
      const cache = await getSheet('Equipe!K1:L1');
      if (cache?.[0]?.[0] === dataStr && cache?.[0]?.[1]) return cache[0][1];
    } catch {}
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', max_tokens: 80,
        messages: [
          { role: 'system', content: 'Responda com APENAS UMA frase curta de até 6 palavras. Sem explicações, sem listas, sem sugestões. Só a frase. Exemplo: Café na veia, câmera no ar!' },
          { role: 'user', content: `Uma frase curta e animada para equipe de TV. Dia ${dataStr}.` }
        ]
      })
    });
    const d = await r.json();
    const frase = d.choices?.[0]?.message?.content?.trim() || 'Bora que hoje vai ser incrivel!';
    try { await setSheet('Equipe!K1:L1', [[dataStr, frase]]); } catch {}
    return frase;
  } catch { return 'Camera ligada, coração acelerado, vamos nessa!'; }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
