export const config = { maxDuration: 30 };

const CANAL = "C0BB36J2ZNV";
const BASE = "appwE9LmmTxynTGFY";
const TABELA = "tblpibvwAIGBQXr0H";
const VIEW = "viwrkqQ6rxT9AeNBa";
const GITHUB_REPO = "goliveiras-beep/pulse-ia";
const SNAPSHOT_PATH = "data/grade_snapshot.json";

async function slackPost(channel, text) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ channel, text, mrkdwn: true })
  });
}

async function getGradeDia(data) {
  const filter = `OR(DATESTR({fldRnfbwPVzFiHMqs}) = '${data}', DATESTR({fld8hthI7oI4MY5aP}) = '${data}')`;
  const url = `https://api.airtable.com/v0/${BASE}/${TABELA}?view=${VIEW}&filterByFormula=${encodeURIComponent(filter)}&maxRecords=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  const d = await res.json();
  const snapshot = {};
  for (const r of (d.records || [])) {
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

async function getSnapshotGitHub() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${SNAPSHOT_PATH}`, {
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Decodifica corretamente UTF-8
    const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    const content = new TextDecoder('utf-8').decode(bytes);
    return { snapshot: JSON.parse(content), sha: data.sha };
  } catch(e) {
    console.error("Erro lendo snapshot:", e.message);
    return null;
  }
}

async function salvarSnapshotGitHub(snapshot, sha) {
  // Codifica corretamente UTF-8
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const content = btoa(binary);

  await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${SNAPSHOT_PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `token ${process.env.GITHUB_TOKEN}` },
    body: JSON.stringify({
      message: "chore: atualizar snapshot grade D+1",
      content,
      ...(sha ? { sha } : {})
    })
  });
}

function compararGrades(anterior, atual) {
  const mudancas = [];
  for (const id of Object.keys(atual)) {
    if (!anterior[id]) {
      const e = atual[id];
      mudancas.push(`➕ *Adicionado:* *${e.nome}* — _${e.inicio}_ | ${e.tipo}`);
    }
  }
  for (const id of Object.keys(anterior)) {
    if (!atual[id]) {
      const e = anterior[id];
      mudancas.push(`🗑️ *Removido:* *${e.nome}* — _${e.inicio}_`);
    }
  }
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
  const token = req.headers["x-cron-token"] || req.query.token;
  if (token !== process.env.CRON_TOKEN) return res.status(401).json({ error: "Unauthorized" });

  try {
    const amanha = new Date();
    amanha.setTime(amanha.getTime() + ((-3 * 60) - amanha.getTimezoneOffset()) * 60000);
    amanha.setDate(amanha.getDate() + 1);
    const dataAmanha = amanha.toISOString().split('T')[0];
    const dataAmanhaFormatada = amanha.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

    const gradeAtual = await getGradeDia(dataAmanha);
    const resultado = await getSnapshotGitHub();

    if (!resultado || Object.keys(resultado.snapshot).length === 0) {
      await salvarSnapshotGitHub(gradeAtual, resultado?.sha || null);
      return res.status(200).json({ ok: true, msg: "Snapshot inicial criado", dia: dataAmanha, total: Object.keys(gradeAtual).length });
    }

    const { snapshot: snapshotAnterior, sha } = resultado;
    const mudancas = compararGrades(snapshotAnterior, gradeAtual);

    if (mudancas.length > 0) {
      const msg = `🔔 *Mudanças na grade de amanhã — ${dataAmanhaFormatada}*\n\n${mudancas.join("\n\n")}`;
      await slackPost(CANAL, msg);
      await salvarSnapshotGitHub(gradeAtual, sha);
    }

    return res.status(200).json({ ok: true, mudancas: mudancas.length, dia: dataAmanha });
  } catch (err) {
    console.error("Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
