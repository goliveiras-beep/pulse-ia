// lib/booking/observacoes.js
// Observacao livre por evento da Grade do dia - like nao existe campo assim na tabela
// Booking do Airtable (e sincronizada, sem como criar campo novo la), guardamos essa nota
// na planilha do Pulse (Google Sheets), aba propria "BookingObservacoes" - mesmo padrao
// chave/valor que BookingConfig/PulseConfig ja usam. Chave = "dataAirtable::nomeDoEvento"
// (mesma forma que grade-dia.js ja cruza CDN x Booking por nome, ver getParametrosTecnicosDoDia).
import { sheetsRequest } from '../google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ABA = 'BookingObservacoes';
const RANGE = `${ABA}!A2:E2000`;

function chave(dataAirtable, nomeEvento) {
  return `${dataAirtable}::${nomeEvento}`;
}

async function getSheet(range) {
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch {
    return [];
  }
}

async function garantirAba() {
  try {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA + '!A1')}`);
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message)) throw e;
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: ABA } } }]
    });
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(ABA + '!A1:E1')}?valueInputOption=USER_ENTERED`, 'PUT', {
      values: [['chave', 'dataAirtable', 'nomeEvento', 'texto', 'atualizadoPor+Em']]
    });
  }
}

// Mapa "dataAirtable::nomeEvento" -> {texto, meta} - usado por montarDia() pra anexar a
// observacao de cada evento do dia sem precisar de uma leitura por evento.
export async function getMapaObservacoes() {
  const linhas = await getSheet(RANGE);
  const mapa = {};
  for (const r of linhas) {
    if (!r[0]) continue;
    mapa[r[0]] = { texto: r[3] || '', meta: r[4] || '' };
  }
  return mapa;
}

export async function salvarObservacao(dataAirtable, nomeEvento, texto, autor) {
  await garantirAba();
  const k = chave(dataAirtable, nomeEvento);
  const linhas = await getSheet(RANGE);
  const idx = linhas.findIndex((r) => r[0] === k);
  const meta = `${autor} · ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  const linha = [k, dataAirtable, nomeEvento, texto, meta];
  if (idx >= 0) {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!A${idx + 2}:E${idx + 2}`)}?valueInputOption=USER_ENTERED`, 'PUT', { values: [linha] });
  } else {
    await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!A:E`)}:append?valueInputOption=USER_ENTERED`, 'POST', { values: [linha] });
  }
}
