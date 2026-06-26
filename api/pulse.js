export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.

Repositório de documentos (Google Drive):
- Pasta raiz: https://drive.google.com/drive/folders/1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f
- Diagramação: https://drive.google.com/drive/folders/1I7hi9lszj4q6lfIz3pdy0VOSbD7IXt26
- Comunicados: https://drive.google.com/drive/folders/1UqTP1DBXLHjPM4xpuiQPLq1jwAaq6pBs
- Fluxogramas: https://drive.google.com/drive/folders/18NyogisGSmy5f6pq_kfuWZukajRYWvdY
- Políticas: https://drive.google.com/drive/folders/1-nlWVPSK2rgCCxGO0uah78yLSotdKh27
- Índice: https://docs.google.com/spreadsheets/d/1YTXHUrvn0ic5zJaQFxC3ilJxlSYACV_SIk3Cna_4rQk

Responda sempre em português brasileiro. Seja objetivo e amigável. Use formatação Slack: *negrito*, _itálico_, listas com •
Quando apresentar eventos, organize por horário de forma clara e concisa.`;

async function getAirtableEvents() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  
  const filter = `DATETIME_FORMAT({Data c/ Pré}, 'YYYY-MM-DD') = '${hoje}'`;
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?filterByFormula=${encodeURIComponent(filter)}&maxRecords=50&sort[0][field]=Inicio%20do%20Evento&sort[0][direction]=asc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  const data = await res.json();
  return data.records || [];
}

function formatEvents(records, hoje) {
  if (!records.length) return `Nenhum evento encontrado para hoje (${hoje}).`;

  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    const inicio = f["Inicio do Evento"] || f["Data c/ Pré"] || "";
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
  return data?.choices?.[0]?.message?.content || "Não consegui processar. Tente novamente.";
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
  if (!event || event.bot_id || event.subtype || !event.text || !event.user) return res.status(200).json({ ok: true });
  if (event.channel_type !== "im") return res.status(200).json({ ok: true });

  const userMessage = event.text.trim();
  const channelId = event.channel;

  try {
    await slackPost("chat.postMessage", { channel: channelId, text: "_Pensando..._", mrkdwn: true });

    const querEventos = /evento|agenda|hoje|dia|programaç|o que tem|o que temos|grade|transmiss|ao vivo|jogo|partida|futebol|copa/i.test(userMessage);

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
    console.error("Erro:", err);
    await slackPost("chat.postMessage", { channel: channelId, text: "Ops, tive um problema. Tente novamente." });
    return res.status(200).json({ ok: true });
  }
}
