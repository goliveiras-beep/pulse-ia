// lib/routes/maestro-comando-resultado.js
// POST autenticado por MAESTRO_AGENT_TOKEN - o agente local reporta o resultado de um
// comando (Executado/Falhou) depois de tentar o SNMP SET real. Identifica a linha pelo
// numero de linha devolvido em /api/maestro-comandos-pendentes (evita duplicar leitura).
import { updateRow } from '../maestro-sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.MAESTRO_AGENT_TOKEN || token !== process.env.MAESTRO_AGENT_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const { linha, timestamp, item, acao, parametro, status, resultado } = req.body || {};
  if (!linha || !status) return res.status(400).json({ error: 'linha e status são obrigatórios' });

  try {
    await updateRow('Comandos', Number(linha), [
      timestamp || '',
      item || '',
      acao || '',
      parametro || '',
      status,
      req.body.solicitadoPor || '',
      new Date().toISOString(),
      resultado || '',
    ]);
  } catch (err) {
    console.error('maestro-comando-resultado: falha ao atualizar linha:', err.message);
    return res.status(500).json({ error: 'Falha ao gravar' });
  }

  return res.status(200).json({ ok: true });
}
