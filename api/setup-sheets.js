// api/setup-sheets.js
// Rode UMA VEZ via: GET https://pulse-ia-six.vercel.app/api/setup-sheets?token=pulse_setup_2026
// Cria a aba "Ausências" com cabeçalhos e formatação no Google Sheet configurado

export const config = { maxDuration: 30 };

async function sheetsRequest(path, method = 'GET', body = null) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  try {
    // Verifica se a aba já existe
    const spreadsheet = await sheetsRequest('');
    const sheets = spreadsheet.sheets || [];
    const abaExiste = sheets.some(s => s.properties.title === 'Ausências');

    if (!abaExiste) {
      // Cria a aba
      await sheetsRequest(':batchUpdate', 'POST', {
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

    // Insere cabeçalhos
    await sheetsRequest("/values/Aus%C3%AAncias!A1:I1?valueInputOption=USER_ENTERED", 'PUT', {
      values: [[
        'Registrado Em',
        'Nome',
        'ID Slack',
        'Tipo',
        'Data Início',
        'Data Fim',
        'Dias',
        'Observação',
        'Status'
      ]]
    });

    return res.status(200).json({
      ok: true,
      message: abaExiste
        ? 'Aba "Ausências" já existia — cabeçalhos atualizados.'
        : 'Aba "Ausências" criada com sucesso!'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
