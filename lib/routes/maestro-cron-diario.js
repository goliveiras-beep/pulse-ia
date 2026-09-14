// lib/routes/maestro-cron-diario.js - disparado pelo cron da Vercel (vercel.json), NAO por
// sessao de usuario. Roda 06:00 (momento=manha, analisa o dia corrente) e 23:00
// (momento=noite, analisa o dia seguinte), horario de Brasilia. Ver
// Downloads/01_dashboard_diario_encoders.md.
export const config = { maxDuration: 60 };
import { timingSafeEqual } from 'crypto';
import { gerarDashboardDiario } from '../booking/relatorio-diario.js';

// Padrao oficial da Vercel pra proteger cron job: variavel de ambiente CRON_SECRET, que a
// Vercel manda automaticamente como header "Authorization: Bearer <valor>" quando ELA MESMA
// chama a rota - nunca aparece na URL nem no vercel.json (achado medio do SentinelaMODE
// 2026-09-14; antes disso o token ficava fixo e visivel no vercel.json, que e publico).
function autorizacaoCronValida(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const recebido = (req.headers['authorization'] || '').replace(/^Bearer /, '');
  const a = Buffer.from(secret), b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

export default async function handler(req, res) {
  if (!autorizacaoCronValida(req)) return res.status(401).json({ error: 'Não autorizado' });

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
