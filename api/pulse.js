export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

async function getAirtableEvents() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const filter = `DATESTR({fldRnfbwPVzFiHMqs}) = '${hoje}'`;
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=50&sort[0][field]=fld8hthI7oI4MY5aP&sort[0][direction]=asc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();
  // Log do valor bruto para ver o formato exato
  const r0 = data.records?.[0]?.fields;
  console.log("INICIO RAW:", r0?.["fld8hthI7oI4MY5aP"]);
  console.log("TERMINO RAW:", r0?.["fldRnfbwPVzFiHMqs"]);
  return data.records || [];
}

function formatEvents(records, hoje) {
  if (!records.length) return `Nenhum evento para hoje (${hoje}).`;
  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    // Pega direto o valor bruto — vamos ver o que vem
    const inicioRaw = f["fld8hthI7oI4MY5aP"] || "";
    const terminoRaw = f["fldRnfbwPVzFiHMqs"] || "";
    const tipo = f["Tipo de Conteúdo"] || "";
    const nucleo = f["Núcleo"] || "";
    const status = f["Status"] || "";

    // Extrai HH:MM do valor bruto
    const inicio = inicioRaw.match(/\d{2}:\d{2}/)?.[0] || inicioRaw;
    const termino = terminoRaw.match(/\d{2}:\d{2}/)?.[0] || terminoRaw;

    let linha = `${i + 1}. *${nome}* — _${inicio} → ${termino}_`;
    if (tipo) linha += ` | ${tipo}`;
    if (nucleo) linha += ` | ${nucleo}`;
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
      // Manda a lista formatada diretamente sem passar pela IA
      resposta = `*Grade de hoje — ${hoje}*\n\n${eventosFormatados}`;
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
