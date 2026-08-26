// lib/routes/maestro-cron-diario.js - disparado pelo cron da Vercel (vercel.json), NAO por
// sessao de usuario. Roda 06:00 (momento=manha, analisa o dia corrente) e 23:00
// (momento=noite, analisa o dia seguinte), horario de Brasilia. Ver
// Downloads/01_dashboard_diario_encoders.md.
export const config = { maxDuration: 60 };
import { gerarDashboardDiario } from '../booking/relatorio-diario.js';

// mesmo padrao de "string magica como segredo informal" que o antigo api/monitor.js
// ja usava (?token=pulse_monitor_2026) - nao veio de env var nova de proposito.
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

  const momento = req.query.momento === 'noite' ? 'noite' : 'manha';
  const canal = process.env.SLACK_BOOKING_CHANNEL || process.env.SLACK_RH_CHANNEL;

  try {
    const { dataStr, totalEventos, totalEmails, relatorio } = await gerarDashboardDiario(momento);

    if (canal && process.env.SLACK_BOT_TOKEN) {
      const cabecalho = `*📊 Dashboard diário de Booking — ${dataStr}* (${momento === 'manha' ? 'dia corrente' : 'dia seguinte'})\n_${totalEventos} evento(s) no Airtable · ${totalEmails} e-mail(s) técnico(s) recentes_\n\n`;
      await slackPost('chat.postMessage', { channel: canal, text: (cabecalho + relatorio).slice(0, 39000), mrkdwn: true });
    }

    return res.status(200).json({ ok: true, dataStr, momento, totalEventos, totalEmails, postadoNoSlack: !!canal });
  } catch (err) {
    console.error('maestro-cron-diario error:', err);
    if (canal && process.env.SLACK_BOT_TOKEN) {
      await slackPost('chat.postMessage', { channel: canal, text: `⚠️ Falha ao gerar o dashboard diário de Booking (${momento}): ${err.message}` }).catch(() => {});
    }
    return res.status(500).json({ error: err.message });
  }
}
