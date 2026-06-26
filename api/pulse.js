export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

function toHoraBRT(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

async function getAirtableEvents() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const filter = `DATESTR({fldRnfbwPVzFiHMqs}) = '${hoje}'`;
  // Ordena pelo campo Início do Evento via ID
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=50&sort[0][field]=fld8hthI7oI4MY5aP&sort[0][direction]=asc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();
  // Log para ver TODOS os campos disponíveis com valores
  if (data.records?.[0]) {
    const f = data.records[0].fields;
    const camposComValor = Object.entries(f)
      .filter(([k,v]) => typeof v === 'string' && v.includes('T') && v.includes(':'))
      .map(([k,v]) => `${k}=${v}`);
    console.log("CAMPOS DATA/HORA:", camposComValor.join(" | "));
  }
  return data.records || [];
}

function formatEvents(records, hoje) {
  if (!records.length) return `Nenhum evento para hoje (${hoje}).`;
  
  // Ordena no JS pelo campo de início que tiver valor
  const sorted = [...records].sort((a, b) => {
    const fa = a.fields;
    const fb = b.fields;
    // Tenta vários campos de início
    const ia = fa["fld8hthI7oI4MY5aP"] || fa["Data c/ Pré"] || "";
    const ib = fb["fld8hthI7oI4MY5aP"] || fb["Data c/ Pré"] || "";
    return ia.localeCompare(ib);
  });

  return sorted.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    // Usa Data c/ Pré para início e Data c/ Pós para término (que funcionou na v22)
    const inicio = toHoraBRT(f["Data c/ Pré"] || "");
    const termino = toHoraBRT(f["Data c/ Pós"] || "");
    const tipo = f["Tipo de Conteúdo"] || "";
    const nucleo = f["Núcleo"] || "";
    const hora = inicio && termino ? `_${inicio} → ${termino}_` : inicio ? `_${inicio}_` : "";
    return `${i + 1}. ${hora} *${nome}* | ${tipo} | ${nucleo}`;
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
