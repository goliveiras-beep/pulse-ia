// lib/google-auth.js
// Gera token OAuth2 automaticamente via Service Account
// Variável de ambiente necessária: GOOGLE_SERVICE_ACCOUNT_JSON
// Cole o conteúdo do arquivo JSON da service account como string na Vercel

import { GoogleAuth } from 'google-auth-library';

let _cachedClient = null;

function getAuth() {
  if (_cachedClient) return _cachedClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurada');

  const credentials = JSON.parse(raw);

  _cachedClient = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return _cachedClient;
}

export async function getAccessToken() {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// Garante que a aba tenha pelo menos "minLinhas" - sem isso, qualquer PUT/append que escreva
// além do tamanho atual da grade falha com "Range exceeds grid limits" (aconteceu de verdade em
// 2026-09-14: aba Escala com 1319 linhas, escrita tentando ir até a 1320). Cresce em blocos de
// 2000 pra não precisar chamar isso de novo tão cedo.
export async function garantirLinhasSheet(sheetId, nomeAba, minLinhas) {
  const token = await getAccessToken();
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();
  const aba = (meta.sheets || []).find(s => s.properties?.title === nomeAba);
  if (!aba) return; // aba não existe - não é problema desta função resolver
  const rowCountAtual = aba.properties.gridProperties?.rowCount || 0;
  if (rowCountAtual >= minLinhas) return;
  const novoRowCount = Math.max(minLinhas, rowCountAtual) + 2000;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: aba.properties.sheetId, gridProperties: { rowCount: novoRowCount } },
          fields: 'gridProperties.rowCount',
        },
      }],
    }),
  });
}

export async function sheetsRequest(sheetId, path, method = 'GET', body = null) {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API [${res.status}]: ${err}`);
  }

  return res.json();
}
