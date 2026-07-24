// api/tempexport.js — export temporário e somente-leitura: total de horas planejadas
// (Escala) de 4 colaboradores num período fixo. Apagar depois de usar.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const NOMES = ['Alan Veiga', 'Rodrigo Cesar de Oliveira Pinheiro', 'Rodrigo Alcantara da Rocha', 'Fabio Silva'];

function normalizar(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').trim(); }
function dfParaNum(df) { const [d,m] = String(df||'').split('/').map(Number); return m*100+d; }
function toMin(h) { if(!h) return null; const [hh,mm] = h.split(':').map(Number); return hh*60+(mm||0); }
function duracaoHoras(ent, sai) {
  const e = toMin(ent), s = toMin(sai);
  if (e===null||s===null) return 0;
  const dur = s > e ? s - e : (1440 - e) + s;
  return dur / 60;
}

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const escalaRaw = await getSheet('Escala!A2:F2000');
  const nomesNorm = NOMES.map(normalizar);

  const linhas = escalaRaw
    .filter(r => r[0] && r[2] && nomesNorm.includes(normalizar(r[2])))
    .filter(r => { const n = dfParaNum(r[0]); return n >= 616 && n <= 715; });

  const resumo = {};
  for (const nome of NOMES) {
    const doNome = linhas.filter(r => normalizar(r[2]) === normalizar(nome));
    let horas = 0, diasTrabalhados = 0, folgas = 0;
    for (const r of doNome) {
      if (!r[3] || !r[4] || r[5] === 'Folga' || r[5] === 'Folga/Ausente') { folgas++; continue; }
      horas += duracaoHoras(r[3], r[4]);
      diasTrabalhados++;
    }
    resumo[nome] = { diasComRegistro: doNome.length, diasTrabalhados, folgas, horasPlanejadas: Math.round(horas*100)/100 };
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ resumo });
}
