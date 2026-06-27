// api/setup-sheets.js
// Rode UMA VEZ: GET https://pulse-ia-six.vercel.app/api/setup-sheets?token=pulse_setup_2026

export const config = { maxDuration: 30 };

import { sheetsRequest } from '../lib/google-auth.js';

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  try {
    const spreadsheet = await sheetsRequest(process.env.GOOGLE_SHEET_ID, '');
    const sheets = spreadsheet.sheets || [];
    const abaExiste = sheets.some(s => s.properties.title === 'Ausências');

    if (!abaExiste) {
      await sheetsRequest(process.env.GOOGLE_SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          addSheet: {
            properties: {
              title: 'Ausências',
              gridProperties: { rowCount: 1000, columnCount: 9 }
            }
          }
        }]
      });
    }

    await sheetsRequest(
      process.env.GOOGLE_SHEET_ID,
      `/values/Aus%C3%AAncias!A1:I1?valueInputOption=USER_ENTERED`,
      'PUT',
      { values: [['Registrado Em', 'Nome', 'ID Slack', 'Tipo', 'Data Início', 'Data Fim', 'Dias', 'Observação', 'Status']] }
    );

    return res.status(200).json({
      ok: true,
      message: abaExiste ? 'Aba já existia — cabeçalhos atualizados.' : 'Aba "Ausências" criada com sucesso!'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
