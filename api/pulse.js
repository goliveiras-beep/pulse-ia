export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.
Responda sempre em português brasileiro. Seja objetivo e amigável. Use formatação Slack: *negrito*, _itálico_, listas com •
Quando apresentar eventos, organize por horário de forma clara e concisa.`;

async function getAirtableEvents() {
  // Usa a view exata + filtra por data de hoje no campo Data c/ Pré
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const filter = `DATESTR({Data c/ Pré}) = '${hoje}'`;
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=50&sort[0][field]=Inicio%20do%20Evento&sort[0][direction]=asc`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  const data = await res.json();
  console.log("HOJE:", hoje, "| TOTAL:", data.records?.length, "| ERRO:", data.error?.message || "nenhum");
  if (data.records?.[0]) console.log("AMOSTRA:", JSON.stringify(data.records[0].fields).slice(0, 300));
  return data.records || [];
}

function formatEvents(records, hoje) {
  if (!records.length) return `Nenhum evento para hoje (${hoje}).`;
  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    const inicio = f["Inicio do Evento"] || "";
    const tipo = f["Tipo de Conteúdo"] || "";
    const nucleo = f["Núcleo"] || "";
    const status = f["Status"] || "";
    let hora = "";
    if (inicio) {
      try { hora = new Date(inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch(e) {}
    }
    let linha = `${i + 1}. *${nome}*`;
    if (hora) linha += ` — _${hora}_`;
    if (tipo) linha += ` | ${tipo}`;
    if (nucleo) linha += ` | ${nucleo}`;
    if (status) linha += ` | ${status}`;
    return linha;
  }).join("\n");
}

async function askAI(message, context = "") {
  const userContent = context ? `${context}\n\nPergunta: ${message}` : message;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userContent }]
    })
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "Não consegui processar.";
}

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

  const userMessage = event.text.trim();
  const channelId = event.channel;

  try {
    await slackPost("chat.postMessage", { channel: channelId, text: "_Pensando..._", mrkdwn: true });

    const querEventos = /evento|agenda|hoje|dia|grade|transmiss|ao vivo|jogo|partida|futebol|copa/i.test(userMessage);

    let resposta;
    if (querEventos) {
      const records = await getAirtableEvents();
      const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
      const eventosFormatados = formatEvents(records, hoje);
      const context = `Grade de hoje — ${hoje} (Matriz LiveMode / CazéTV):\n\n${eventosFormatados}`;
      resposta = await askAI(userMessage, context);
    } else {
      resposta = await askAI(userMessage);
    }

    await slackPost("chat.postMessage", { channel: channelId, text: resposta, mrkdwn: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("ERRO:", err.message);
    await slackPost("chat.postMessage", { channel: channelId, text: `Erro: ${err.message}` });
    return res.status(200).json({ ok: true });
  }
}
