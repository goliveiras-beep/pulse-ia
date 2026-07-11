// api/setup-equipe.js
// Rode UMA VEZ: GET https://pulse-ia-six.vercel.app/api/setup-equipe?token=pulse_setup_2026
// Cria a aba "Equipe" na planilha Pulse - Ausências com os colaboradores

export const config = { maxDuration: 30 };

import { sheetsRequest } from '../google-auth.js';

const EQUIPE = [
  ['Rafael Gusmão',   '', 'Operações', '', '', '', 'Ativo'],
  ['Bruno Dias',      '', 'Operações', '', '', '', 'Ativo'],
  ['Rodrigo Rocha',   '', 'Operações', '', '', '', 'Ativo'],
  ['Alan Veiga',      '', 'Operações', '', '', '', 'Ativo'],
  ['Lucas Malveira',  '', 'Operações', '', '', '', 'Ativo'],
  ['Thiago Russo',    '', 'Operações', '', '', '', 'Ativo'],
  ['Jonatas D.',      '', 'Operações', '', '', '', 'Ativo'],
  ['Rodrigo Cesar',   '', 'Operações', '', '', '', 'Ativo'],
  ['Bernardo Oliva',  '', 'Operações', '', '', '', 'Ativo'],
  ['Matheus Ribeiro', '', 'Operações', '', '', '', 'Ativo'],
  ['Fabio Silva',     '', 'Operações', '', '', '', 'Ativo'],
];

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  try {
    // Verifica se aba já existe
    const spreadsheet = await sheetsRequest(SHEET_ID, '');
    const sheets = spreadsheet.sheets || [];
    const abaExiste = sheets.some(s => s.properties.title === 'Equipe');

    if (!abaExiste) {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          addSheet: {
            properties: {
              title: 'Equipe',
              gridProperties: { rowCount: 200, columnCount: 7 }
            }
          }
        }]
      });
    }

    // Cabeçalho + dados
    const valores = [
      ['Nome', 'Cargo', 'Núcleo', 'E-mail', 'Slack ID', 'Regime', 'Status'],
      ...EQUIPE
    ];

    await sheetsRequest(
      SHEET_ID,
      `/values/Equipe!A1:G${valores.length}?valueInputOption=USER_ENTERED`,
      'PUT',
      { values: valores }
    );

    return res.status(200).json({
      ok: true,
      message: `Aba "Equipe" ${abaExiste ? 'atualizada' : 'criada'} com ${EQUIPE.length} colaboradores!`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
