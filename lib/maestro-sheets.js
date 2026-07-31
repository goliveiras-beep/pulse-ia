// lib/maestro-sheets.js
// leitura/escrita na planilha propria do MAESTRO (MAESTRO_SHEET_ID), separada da
// planilha do Pulse (GOOGLE_SHEET_ID) - reaproveita o sheetsRequest ja existente em
// lib/google-auth.js, so aponta pra outro spreadsheet.
// nunca usar values.append aqui - no Pulse isso ja causou corrupcao real de dados
// (a api decide a coluna de escrita com base no formato das ultimas linhas existentes,
// nao no range pedido). em vez disso: ler pra achar a proxima linha vazia e usar PUT
// com o range explicito, que sempre respeita a coluna pedida.
import { sheetsRequest } from './google-auth.js';

export async function getSheet(range) {
  try {
    const d = await sheetsRequest(process.env.MAESTRO_SHEET_ID, `/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch {
    return [];
  }
}

export async function appendRowSafe(sheetName, row) {
  const existing = await getSheet(`${sheetName}!A:A`);
  const nextRow = existing.length + 1;
  const lastCol = String.fromCharCode(64 + row.length); // A=65 -> 1 coluna, G=7 colunas
  const range = `${sheetName}!A${nextRow}:${lastCol}${nextRow}`;
  await sheetsRequest(
    process.env.MAESTRO_SHEET_ID,
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    'PUT',
    { values: [row] }
  );
}

// sobrescreve uma linha especifica (rowIndex1Based conta a partir da linha 1 real da
// planilha, ex: 2 = primeira linha de dados, depois do cabecalho) - mesma escrita segura
// (PUT com range explicito), usada pra marcar um comando como Executado/Falhou.
export async function updateRow(sheetName, rowIndex1Based, row) {
  const lastCol = String.fromCharCode(64 + row.length);
  const range = `${sheetName}!A${rowIndex1Based}:${lastCol}${rowIndex1Based}`;
  await sheetsRequest(
    process.env.MAESTRO_SHEET_ID,
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    'PUT',
    { values: [row] }
  );
}

// rows = valores de Telemetria!A2:G (sem cabecalho). como toda escrita e append-safe
// (sempre na proxima linha vazia), a ordem das linhas ja e cronologica.
export function latestStatusPerItem(rows) {
  const map = new Map();
  for (const r of rows) {
    const [timestamp, item, categoria, status, observacao, reportadoPor, evento] = r;
    if (!item) continue;
    map.set(item, { timestamp, item, categoria, status, observacao, reportadoPor, evento });
  }
  return Array.from(map.values());
}
