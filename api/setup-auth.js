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

    // 1. Cabeçalhos SenhaHash e Perfil na aba Equipe
    const headersRes = await sheetsRequest(SHEET_ID, '/values/Equipe!A1:I1');
    const headers = headersRes.values?.[0] || [];
    if (!headers.includes('SenhaHash')) {
      await sheetsRequest(SHEET_ID, '/values/Equipe!H1:I1?valueInputOption=USER_ENTERED', 'PUT', {
        values: [['SenhaHash', 'Perfil']]
      });
      log.push('✓ Colunas SenhaHash e Perfil adicionadas');
    } else {
      log.push('→ Colunas já existiam');
    }

    // 2. Busca nomes já existentes
    const equipeRes = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:I50');
    const linhas = equipeRes.values || [];
    const nomesExistentes = linhas.map(r => r[0]?.toLowerCase().trim());

    // 3. Adiciona gestores que ainda não existem
    const novos = GESTORES.filter(g => !nomesExistentes.includes(g[0].toLowerCase()));
    if (novos.length > 0) {
      await sheetsRequest(SHEET_ID, '/values/Equipe!A1:append?valueInputOption=USER_ENTERED', 'POST', {
        values: novos
      });
      log.push(`✓ ${novos.length} gestor(es) adicionado(s): ${novos.map(g=>g[0]).join(', ')}`);
    } else {
      log.push('→ Gestores já existiam na planilha');
    }

    // 4. Garante que os gestores existentes têm "gestor" na coluna Perfil
    for (const [i, linha] of linhas.entries()) {
      const nomeGestor = GESTORES.find(g => g[0].toLowerCase() === linha[0]?.toLowerCase().trim());
      if (nomeGestor && linha[8] !== 'gestor') {
        await sheetsRequest(SHEET_ID, `/values/Equipe!I${i+2}?valueInputOption=USER_ENTERED`, 'PUT', {
          values: [['gestor']]
        });
        log.push(`✓ Perfil "gestor" definido para ${linha[0]}`);
      }
    }

    // 5. Cria aba Ajustes se não existir
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
