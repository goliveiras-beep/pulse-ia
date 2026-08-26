// lib/booking/registro-arquivamento.js
// Controla quais e-mails ja foram arquivados (PDF+anexos no Drive) pra checagem.js nao
// arquivar o mesmo e-mail de novo toda vez que roda (pagina manual ou cron). Guardado numa
// aba propria da planilha, mesmo padrao chave/valor que BookingConfig ja usa.
import { sheetsRequest } from '../google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ABA = 'BookingEmailsArquivados';

async function garantirAba() {
  try {
    await sheetsRequest(SHEET_ID, `/values/${ABA}!A1`);
  } catch {
    try {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: ABA } } }] });
      await sheetsRequest(SHEET_ID, `/values/${ABA}!A1:C1?valueInputOption=USER_ENTERED`, 'PUT', { values: [['emailId', 'arquivadoEm', 'driveFileId']] });
    } catch {
      // corrida entre duas requisicoes criando a aba - ignora, ja existe
    }
  }
}

let _cacheIds = null; // Set - evita reler a planilha pra cada e-mail dentro da mesma execucao

async function carregarIds() {
  if (_cacheIds) return _cacheIds;
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${ABA}!A2:A5000`);
    _cacheIds = new Set((d.values || []).map((r) => r[0]));
  } catch {
    _cacheIds = new Set();
  }
  return _cacheIds;
}

export async function jaArquivado(emailId) {
  const ids = await carregarIds();
  return ids.has(emailId);
}

export async function marcarArquivado(emailId, driveFileId) {
  await garantirAba();
  await sheetsRequest(SHEET_ID, `/values/${ABA}!A:C:append?valueInputOption=USER_ENTERED`, 'POST', {
    values: [[emailId, new Date().toISOString(), driveFileId || '']],
  });
  (await carregarIds()).add(emailId);
}
