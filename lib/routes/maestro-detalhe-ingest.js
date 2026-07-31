// lib/routes/maestro-detalhe-ingest.js
// POST autenticado por MAESTRO_AGENT_TOKEN - agente manda um snapshot JSON com os
// campos de leitura ampliada (decodificacao, rede, versao de software). Separado de
// maestro-ingest.js pra nao misturar o formato simples de Telemetria com esse JSON maior.
import { appendRowSafe } from '../maestro-sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.MAESTRO_AGENT_TOKEN || token !== process.env.MAESTRO_AGENT_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const { item, detalhe } = req.body || {};
  if (!item || !detalhe) return res.status(400).json({ error: 'item e detalhe são obrigatórios' });

  try {
    await appendRowSafe('TelemetriaDetalhe', [
      new Date().toISOString(),
      String(item).trim(),
      JSON.stringify(detalhe),
    ]);
  } catch (err) {
    console.error('maestro-detalhe-ingest: falha ao gravar:', err.message);
    return res.status(500).json({ error: 'Falha ao gravar' });
  }

  return res.status(200).json({ ok: true });
}
