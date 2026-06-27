// api/fix-gestor.js — Corrige perfis de gestor na planilha
// GET: https://pulse-ia-six.vercel.app/api/fix-gestor?token=pulse_setup_2026
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const GESTORES = ['Guilherme Oliveira', 'Marco Billat', 'Ivan'];
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') return res.status(403).json({error:'Token inválido'});

  const data = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:I50');
  const linhas = data.values || [];
  const log = [];

  // Mostra estado atual
  linhas.forEach((r, i) => {
    log.push(`Linha ${i+2}: nome="${r[0]}" | status="${r[6]||''}" | senhaHash="${r[7]?'[hash]':''}" | perfil="${r[8]||''}"`);
  });

  // Corrige perfil gestor para os três
  for (const [i, r] of linhas.entries()) {
    const nome = (r[0]||'').trim();
    const isGestor = GESTORES.some(g => g.toLowerCase() === nome.toLowerCase());
    if (isGestor && r[8] !== 'gestor') {
      await sheetsRequest(SHEET_ID, `/values/Equipe!I${i+2}?valueInputOption=USER_ENTERED`, 'PUT', {
        values: [['gestor']]
      });
      log.push(`✓ CORRIGIDO: perfil gestor definido para "${nome}" na linha ${i+2}`);
    }
  }

  return res.status(200).json({ ok: true, log });
}
