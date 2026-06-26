import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `Você é o Pulse, a IA oficial da LiveMode.
Você ajuda o time com informações internas, busca de documentos, dúvidas operacionais e suporte geral.

Repositório de documentos da empresa (Google Drive):
- Pasta raiz: https://drive.google.com/drive/folders/1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f
- Diagramação: https://drive.google.com/drive/folders/1I7hi9lszj4q6lfIz3pdy0VOSbD7IXt26
- Comunicados: https://drive.google.com/drive/folders/1UqTP1DBXLHjPM4xpuiQPLq1jwAaq6pBs
- Fluxogramas Operacionais: https://drive.google.com/drive/folders/18NyogisGSmy5f6pq_kfuWZukajRYWvdY
- Políticas e Procedimentos: https://drive.google.com/drive/folders/1-nlWVPSK2rgCCxGO0uah78yLSotdKh27
- Índice completo: https://docs.google.com/spreadsheets/d/1YTXHUrvn0ic5zJaQFxC3ilJxlSYACV_SIk3Cna_4rQk

Regras:
- Responda sempre em português brasileiro
- Seja objetivo, direto e amigável
- Para busca de documentos, indique a pasta correta e o link
- Se não souber algo específico da empresa, diga que não tem essa informação e sugira contato com o responsável
- Nunca invente informações sobre a empresa
- Use formatação Slack: *negrito*, _itálico_, listas com •`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body;

  // Verificação do Slack (URL verification challenge)
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Responde imediatamente pro Slack (evita timeout de 3s)
  res.status(200).json({ ok: true });

  const event = body.event;
  if (!event) return;

  // Ignora bots e mensagens sem texto
  if (event.bot_id || event.subtype || !event.text || !event.user) return;

  // Só responde a DMs (im = direct message)
  if (event.channel_type !== "im") return;

  const userMessage = event.text.trim();
  const channelId = event.channel;

  try {
    // Envia "Pensando..." enquanto processa
    await slackPost("chat.postMessage", {
      channel: channelId,
      text: "_Pensando..._",
      mrkdwn: true,
    });

    // Chama o Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const resposta = message.content[0].text;

    // Envia a resposta final
    await slackPost("chat.postMessage", {
      channel: channelId,
      text: resposta,
      mrkdwn: true,
    });
  } catch (err) {
    console.error("Erro:", err);
    await slackPost("chat.postMessage", {
      channel: channelId,
      text: "Ops, tive um problema. Tente novamente em instantes.",
    });
  }
}

async function slackPost(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}
