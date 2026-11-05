// lib/routes/compasso-cron-agenda.js — disparado pelo cron da Vercel (vercel.json), todo dia 06:30 BRT.
// Confere o prazo de TODAS as tarefas do Compasso contra a Agenda do Google de cada responsável e corrige
// o que faltar: tarefa antiga que nunca foi pra agenda, prazo alterado, concluída que ficou lá e, principalmente,
// tarefa atrasada, que sobe pra hoje (em vermelho) até ser atualizada ou concluída.
export const config = { maxDuration: 60 };
import { timingSafeEqual } from 'crypto';
import { reconciliarAgendaCompasso } from '../google-calendar.js';

// Mesmo padrão dos outros crons: CRON_SECRET, que a Vercel manda sozinha como "Authorization: Bearer <valor>".
function autorizacaoCronValida(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const recebido = (req.headers['authorization'] || '').replace(/^Bearer /, '');
  const a = Buffer.from(secret), b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!autorizacaoCronValida(req)) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const r = await reconciliarAgendaCompasso();
    console.log('compasso-cron-agenda', JSON.stringify(r.resumo));
    return res.status(200).json({ ok: true, resumo: r.resumo });
  } catch (err) {
    console.error('compasso-cron-agenda error:', err);
    return res.status(500).json({ error: err.message });
  }
}
