// lib/routes/maestro-cron-plano-europa.js - disparado pelo cron da Vercel, toda segunda
// 11:00 (horario de Brasilia). Ver Downloads/02_plano_semanal_contribuicao_europa.md.
export const config = { maxDuration: 60 };
import { gerarPlanoSemanalEuropa } from '../booking/relatorio-semanal-europa.js';

const CRON_TOKEN = 'pulse_booking_cron_2026';

async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

export default async function handler(req, res) {
  if (req.query.token !== CRON_TOKEN) return res.status(401).json({ error: 'Não autorizado' });

  const canal = process.env.SLACK_BOOKING_CHANNEL || process.env.SLACK_RH_CHANNEL;

  try {
    const { totalEventos, totalEmails, relatorio } = await gerarPlanoSemanalEuropa();

    if (canal && process.env.SLACK_BOT_TOKEN) {
      const cabecalho = `*🇪🇺 Plano semanal de contribuição Europa*\n_${totalEventos} evento(s) no escopo · ${totalEmails} e-mail(s) técnico(s) recentes_\n\n`;
      await slackPost('chat.postMessage', { channel: canal, text: (cabecalho + relatorio).slice(0, 39000), mrkdwn: true });
    }

    return res.status(200).json({ ok: true, totalEventos, totalEmails, postadoNoSlack: !!canal });
  } catch (err) {
    console.error('maestro-cron-plano-europa error:', err);
    if (canal && process.env.SLACK_BOT_TOKEN) {
      await slackPost('chat.postMessage', { channel: canal, text: `⚠️ Falha ao gerar o plano semanal de contribuição Europa: ${err.message}` }).catch(() => {});
    }
    return res.status(500).json({ error: err.message });
  }
}
