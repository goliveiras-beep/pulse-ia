export const config = { maxDuration: 30 };

async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body)
  });
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = req.body;
  if (body.type === "url_verification") return res.status(200).json({ challenge: body.challenge });
  const event = body.event;
  if (!event || event.subtype || event.bot_id || !event.text || !event.user) return res.status(200).json({ ok: true });
  if (event.channel_type !== "im") return res.status(200).json({ ok: true });

  const userMessage = event.text.trim().toLowerCase();
  const channelId = event.channel;

  // Comando de debug para ver campos
  if (userMessage === "debug campos") {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const filter = `DATESTR({fldRnfbwPVzFiHMqs}) = '${hoje}'`;
    const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    const d = await r.json();
    const f = d.records?.[0]?.fields || {};
    const campos = Object.entries(f).map(([k,v]) => `\`${k}\`: ${JSON.stringify(v).slice(0,50)}`).join("\n");
    await slackPost("chat.postMessage", { channel: channelId, text: `*Campos disponíveis:*\n${campos}`, mrkdwn: true });
    return res.status(200).json({ ok: true });
  }

  await slackPost("chat.postMessage", { channel: channelId, text: "Digite `debug campos` para ver os campos, ou aguarde o fix do local." });
  return res.status(200).json({ ok: true });
}
