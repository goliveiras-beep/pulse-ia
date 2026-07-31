// lib/routes/maestro-ingest.js
// POST autenticado (Bearer MAESTRO_AGENT_TOKEN) - usado pelo agente SNMP local
// (maestro-agent/) pra gravar telemetria automatica, sem depender da sessao
// pulse_session (que exige um humano logado). Mesmo padrao seguro de escrita e
// mesma regra status_critico de lib/routes/maestro-telemetria.js.
import { appendRowSafe } from '../maestro-sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.MAESTRO_AGENT_TOKEN || token !== process.env.MAESTRO_AGENT_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const { item, categoria, status, observacao } = req.body || {};
  if (!item || !status) return res.status(400).json({ error: 'item e status são obrigatórios' });

  const timestamp = new Date().toISOString();

  try {
    await appendRowSafe('Telemetria', [
      timestamp,
      String(item).trim(),
      categoria || 'Encoder',
      status,
      observacao || '',
      'Agente SNMP',
      '',
    ]);

    if (status === 'Crítico') {
      await appendRowSafe('AlertasLog', [
        timestamp,
        'status_critico',
        String(item).trim(),
        status,
        'destaque_painel',
      ]);
    }
  } catch (err) {
    console.error('maestro-ingest: falha ao gravar na planilha:', err.message);
    return res.status(500).json({ error: 'Falha ao gravar' });
  }

  return res.status(200).json({ ok: true });
}
