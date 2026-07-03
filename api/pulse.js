export const config = { maxDuration: 30 };

import { sheetsRequest } from '../lib/google-auth.js';

const SYSTEM = `Você é o Pulse, a IA oficial da LiveMode. Ajuda o time com informações internas, documentos, agenda e suporte geral.
Responda sempre em português brasileiro. Seja objetivo e amigável.`;

const DIAS_SEMANA = {
  'domingo': 0, 'segunda': 1, 'terca': 2, 'terça': 2,
  'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'sábado': 6
};

function getBRT() {
  const agora = new Date();
  const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
  return new Date(brt.toISOString().split('T')[0]);
}

function parsearDataStr(str) {
  const hoje = getBRT();
  const partes = str.split('/');
  const dia = parseInt(partes[0]);
  const mes = partes[1] ? parseInt(partes[1]) - 1 : hoje.getMonth();
  return new Date(hoje.getFullYear(), mes, dia);
}

function parsearDataTexto(texto) {
  const hoje = getBRT();

  if (/\bhoje\b/i.test(texto)) return hoje;
  if (/\bamanh[aã]\b/i.test(texto)) { const d = new Date(hoje); d.setDate(d.getDate() + 1); return d; }
  if (/\bontem\b/i.test(texto)) { const d = new Date(hoje); d.setDate(d.getDate() - 1); return d; }

  const diaMatch = texto.match(/dia\s+(\d{1,2})(?:\/(\d{1,2}))?/i) || texto.match(/(\d{1,2})\/(\d{1,2})/);
  if (diaMatch) {
    const dia = parseInt(diaMatch[1]);
    const mes = diaMatch[2] ? parseInt(diaMatch[2]) - 1 : hoje.getMonth();
    return new Date(hoje.getFullYear(), mes, dia);
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

function formatarData(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const TIPOS = [
  { tipo: 'Férias',   regex: /f[eé]rias/i },
  { tipo: 'Atestado', regex: /atestado|médico|medico|doente|hospital|consulta/i },
  { tipo: 'Folga',    regex: /folga/i },
  { tipo: 'Licença',  regex: /licen[çc]a/i },
  { tipo: 'Abono',    regex: /abono/i },
  { tipo: 'Falta',    regex: /falta/i },
];

// Extrai todos os registros de ausência de uma mensagem
// Ex: "folga dia 30/06, férias de 10/07 a 25/07 e abono dia 05/07"
function extrairAusencias(texto) {
  const ausencias = [];

  // Divide por separadores comuns: vírgula, " e ", " + ", ponto e vírgula
  const segmentos = texto.split(/,|\be\b|;|\+/i).map(s => s.trim()).filter(Boolean);

  for (const seg of segmentos) {
    const tipoEncontrado = TIPOS.find(t => t.regex.test(seg));
    if (!tipoEncontrado) continue;

    // Tenta intervalo (de X a Y)
    const rangeMatch = seg.match(/de\s+(\d{1,2}\/\d{1,2}|\d{1,2})\s+(?:a|até)\s+(\d{1,2}\/\d{1,2}|\d{1,2})/i)
      || seg.match(/do\s+dia\s+(\d{1,2}(?:\/\d{1,2})?)\s+ao\s+dia\s+(\d{1,2}(?:\/\d{1,2})?)/i);

    let inicio, fim;

    if (rangeMatch) {
      inicio = parsearDataStr(rangeMatch[1]);
      fim = parsearDataStr(rangeMatch[2]);
    } else {
      const data = parsearDataTexto(seg);
      if (!data) continue;
      inicio = data;
      fim = data;
    }

    // Observação após "porque", "pois", "obs:", etc.
    const obsMatch = seg.match(/(?:porque|pois|motivo[:\s]+|obs[:\s]+|observa[çc][aã]o[:\s]+)(.*)/i);
    const observacao = obsMatch ? obsMatch[1].trim() : '';

    ausencias.push({ tipo: tipoEncontrado.tipo, inicio, fim, observacao });
  }

  return ausencias;
}

function toHoraBRT(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  d.setHours(d.getHours() - 3);
  return d.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || "";
}

async function getGradeData(dataStr) {
  // Filtra pela data de INÍCIO do evento (fldgNvn52DK5Yu8x9). fldBNl8ypKaV5hFG5 é o
  // Encerramento e não deve entrar no filtro — um OR com ele fazia o evento de amanhã
  // (que termina, ou já registra a data de conclusão, em outro dia) aparecer na grade de hoje.
  const filter = `DATESTR({fldgNvn52DK5Yu8x9}) = '${dataStr}'`;
  const url = `https://api.airtable.com/v0/appqPBoDUYfX2edOp/tblkqT3nDu1Gw6bnf?view=viwafe9za0RwsVlC9&filterByFormula=${encodeURIComponent(filter)}&maxRecords=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();
  const records = data.records || [];
  records.sort((a, b) => {
    const ha = toHoraBRT(a.fields["Início do Evento BRT"] || "");
    const hb = toHoraBRT(b.fields["Início do Evento BRT"] || "");
    return ha.localeCompare(hb);
  });
  return records;
}

function formatEvents(records, dataFormatada) {
  if (!records.length) return `Nenhum evento encontrado para ${dataFormatada}.`;
  return records.map((r, i) => {
    const f = r.fields;
    const nome = f["Match ID"] || "Sem título";
    const inicio = toHoraBRT(f["Início do Evento BRT"] || "");
    const posRaw = f["Encerramento"] || "";
    const termino = posRaw ? toHoraBRT(posRaw) : "";
    const local = f["Padrão de Produção"] || "";
    const tipo = f["Tipo de Conteúdo"] || "";
    const hora = inicio && termino ? `_${inicio} → ${termino}_` : inicio ? `_${inicio}_` : "";
    let linha = `${i + 1}. ${hora} *${nome}*`;
    if (tipo) linha += ` | ${tipo}`;
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
  const agora = new Date();
  const brt = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
  const registradoEm = brt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dias = inicio.getTime() === fim.getTime()
    ? '1'
    : String(Math.round((fim - inicio) / (1000 * 60 * 60 * 24)) + 1);

  const row = [registradoEm, nomeUsuario, userId, tipo, formatarData(inicio), formatarData(fim), dias, observacao || '', 'Pendente'];

  await sheetsRequest(
    process.env.GOOGLE_SHEET_ID,
    `/values/Aus%C3%AAncias!A1:append?valueInputOption=USER_ENTERED`,
    'POST',
    { values: [row] }
  );

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

const EMOJI = { 'Férias': '🏖️', 'Atestado': '🏥', 'Folga': '😴', 'Licença': '📋', 'Abono': '🎫', 'Falta': '📝' };

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

    // --- Detectar ausências (uma ou múltiplas) ---
    const temTipoAusencia = TIPOS.some(t => t.regex.test(userMessage));

    if (temTipoAusencia) {
      const ausencias = extrairAusencias(userMessage);

      if (!ausencias.length) {
        await slackPost("chat.postMessage", {
          channel: channelId,
          text: `Entendi que você quer registrar uma ausência, mas não consegui identificar as datas. 📅\n\nTente assim:\n• _"Folga dia 30/06"_\n• _"Atestado hoje"_\n• _"Férias de 10/07 a 25/07"_\n• _"Folga dia 30/06, abono dia 05/07 e férias de 10/07 a 25/07"_`,
          mrkdwn: true
        });
        return res.status(200).json({ ok: true });
      }

      const nomeUsuario = await getNomeSlack(userId);

      // Registra todas em paralelo
      await Promise.all(ausencias.map(a => registrarAusencia({ userId, nomeUsuario, ...a })));

      // Monta confirmação
      const linhas = ausencias.map(a => {
        const emoji = EMOJI[a.tipo] || '📅';
        const mesmodia = a.inicio.getTime() === a.fim.getTime();
        const periodo = mesmodia
          ? `*${formatarData(a.inicio)}*`
          : `*${formatarData(a.inicio)}* a *${formatarData(a.fim)}*`;
        return `${emoji} *${a.tipo}* — ${periodo}${a.observacao ? ` _(${a.observacao})_` : ''}`;
      }).join('\n');

      const plural = ausencias.length > 1 ? 'registros salvos' : 'registro salvo';

      await slackPost("chat.postMessage", {
        channel: channelId,
        text: `✅ *${ausencias.length} ${plural} com sucesso!*\n\n👤 *Colaborador:* ${nomeUsuario}\n\n${linhas}\n\nTudo na planilha. O RH foi notificado!`,
        mrkdwn: true
      });

      if (process.env.SLACK_RH_CHANNEL) {
        await slackPost("chat.postMessage", {
          channel: process.env.SLACK_RH_CHANNEL,
          text: `📋 *Nova solicitação de ${nomeUsuario}*\n\n${linhas}\n\n_Registrado via Pulse_`,
          mrkdwn: true
        });
      }

      return res.status(200).json({ ok: true });
    }

    // --- Grade Airtable ---
    const querGrade = /grade|evento|agenda|transmiss|ao vivo|jogo|partida|futebol|copa|programa/i.test(userMessage);

    let resposta;
    if (querGrade) {
      const hoje = getBRT();
      const dataObj = (() => {
        // reutiliza parsearDataTexto mas precisamos de um texto limpo
        return parsearDataTexto(userMessage) || hoje;
      })();
      const dataStr = dataObj.toISOString().split('T')[0];
      const dataFormatada = dataObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const records = await getGradeData(dataStr);
      const label = dataObj.getTime() === hoje.getTime() ? 'Grade de hoje' : 'Grade';
      resposta = `*${label} — ${dataFormatada}*\n\n${formatEvents(records, dataFormatada)}`;
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
