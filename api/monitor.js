export const config = { maxDuration: 30 };

const CANAL = "C0BB36J2ZNV";
const BASE = "appwE9LmmTxynTGFY";
const TABELA = "tblpibvwAIGBQXr0H";
const VIEW = "viwrkqQ6rxT9AeNBa";

async function slackPost(channel, text) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ channel, text, mrkdwn: true })
  });
}

async function getGradeHoje() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const filter = `OR(DATESTR({fldRnfbwPVzFiHMqs}) = '${hoje}', DATESTR({fld8hthI7oI4MY5aP}) = '${hoje}')`;
  const url = `https://api.airtable.com/v0/${BASE}/${TABELA}?view=${VIEW}&filterByFormula=${encodeURIComponent(filter)}&maxRecords=100&sort[0][field]=fldRnfbwPVzFiHMqs&sort[0][direction]=asc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const data = await res.json();
  const records = data.records || [];

  // Cria snapshot comparável: id → campos relevantes
  const snapshot = {};
  for (const r of records) {
    const f = r.fields;
    snapshot[r.id] = {
      nome: f["Match ID"] || "",
      inicio: f["Horário KO"] || f["PGM (horário)"] || "",
      tipo: f["Tipo de Conteúdo"] || "",
      status: f["Status"] || "",
      local: (f["Name (from Padrão de Produção)"] || []).join(",")
    };
  }
  return snapshot;
}

async function getSnapshotAnterior(kv) {
  try {
    const r = await kv.get("grade_snapshot");
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}

async function salvarSnapshot(kv, snapshot) {
  try {
    await kv.set("grade_snapshot", JSON.stringify(snapshot));
  } catch(e) { console.error("Erro salvando snapshot:", e.message); }
}

function compararGrades(anterior, atual) {
  const mudancas = [];

  // Eventos adicionados
  for (const id of Object.keys(atual)) {
    if (!anterior[id]) {
      const e = atual[id];
      mudancas.push(`➕ *Adicionado:* *${e.nome}* — _${e.inicio}_ | ${e.tipo} | ${e.status}`);
    }
  }

  // Eventos removidos
  for (const id of Object.keys(anterior)) {
    if (!atual[id]) {
      const e = anterior[id];
      mudancas.push(`🗑️ *Removido:* *${e.nome}* — _${e.inicio}_`);
    }
  }

  // Eventos alterados
  for (const id of Object.keys(atual)) {
    if (!anterior[id]) continue;
    const ant = anterior[id];
    const atu = atual[id];
    const diffs = [];
    if (ant.nome !== atu.nome) diffs.push(`Nome: _${ant.nome}_ → _${atu.nome}_`);
    if (ant.inicio !== atu.inicio) diffs.push(`Horário: _${ant.inicio}_ → _${atu.inicio}_`);
    if (ant.tipo !== atu.tipo) diffs.push(`Tipo: _${ant.tipo}_ → _${atu.tipo}_`);
    if (ant.status !== atu.status) diffs.push(`Status: _${ant.status}_ → _${atu.status}_`);
    if (ant.local !== atu.local) diffs.push(`Local: _${ant.local}_ → _${atu.local}_`);
    if (diffs.length > 0) {
      mudancas.push(`✏️ *Alterado:* *${atu.nome}*\n  ${diffs.join("\n  ")}`);
    }
  }

  return mudancas;
}

export default async function handler(req, res) {
  // Verifica token de segurança para chamadas do cron
  const token = req.headers["x-cron-token"] || req.query.token;
  if (token !== process.env.CRON_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const gradeAtual = await getGradeHoje();

    // Usa Vercel KV para armazenar snapshot anterior
    const { kv } = await import("@vercel/kv");
    const snapshotAnterior = await getSnapshotAnterior(kv);

    if (!snapshotAnterior) {
      await salvarSnapshot(kv, gradeAtual);
      return res.status(200).json({ ok: true, msg: "Snapshot inicial criado", total: Object.keys(gradeAtual).length });
    }

    const mudancas = compararGrades(snapshotAnterior, gradeAtual);

    if (mudancas.length > 0) {
      const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
      const msg = `🔔 *Mudanças na grade — ${hoje}*\n\n${mudancas.join("\n\n")}`;
      await slackPost(CANAL, msg);
      await salvarSnapshot(kv, gradeAtual);
      console.log("Mudanças detectadas:", mudancas.length);
    } else {
      console.log("Sem mudanças na grade");
    }

    return res.status(200).json({ ok: true, mudancas: mudancas.length });
  } catch (err) {
    console.error("Erro monitor:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
