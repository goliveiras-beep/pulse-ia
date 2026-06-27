export const config = { maxDuration: 30 };

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

const DIAS_SEMANA = {
  'domingo': 0, 'segunda': 1, 'terca': 2, 'terça': 2,
  'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'sábado': 6
};

function parsearData(texto) {
  const agora = new Date();
  const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
  const hoje = new Date(brt.toISOString().split('T')[0]);

  if (/\bhoje\b/i.test(texto)) return hoje;

  if (/\bamanh[aã]\b/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 1); return d;
  }

  if (/\bontem\b/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() - 1); return d;
  }

  const diaMatch = texto.match(/dia\s+(\d{1,2})(?:\/(\d{1,2}))?/i) || texto.match(/(\d{1,2})\/(\d{1,2})/);
  if (diaMatch) {
    const dia = parseInt(diaMatch[1]);
    const mes = diaMatch[2] ? parseInt(diaMatch[2]) - 1 : hoje.getMonth();
    const ano = hoje.getFullYear();
    return new Date(ano, mes, dia);
  }

  for (const [nome, diaSemana] of Object.entries(DIAS_SEMANA)) {
    if (new RegExp(`\\b${nome}\\b`, 'i').test(texto)) {
      const d = new Date(hoje);
      const diff = (diaSemana - hoje.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }

  if (/pr[oó]xima\s+semana/i.test(texto)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 7); return d;
  }

  return null;
}

// Detecta intervalo de datas (ex: "de 10/07 a 20/07", "do dia 5 ao dia 10")
function parsearIntervalo(texto) {
  // Formato: de DD/MM a DD/MM ou do dia X ao dia Y
  const rangeMatch = texto.match(/de\s+(\d{1,2}\/\d{1,2}|\d{1,2})\s+(?:a|até)\s+(\d{1,2}\/\d{1,2}|\d{1,2})/i)
    || texto.match(/do\s+dia\s+(\d{1,2}(?:\/\d{1,2})?)\s+ao\s+dia\s+(\d{1,2}(?:\/\d{1,2})?)/i);

  if (rangeMatch) {
    const inicio = parsearDataStr(rangeMatch[1]);
    const fim = parsearDataStr(rangeMatch[2]);
    if (inicio && fim) return { inicio, fim };
  }

  // Data única
  const data = parsearData(texto);
  if (data) return { inicio: data, fim: data };

  return null;
}

function parsearDataStr(str) {
  const agora = new Date();
  const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
  const hoje = new Date(brt.toISOString().split('T')[0]);

  const partes = str.split('/');
  const dia = parseInt(partes[0]);
  const mes = partes[1] ? parseInt(partes[1]) - 1 : hoje.getMonth();
  const ano = hoje.getFullYear();
  return new Date(ano, mes, dia);
}

function formatarData(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function detectarTipoAusencia(texto) {
  if (/f[eé]rias/i.test(texto)) return 'Férias';
  if (/atestado|médico|medico|doente|hospital|consulta/i.test(texto)) return 'Atestado';
  if (/folga/i.test(texto)) return 'Folga';
  if (/licen[çc]a/i.test(texto)) return 'Licença';
  if (/falta/i.test(texto)) return 'Falta';
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

async function getNomeSlack(userId) {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
  });
  const data = await res.json();
  return data?.user?.profile?.real_name || data?.user?.name || userId;
}

async function registrarAusencia({ userId, nomeUsuario, tipo, inicio, fim, observacao }) {
  const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/Ausências!A:A:append?valueInputOption=USER_ENTERED`;

  const agora = new Date();
  const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
  const registradoEm = brt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const row = [
    registradoEm,
    nomeUsuario,
    userId,
    tipo,
    formatarData(inicio),
    formatarData(fim),
    inicio.getTime() === fim.getTime() ? '1' : String(Math.round((fim - inicio) / (1000 * 60 * 60 * 24)) + 1),
    observacao || '',
    'Pendente'
  ];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/Aus%C3%AAncias!A1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN}`
      },
      body: JSON.stringify({ values: [row] })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API erro: ${err}`);
  }

  return row;
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
  const userId = event.user;

  try {
    await slackPost("chat.postMessage", { channel: channelId, text: "_Processando..._", mrkdwn: true });

    // --- Detectar ausência ---
    const tipoAusencia = detectarTipoAusencia(userMessage);

    if (tipoAusencia) {
      const intervalo = parsearIntervalo(userMessage);

      if (!intervalo) {
        await slackPost("chat.postMessage", {
          channel: channelId,
          text: `Entendi que você quer registrar *${tipoAusencia.toLowerCase()}*, mas não consegui identificar a data. 📅\n\nTente assim:\n• _"Folga dia 30/06"_\n• _"Atestado hoje"_\n• _"Férias de 10/07 a 25/07"_`,
          mrkdwn: true
        });
        return res.status(200).json({ ok: true });
      }

      const nomeUsuario = await getNomeSlack(userId);

      // Extrai observação (texto após "porque", "motivo:", "obs:", etc.)
      const obsMatch = userMessage.match(/(?:porque|pois|motivo[:\s]+|obs[:\s]+|observa[çc][aã]o[:\s]+)(.*)/i);
      const observacao = obsMatch ? obsMatch[1].trim() : '';

      await registrarAusencia({
        userId,
        nomeUsuario,
        tipo: tipoAusencia,
        inicio: intervalo.inicio,
        fim: intervalo.fim,
        observacao
      });

      const mesmodia = intervalo.inicio.getTime() === intervalo.fim.getTime();
      const periodoStr = mesmodia
        ? `em *${formatarData(intervalo.inicio)}*`
        : `de *${formatarData(intervalo.inicio)}* a *${formatarData(intervalo.fim)}*`;

      const emoji = { 'Férias': '🏖️', 'Atestado': '🏥', 'Folga': '😴', 'Licença': '📋', 'Falta': '📝' }[tipoAusencia] || '📅';

      await slackPost("chat.postMessage", {
        channel: channelId,
        text: `${emoji} *${tipoAusencia} registrada com sucesso!*\n\n👤 *Colaborador:* ${nomeUsuario}\n📅 *Período:* ${periodoStr}\n📋 *Tipo:* ${tipoAusencia}${observacao ? `\n💬 *Obs:* ${observacao}` : ''}\n\nRegistro salvo na planilha. O RH foi notificado! ✅`,
        mrkdwn: true
      });

      // Notifica canal de RH/gestão se configurado
      if (process.env.SLACK_RH_CHANNEL) {
        await slackPost("chat.postMessage", {
          channel: process.env.SLACK_RH_CHANNEL,
          text: `${emoji} *Nova solicitação de ${tipoAusencia.toLowerCase()}*\n\n👤 *Colaborador:* ${nomeUsuario}\n📅 *Período:* ${periodoStr}${observacao ? `\n💬 *Obs:* ${observacao}` : ''}\n\n_Registrado via Pulse_`,
          mrkdwn: true
        });
      }

      return res.status(200).json({ ok: true });
    }

    // --- Consultar grade ---
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
    await slackPost("chat.postMessage", { channel: channelId, text: `Erro interno: ${err.message}` });
    return res.status(200).json({ ok: true });
  }
}
