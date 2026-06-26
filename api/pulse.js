export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

async function getAirtableEvents() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const filter = `DATESTR({fldRnfbwPVzFiHMqs}) = '${hoje}'`;
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=50&sort[0][field]=fld8hthI7oI4MY5aP&sort[0][direction]=asc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();
  // Log completo do primeiro registro para ver TODOS os campos
  if (data.records?.[0]) {
    console.log("TODOS CAMPOS:", JSON.stringify(Object.entries(data.records[0].fields).map(([k,v]) => `${k}=${JSON.stringify(v)}`)).slice(0,800));
  }
  return data.records || [];
}

function formatEvents(records, hoje) {
  if (!records.length) return `Nenhum evento para hoje (${hoje}).`;
  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    
    // Tenta todos os campos de data/hora possíveis
    const inicioRaw = f["fld8hthI7oI4MY5aP"] || f["Início do Evento"] || f["Inicio do Evento"] || f["Data c/ Pré"] || f["fldRnfbwPVzFiHMqs"] || "";
    const terminoRaw = f["Data c/ Pós"] || "";
    
    const inicio = inicioRaw ? (inicioRaw.match(/(\d{2}:\d{2})/)?.[0] || inicioRaw.slice(0,5)) : "??:??";
    const termino = terminoRaw ? (terminoRaw.match(/(\d{2}:\d{2})/)?.[0] || terminoRaw.slice(0,5)) : "??:??";
    
    const tipo = f["Tipo de Conteúdo"] || "";
    const nucleo = f["Núcleo"] || "";

    return `${i + 1}. *${nome}* — _${inicio} → ${termino}_ | ${tipo} | ${nucleo}`;
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
      resposta = `*Grade de hoje — ${hoje}*\n\n${formatEvents(records, hoje)}`;
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
