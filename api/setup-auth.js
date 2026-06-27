// api/setup-auth.js
// Rode UMA VEZ: GET https://pulse-ia-six.vercel.app/api/setup-auth?token=pulse_setup_2026
// Adiciona colunas SenhaHash e Perfil na aba Equipe + cria aba Ajustes

export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const log = [];

  try {
    // 1. Busca estrutura atual da planilha
    const spreadsheet = await sheetsRequest(SHEET_ID, '');
    const sheets = spreadsheet.sheets || [];

    // 2. Adiciona cabeçalhos SenhaHash e Perfil na aba Equipe (colunas H e I)
    const equipeHeaders = await sheetsRequest(SHEET_ID, '/values/Equipe!A1:I1');
    const headers = equipeHeaders.values?.[0] || [];

    if (!headers.includes('SenhaHash')) {
      await sheetsRequest(SHEET_ID, '/values/Equipe!H1:I1?valueInputOption=USER_ENTERED', 'PUT', {
        values: [['SenhaHash', 'Perfil']]
      });
      log.push('✓ Colunas SenhaHash e Perfil adicionadas na aba Equipe');
    } else {
      log.push('→ Colunas já existiam na aba Equipe');
    }

    // 3. Define Guilherme como gestor (linha 1 = Rafael, linha 2 = Bruno, etc.)
    // Busca a lista de nomes para encontrar o índice correto
    const equipeData = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:A20');
    const nomes = (equipeData.values || []).map(r => r[0]);

    // Coloca 'gestor' para goliveiras (dono do projeto)
    // Como não sabemos o nome exato, vamos deixar em branco e o usuário define via planilha
    // MAS vamos adicionar Rafael Gusmão como gestor por padrão (primeiro da lista)
    // Na verdade, vamos procurar por nome que contenha "Rafael" ou deixar campo vazio
    // O usuário vai editar diretamente
    log.push('→ Defina "gestor" na coluna I para os gestores na aba Equipe');

    // 4. Cria aba Ajustes se não existir
    const ajustesExiste = sheets.some(s => s.properties.title === 'Ajustes');
    if (!ajustesExiste) {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          addSheet: {
            properties: {
              title: 'Ajustes',
              gridProperties: { rowCount: 1000, columnCount: 7 }
            }
          }
        }]
      });
      await sheetsRequest(SHEET_ID, '/values/Ajustes!A1:G1?valueInputOption=USER_ENTERED', 'PUT', {
        values: [['Registrado Em', 'Data', 'Colaborador', 'Ação', 'Entrada', 'Saída', 'Observação']]
      });
      log.push('✓ Aba Ajustes criada com cabeçalhos');
    } else {
      log.push('→ Aba Ajustes já existia');
    }

    return res.status(200).json({ ok: true, log });

  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
