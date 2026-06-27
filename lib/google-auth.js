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
