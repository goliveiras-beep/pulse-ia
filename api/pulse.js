export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

async function getAirtableEvents() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const filter = `OR(DATESTR({fldRnfbwPVzFiHMqs}) = '${hoje}', DATESTR({fld8hthI7oI4MY5aP}) = '${hoje}')`;
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=50&sort[0][field]=fldRnfbwPVzFiHMqs&sort[0][direction]=asc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();

  // Ordena pelo campo Horário KO que já vem em formato HH:MM correto
  const records = data.records || [];
  records.sort((a, b) => {
    const ha = a.fields["Horário KO"] || a.fields["PGM (horário)"] || "";
    const hb = b.fields["Horário KO"] || b.fields["PGM (horário)"] || "";
    return ha.localeCompare(hb);
  });
  return records;
}

function formatEvents(records, hoje) {
  if (!records.length) return `Nenhum evento para hoje (${hoje}).`;
  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    
    // Horário correto sem fuso — campo "Horário KO" já vem HH:MM
    const inicio = f["Horário KO"] || f["PGM (horário)"] || "";
    
    // Término — "Alerta Gracenote Fim" ou calcula pelo Duration
    // Data c/ Pós em UTC → converte para BRT subtraindo 3h
    const posRaw = f["Data c/ Pós"] || "";
    const termino = posRaw ? (() => {
      const d = new Date(posRaw);
      d.setHours(d.getHours() - 3);
      return d.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || "";
    })() : "";
    
    // Local — "Name (from Padrão de Produção)" é array, remove emoji
    const localArr = f["Name (from Padrão de Produção)"] || [];
    const local = Array.isArray(localArr) 
      ? localArr.map(l => l.replace(/:[^:]+:/g, '').replace(/[🔴🟡🟢⚪🔵🟣🟤⚫]/gu, '').trim()).filter(Boolean).join(", ")
      : String(localArr).replace(/:[^:]+:/g, '').replace(/[🔴🟡🟢⚪🔵🟣🟤⚫]/gu, '').trim();
    
    const tipo = f["Tipo de Conteúdo"] || "";
    const nucleo = Array.isArray(f["Núcleo"]) ? f["Núcleo"].join(", ") : (f["Núcleo"] || "");

    const hora = inicio && termino ? `_${inicio} → ${termino}_` : inicio ? `_${inicio}_` : "";
    let linha = `${i + 1}. ${hora} *${nome}*`;
    if (tipo) linha += ` | ${tipo}`;
    if (nucleo) linha += ` | ${nucleo}`;
    if (local) linha += ` | 📍 ${local}`;
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
