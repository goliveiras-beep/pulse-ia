export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const body = req.body;
  if (body.type === "url_verification") return res.status(200).json({ challenge: body.challenge });

  const event = body.event;
  if (!event || event.bot_id || event.subtype || !event.text || !event.user) return res.status(200).json({ ok: true });
  if (event.channel_type !== "im") return res.status(200).json({ ok: true });

  const userMessage = event.text.trim();
  const channelId = event.channel;

  const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos e suporte geral.

Repositório de documentos (Google Drive):
- Pasta raiz: https://drive.google.com/drive/folders/1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f
- Diagramação: https://drive.google.com/drive/folders/1I7hi9lszj4q6lfIz3pdy0VOSbD7IXt26
- Comunicados: https://drive.google.com/drive/folders/1UqTP1DBXLHjPM4xpuiQPLq1jwAaq6pBs
- Fluxogramas: https://drive.google.com/drive/folders/18NyogisGSmy5f6pq_kfuWZukajRYWvdY
- Políticas: https://drive.google.com/drive/folders/1-nlWVPSK2rgCCxGO0uah78yLSotdKh27
- Índice: https://docs.google.com/spreadsheets/d/1YTXHUrvn0ic5zJaQFxC3ilJxlSYACV_SIk3Cna_4rQk

Responda sempre em português brasileiro. Seja objetivo e amigável. Use formatação Slack: *negrito*, _itálico_, listas com •`;

  try {
    await slackPost("chat.postMessage", { channel: channelId, text: "_Pensando..._", mrkdwn: true });

    const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMessage }
        ]
      })
    });

    const data = await aiRes.json();
    const resposta = data?.choices?.[0]?.message?.content || "Não consegui processar. Tente novamente.";
    await slackPost("chat.postMessage", { channel: channelId, text: resposta, mrkdwn: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Erro:", err);
    await slackPost("chat.postMessage", { channel: channelId, text: "Ops, tive um problema. Tente novamente." });
    return res.status(200).json({ ok: true });
  }
}

async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body)
  });
  return r.json();
}
