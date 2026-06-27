// api/setup-auth.js
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const GESTORES = [
  ['Guilherme Oliveira', '', 'Operações', '', '', '', 'Ativo', '', 'gestor'],
  ['Marco Billat',       '', 'Operações', '', '', '', 'Ativo', '', 'gestor'],
  ['Ivan',               '', 'Operações', '', '', '', 'Ativo', '', 'gestor'],
];

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const log = [];

  try {
    const spreadsheet = await sheetsRequest(SHEET_ID, '');
    const sheets = spreadsheet.sheets || [];

    // 1. Encontra o sheetId da aba Equipe e expande para 9 colunas
    const equipeSheet = sheets.find(s => s.properties.title === 'Equipe');
    if (!equipeSheet) return res.status(500).json({ error: 'Aba Equipe não encontrada', log });

    const equipeSheetId = equipeSheet.properties.sheetId;
    const colAtual = equipeSheet.properties.gridProperties.columnCount;

    if (colAtual < 9) {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: equipeSheetId,
              gridProperties: { columnCount: 9 }
            },
            fields: 'gridProperties.columnCount'
          }
        }]
      });
      log.push(`✓ Aba Equipe expandida de ${colAtual} para 9 colunas`);
    } else {
      log.push('→ Aba Equipe já tinha colunas suficientes');
    }

    // 2. Atualiza cabeçalhos H e I
    await sheetsRequest(SHEET_ID, '/values/Equipe!H1:I1?valueInputOption=USER_ENTERED', 'PUT', {
      values: [['SenhaHash', 'Perfil']]
    });
    log.push('✓ Cabeçalhos SenhaHash e Perfil adicionados');

    // 3. Busca nomes existentes
    const equipeRes = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:I50');
    const linhas = equipeRes.values || [];
    const nomesExistentes = linhas.map(r => r[0]?.toLowerCase().trim());

    // 4. Adiciona gestores que não existem
    const novos = GESTORES.filter(g => !nomesExistentes.includes(g[0].toLowerCase()));
    if (novos.length > 0) {
      await sheetsRequest(SHEET_ID, '/values/Equipe!A1:append?valueInputOption=USER_ENTERED', 'POST', {
        values: novos
      });
      log.push(`✓ Adicionados: ${novos.map(g=>g[0]).join(', ')}`);
    } else {
      log.push('→ Gestores já existiam');
    }

    // 5. Garante perfil gestor para quem já estava na lista
    for (const [i, linha] of linhas.entries()) {
      const isGestor = GESTORES.find(g => g[0].toLowerCase() === linha[0]?.toLowerCase().trim());
      if (isGestor && linha[8] !== 'gestor') {
        await sheetsRequest(SHEET_ID, `/values/Equipe!I${i+2}?valueInputOption=USER_ENTERED`, 'PUT', {
          values: [['gestor']]
        });
        log.push(`✓ Perfil gestor definido para ${linha[0]}`);
      }
    }

    // 6. Cria aba Ajustes se não existir
    const ajustesExiste = sheets.some(s => s.properties.title === 'Ajustes');
    if (!ajustesExiste) {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{ addSheet: { properties: { title: 'Ajustes', gridProperties: { rowCount: 1000, columnCount: 7 } } } }]
      });
      await sheetsRequest(SHEET_ID, '/values/Ajustes!A1:G1?valueInputOption=USER_ENTERED', 'PUT', {
        values: [['Registrado Em', 'Data', 'Colaborador', 'Ação', 'Entrada', 'Saída', 'Observação']]
      });
      log.push('✓ Aba Ajustes criada');
    } else {
      log.push('→ Aba Ajustes já existia');
    }

    return res.status(200).json({ ok: true, log });

  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
