export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

const DIAS_SEMANA = {
  'domingo': 0, 'segunda': 1, 'terca': 2, 'terça': 2,
  'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'sábado': 6
};

function parsearData(texto) {
  const agora = new Date();
  // Ajusta para BRT
  const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
  const hoje = new Date(brt.toISOString().split('T')[0]);

  // "hoje"
  if (/\bhoje\b/i.test(texto)) return hoje;

  // "amanha" / "amanhã"
  if (/\bamanh[aã]\b/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 1); return d;
  }

  // "ontem"
  if (/\bontem\b/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() - 1); return d;
  }

  // "dia 28", "dia 28/06", "28/06"
  const diaMatch = texto.match(/dia\s+(\d{1,2})(?:\/(\d{1,2}))?/i) || texto.match(/(\d{1,2})\/(\d{1,2})/);
  if (diaMatch) {
    const dia = parseInt(diaMatch[1]);
    const mes = diaMatch[2] ? parseInt(diaMatch[2]) - 1 : hoje.getMonth();
    const ano = hoje.getFullYear();
    const d = new Date(ano, mes, dia);
    return d;
  }

  // "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"
  for (const [nome, diaSemana] of Object.entries(DIAS_SEMANA)) {
    if (new RegExp(`\\b${nome}\\b`, 'i').test(texto)) {
      const d = new Date(hoje);
      const diff = (diaSemana - hoje.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }

  // "próxima semana"
  if (/pr[oó]xima\s+semana/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 7); return d;
  }

  return null;
}

function toHoraBRT(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  d.setHours(d.getHours() - 3);
  return d.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || "";
}

async function getGradeData(dataStr) {
  const filter = `OR(DATESTR({fldRnfbwPVzFiHMqs}) = '${dataStr}', DATESTR({fld8hthI7oI4MY5aP}) = '${dataStr}')`;
  const url = `https://api.airtable.com/v0/appwE9LmmTxynTGFY/tblpibvwAIGBQXr0H?view=viwrkqQ6rxT9AeNBa&filterByFormula=${encodeURIComponent(filter)}&maxRecords=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();
  const records = data.records || [];
  records.sort((a, b) => {
    const ha = a.fields["Horário KO"] || a.fields["PGM (horário)"] || "";
    const hb = b.fields["Horário KO"] || b.fields["PGM (horário)"] || "";
    return ha.localeCompare(hb);
  });
  return records;
}

function formatEvents(records, dataFormatada) {
  if (!records.length) return `Nenhum evento encontrado para ${dataFormatada}.`;
  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    const inicio = f["Horário KO"] || f["PGM (horário)"] || "";
    const posRaw = f["Data c/ Pós"] || "";
    const termino = posRaw ? toHoraBRT(posRaw) : "";
    const localArr = f["Name (from Padrão de Produção)"] || [];
    const local = Array.isArray(localArr) ? localArr.join(", ") : String(localArr);
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

    const querGrade = /grade|evento|agenda|transmiss|ao vivo|jogo|partida|futebol|copa|programa/i.test(userMessage);

    let resposta;
    if (querGrade) {
      const dataObj = parsearData(userMessage);

      if (dataObj) {
        const dataStr = dataObj.toISOString().split('T')[0];
        const dataFormatada = dataObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const records = await getGradeData(dataStr);
        resposta = `*Grade — ${dataFormatada}*\n\n${formatEvents(records, dataFormatada)}`;
      } else {
        // Sem data específica → assume hoje
        const agora = new Date();
        const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
        const dataStr = brt.toISOString().split('T')[0];
        const dataFormatada = brt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const records = await getGradeData(dataStr);
        resposta = `*Grade de hoje — ${dataFormatada}*\n\n${formatEvents(records, dataFormatada)}`;
      }
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
