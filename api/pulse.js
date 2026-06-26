export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.

Repositório de documentos (Google Drive):
- Pasta raiz: https://drive.google.com/drive/folders/1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f

Responda sempre em português brasileiro. Seja objetivo e amigável. Use formatação Slack: *negrito*, _itálico_, listas com •
Quando apresentar eventos, organize por horário de forma clara e concisa.`;

async function getAirtableEvents() {
  // Busca sem filtro para ver o que existe, ordenado por Data c/ Pré decrescente
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?maxRecords=5&sort[0][field]=fldC1FvZlEG4JjDAg&sort[0][direction]=desc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  const data = await res.json();
  console.log("AIRTABLE RAW:", JSON.stringify(data.records?.[0]?.fields || data.error || "sem dados").slice(0, 500));
  return data.records || [];
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
      console.log("Total records:", records.length);
      
      if (records.length > 0) {
        const campos = Object.keys(records[0].fields).join(", ");
        console.log("Campos disponíveis:", campos);
        const primeiroRegistro = JSON.stringify(records[0].fields).slice(0, 300);
        console.log("Primeiro registro:", primeiroRegistro);
        
        // Passa os dados brutos para a IA formatar
        const context = `Dados do Airtable (últimos registros):\n${records.map(r => JSON.stringify(r.fields)).join('\n')}\n\nMostra esses eventos formatados ao usuário.`;
        resposta = await askAI(userMessage, context);
      } else {
        resposta = "Não encontrei eventos no Airtable. Verifique se o token tem acesso correto à base.";
      }
    } else {
      resposta = await askAI(userMessage);
    }

    await slackPost("chat.postMessage", { channel: channelId, text: resposta, mrkdwn: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro:", err);
    await slackPost("chat.postMessage", { channel: channelId, text: `Erro: ${err.message}` });
    return res.status(200).json({ ok: true });
  }
}
