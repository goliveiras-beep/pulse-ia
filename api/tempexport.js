// api/_export_temp.js — export temporário e somente-leitura da Escala planejada de 4
// colaboradores num período fixo, pra comparar com a folha de ponto real. Apagar depois de usar.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const NOMES = ['Alan Veiga', 'Rodrigo Cesar', 'Rodrigo Alcantara', 'Fabio Silva'];

function normalizar(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').trim(); }
function dfParaNum(df) { const [d,m] = String(df||'').split('/').map(Number); return m*100+d; }

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const [escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Escala!A2:F2000'),
    getSheet('Ausências!A2:I500'),
  ]);
  const nomesNorm = NOMES.map(normalizar);

  const linhas = escalaRaw
    .filter(r => r[0] && r[2] && nomesNorm.includes(normalizar(r[2])))
    .filter(r => { const n = dfParaNum(r[0]); return n >= 616 && n <= 715; })
    .map(r => ({ data: r[0], nome: r[2], entrada: r[3]||'', saida: r[4]||'', obs: r[5]||'' }))
    .sort((a,b) => (normalizar(a.nome) < normalizar(b.nome) ? -1 : normalizar(a.nome) > normalizar(b.nome) ? 1 : dfParaNum(a.data) - dfParaNum(b.data)));

  const ausencias = ausenciasRaw
    .filter(a => a[1] && nomesNorm.includes(normalizar(a[1])) && a[0] !== 'CANCELADO')
    .map(a => ({ nome: a[1], tipo: a[2]||'', motivo: a[3]||'', inicio: a[4]||'', fim: a[5]||'', status: a[7]||'' }));

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ totalEscala: linhas.length, linhas, ausencias });
}
