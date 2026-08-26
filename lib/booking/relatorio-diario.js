// lib/booking/relatorio-diario.js
// Ver Downloads/01_dashboard_diario_encoders.md - dashboard operacional do dia (ingest/
// decoders/encoders), cruzando Airtable (tabela Booking) + Gmail. Roda via cron as 06:00
// (dia corrente) e 23:00 (dia seguinte), horario de Brasilia.
import { buscarEmails } from './gmail.js';
import { gerarTextoComGemini } from './llm.js';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblJZ3r5lAapjcCll';

function fmtAirtable(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3 * 60) - a.getTimezoneOffset()) * 60000);
}

async function buscarEventosDoDia(dataAirtableStr) {
  const filtro = `AND({Status}!='Cancelado', DATESTR({Início do Evento BRT})='${dataAirtableStr}')`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=100&cellFormat=string&timeZone=America%2FSao_Paulo&userLocale=pt-BR`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!r.ok) throw new Error(`Airtable respondeu ${r.status}: ${await r.text().catch(() => '')}`);
  const d = await r.json();
  return (d.records || []).map((rec) => rec.fields);
}

const SYSTEM_PROMPT = `Você produz um dashboard operacional diário de booking de sinal pra CazéTV/LiveMode,
com foco em ingest, decoders e encoders, cruzando dados do Airtable (tabela Booking) com
evidência técnica do Gmail.

Descarte completamente eventos cancelados. Destaque claramente informações ausentes,
diferenciando ausência de informação de item possivelmente não aplicável. Identifique
conflitos ou reutilização de recursos (Decoder/Demodulador/Ingest) por horário. Sinalize
os principais riscos operacionais.

Faça um cruzamento explícito EMAIL x AIRTABLE:
- Se existir e-mail com parâmetros, teste de sinal, janela de teste, booking técnico ou
  instrução de recepção pra um evento/teste que NÃO esteja no Airtable, crie um alerta de
  alta prioridade: "EMAIL NÃO CADASTRADO NO AIRTABLE".
- Mostre data/hora, assunto/remetente quando disponível, natureza do conteúdo, e a ação
  necessária no Airtable.
- Se o e-mail corresponder a um evento já cadastrado, confirme "EMAIL x AIRTABLE OK" e
  aponte divergências de horário/evento/competição/transporte/status.
- Não descarte teste técnico do e-mail só porque não está no Airtable - trate como alerta
  operacional obrigatório até confirmar que foi cadastrado ou dispensado.
- Se houver e-mail relevante sem correspondência inequívoca, sinalize como pendência, sem
  forçar o matching.
- Nunca exponha passphrase, password, encryption key ou secret - só diga se a credencial
  está presente ou ausente.

Inclua no início uma seção "Cobertura Email x Airtable": e-mails técnicos relevantes
encontrados, quantos têm correspondência no Airtable, quantos estão fora, e quais
testes/eventos exigem ação. Item técnico futuro/do dia encontrado no e-mail e ausente do
Airtable entra nos principais riscos, mesmo que não seja evento de transmissão.

Responda em markdown, direto, sem introdução nem despedida - só o dashboard.`;

/**
 * momento: 'manha' (analisa o dia corrente) | 'noite' (analisa o dia seguinte).
 */
export async function gerarDashboardDiario(momento = 'manha') {
  const hoje = getBRT();
  hoje.setHours(0, 0, 0, 0);
  const diaAnalisado = new Date(hoje);
  if (momento === 'noite') diaAnalisado.setDate(diaAnalisado.getDate() + 1);
  const dataStr = fmtAirtable(diaAnalisado);

  const [eventos, emails] = await Promise.all([
    buscarEventosDoDia(dataStr),
    buscarEmails('newer_than:7d (booking OR SRT OR satellite OR downlink OR frequency OR feed OR test OR "signal test" OR "connectivity test" OR "end-to-end test" OR ETE OR Eurovision OR HBS OR Mediapro OR Overon)', 40).catch(() => []),
  ]);

  const contexto = `Data analisada (BRT): ${dataStr} (momento: ${momento})\n\n` +
    `EVENTOS NO AIRTABLE (${eventos.length}):\n${JSON.stringify(eventos, null, 2)}\n\n` +
    `E-MAILS TÉCNICOS RECENTES (metadados - assunto/remetente/data/snippet, últimos 7 dias):\n${JSON.stringify(emails, null, 2)}`;

  const relatorio = await gerarTextoComGemini(SYSTEM_PROMPT, contexto, { maxOutputTokens: 5000, thinkingBudget: 1024 });
  return { dataStr, momento, totalEventos: eventos.length, totalEmails: emails.length, relatorio };
}
