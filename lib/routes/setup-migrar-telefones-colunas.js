// api/setup-migrar-telefones-colunas.js — Migração única: move os dados de Anatel/IMEI/Chip
// que foram gravados como texto na Observação (import inicial da frota de telefones) para as
// colunas dedicadas L:O (Anatel, IMEI eSIM, IMEI Físico, Chip/Telefone) criadas depois.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';
import { TELEFONES } from './setup-equipamentos-lote-telefones.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const LINHA_INICIAL = 435; // linha onde a importação da frota de telefones gravou a 1ª unidade

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', { values });
}

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const log = [];
  try {
    const linhaFinal = LINHA_INICIAL + TELEFONES.length - 1;
    const atuais = await getSheet(`Equipamentos!A${LINHA_INICIAL}:O${linhaFinal}`);

    if (atuais.length !== TELEFONES.length) {
      return res.status(409).json({ error: `Esperava ${TELEFONES.length} linhas em ${LINHA_INICIAL}:${linhaFinal}, encontrei ${atuais.length} — abortando pra não sobrescrever linha errada.`, log });
    }
    for (let i = 0; i < atuais.length; i++) {
      if (atuais[i][1] !== 'Mobile/MoJo') {
        return res.status(409).json({ error: `Linha ${LINHA_INICIAL + i} não é Mobile/MoJo (é "${atuais[i][1]}") — abortando, a planilha pode ter mudado desde o import.`, log });
      }
    }
    log.push(`✓ Confirmado: linhas ${LINHA_INICIAL}-${linhaFinal} são os 25 telefones importados`);

    const obsLimpa = TELEFONES.map(() => ['']);
    await setSheet(`Equipamentos!I${LINHA_INICIAL}:I${linhaFinal}`, obsLimpa);
    log.push('✓ Observação limpa (dados movidos pras colunas dedicadas)');

    const colunas = TELEFONES.map(t => [t.anatel || '', t.imeiEsim || '', t.imeiFisico || '', t.chip || '']);
    await setSheet(`Equipamentos!L${LINHA_INICIAL}:O${linhaFinal}`, colunas);
    log.push(`✓ Anatel/IMEI eSIM/IMEI Físico/Chip gravados em L:O para ${colunas.length} telefones`);

    return res.status(200).json({ ok: true, totalMigrado: colunas.length, log });
  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
