// api/setup-auth.js
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';

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
    // 1. Busca estrutura da planilha
    const spreadsheet = await sheetsRequest(SHEET_ID, '');
    const sheets = spreadsheet.sheets || [];
    const equipeSheet = sheets.find(s => s.properties.title === 'Equipe');
    if (!equipeSheet) return res.status(500).json({ error: 'Aba Equipe não encontrada', log });

    const equipeSheetId = equipeSheet.properties.sheetId;
    const colAtual = equipeSheet.properties.gridProperties?.columnCount || 7;
    log.push(`Colunas atuais da aba Equipe: ${colAtual}`);

    // 2. Expande para 9 colunas via batchUpdate
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: equipeSheetId,
            gridProperties: { columnCount: 9, rowCount: 200 }
          },
          fields: 'gridProperties'
        }
      }]
    });
    log.push('✓ Grid expandido para 9 colunas');

    // 3. Agora escreve cabeçalhos H e I
    await sheetsRequest(SHEET_ID, '/values/Equipe!H1:I1?valueInputOption=USER_ENTERED', 'PUT', {
      values: [['SenhaHash', 'Perfil']]
    });
    log.push('✓ Cabeçalhos SenhaHash e Perfil adicionados');

    // 4. Busca dados existentes
    const equipeRes = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:I50');
    const linhas = equipeRes.values || [];
    const nomesExistentes = linhas.map(r => (r[0]||'').toLowerCase().trim());

    // 5. Adiciona gestores novos
    const novos = GESTORES.filter(g => !nomesExistentes.includes(g[0].toLowerCase()));
    if (novos.length > 0) {
      await sheetsRequest(SHEET_ID, '/values/Equipe!A1:append?valueInputOption=USER_ENTERED', 'POST', {
        values: novos
      });
      log.push(`✓ Adicionados: ${novos.map(g=>g[0]).join(', ')}`);
    } else {
      log.push('→ Todos os gestores já existiam');
    }

    // 6. Garante perfil gestor nos que já existiam
    for (const [i, linha] of linhas.entries()) {
      const isGestor = GESTORES.find(g => g[0].toLowerCase() === (linha[0]||'').toLowerCase().trim());
      if (isGestor && linha[8] !== 'gestor') {
        await sheetsRequest(SHEET_ID, `/values/Equipe!I${i+2}?valueInputOption=USER_ENTERED`, 'PUT', {
          values: [['gestor']]
        });
        log.push(`✓ Perfil gestor definido para ${linha[0]}`);
      }
    }

    // 7. Cria aba Ajustes
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
