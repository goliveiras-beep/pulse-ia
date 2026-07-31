// lib/routes/maestro-comandos-pendentes.js
// GET autenticado por MAESTRO_AGENT_TOKEN (mesmo padrao de maestro-ingest.js) -
// devolve os comandos com Status=Pendente pro agente local buscar e executar.
import { getSheet } from '../maestro-sheets.js';

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.MAESTRO_AGENT_TOKEN || token !== process.env.MAESTRO_AGENT_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const rows = await getSheet('Comandos!A2:H');
  const pendentes = rows
    .map((r, i) => ({
      linha: i + 2, // linha real na planilha (A2 = indice 0 do array + 2)
      timestamp: r[0],
      item: r[1],
      acao: r[2],
      parametro: r[3],
      status: r[4],
      solicitadoPor: r[5],
    }))
    .filter((c) => c.status === 'Pendente');

  return res.status(200).json({ comandos: pendentes });
}
