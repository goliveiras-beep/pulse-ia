// lib/routes/maestro-detalhe.js
// GET, sessao humana - devolve a ultima leitura detalhada (TelemetriaDetalhe) de um
// item especifico, pro painel mostrar num "Ver detalhes".
import { getPulseSession } from '../maestro-session.js';
import { getSheet } from '../maestro-sheets.js';

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.status(401).json({ error: 'Sem sessão' });

  const item = String(req.query?.item || '').trim();
  if (!item) return res.status(400).json({ error: 'item é obrigatório' });

  const rows = await getSheet('TelemetriaDetalhe!A2:C');
  const doItem = rows.filter((r) => r[1] === item);
  const ultima = doItem[doItem.length - 1];

  if (!ultima) return res.status(200).json({ encontrado: false });

  let detalhe = {};
  try {
    detalhe = JSON.parse(ultima[2] || '{}');
  } catch {
    detalhe = {};
  }

  return res.status(200).json({ encontrado: true, timestamp: ultima[0], item: ultima[1], detalhe });
}
