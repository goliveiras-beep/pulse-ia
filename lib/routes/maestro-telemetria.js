// lib/routes/maestro-telemetria.js
// POST: grava uma atualizacao de status manual de telemetria e roda a unica regra
// de alerta do v1 (status_critico) - a acao de baixo risco e so o destaque visual
// no painel (ver maestro-painel.js) + o registro em AlertasLog, sem Slack/e-mail.
import { getPulseSession } from '../maestro-session.js';
import { appendRowSafe } from '../maestro-sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.redirect(302, '/api/maestro-painel');

  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const { item, categoria, status, observacao, evento } = req.body || {};
  if (!item || !status) return res.redirect(302, '/api/maestro-painel?erro=campos_obrigatorios');

  const timestamp = new Date().toISOString();

  await appendRowSafe('Telemetria', [
    timestamp,
    String(item).trim(),
    categoria || 'Outro',
    status,
    observacao || '',
    session.nome,
    evento || '',
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

  return res.redirect(302, '/api/maestro-painel');
}
