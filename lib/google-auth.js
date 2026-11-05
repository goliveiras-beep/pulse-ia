// lib/google-auth.js
// Gera token OAuth2 automaticamente via Service Account
// Variável de ambiente necessária: GOOGLE_SERVICE_ACCOUNT_JSON
// Cole o conteúdo do arquivo JSON da service account como string na Vercel

// JWT RS256 assinado com WebCrypto (crypto.subtle) em vez do google-auth-library: roda igual no
// Node (Vercel) e no Cloudflare Workers, sem depender de gaxios/fs.
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let _cache = { token: null, exp: 0, key: null, raw: null };

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importarChave(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function getAccessToken() {
  const agora = Math.floor(Date.now() / 1000);
  if (_cache.token && _cache.exp - 60 > agora) return _cache.token;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurada');
  const credentials = JSON.parse(raw);
  if (_cache.raw !== raw) _cache = { token: null, exp: 0, key: await importarChave(credentials.private_key), raw };

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: credentials.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  }));
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', _cache.key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(assinatura)}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(`Google token [${r.status}]: ${JSON.stringify(data)}`);
  _cache.token = data.access_token;
  _cache.exp = agora + (data.expires_in || 3600);
  return _cache.token;
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

// ── Cache curto de leituras (só no Cloudflare Workers; na Vercel/Node não existe `caches`) ──
// Opt-in: só vale quando quem chama passa { cache: true } (leituras de renderização de página).
// Leituras que antecedem uma gravação por número de linha NUNCA passam isso — sempre vão frescas.
// Qualquer gravação feita via sheetsRequest (ou chamando invalidarCacheSheets) troca a "geração" e
// invalida tudo de uma vez. Edição manual na planilha ou gravação vinda de outro ambiente (ex.: a
// Vercel, enquanto ela ainda roda) só aparece depois do TTL.
const CACHE_TTL = 15; // segundos
const CACHE_HOST = 'https://sheets-cache.pulse.internal';
function cacheDisponivel() { return typeof caches !== 'undefined' && !!caches.default; }

async function geracaoAtual() {
  const c = caches.default;
  const hit = await c.match(CACHE_HOST + '/gen');
  if (hit) return hit.text();
  const g = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  await c.put(CACHE_HOST + '/gen', new Response(g, { headers: { 'Cache-Control': 'max-age=86400' } }));
  return g;
}

export async function invalidarCacheSheets() {
  if (!cacheDisponivel()) return;
  try {
    const g = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await caches.default.put(CACHE_HOST + '/gen', new Response(g, { headers: { 'Cache-Control': 'max-age=86400' } }));
  } catch {}
}

export async function sheetsRequest(sheetId, path, method = 'GET', body = null, opcoes = {}) {
  const usarCache = !!opcoes.cache && method === 'GET' && path.startsWith('/values/') && cacheDisponivel();
  let chaveCache = null;
  if (usarCache) {
    try {
      chaveCache = `${CACHE_HOST}/${await geracaoAtual()}/${sheetId}${path}`;
      const hit = await caches.default.match(chaveCache);
      if (hit) return hit.json();
    } catch { chaveCache = null; }
  }
  const token = await getAccessToken();
  // 429 (cota de leituras/min) e 5xx são transitórios: repete com espera crescente. Só em GET —
  // escrita repetida poderia duplicar linha.
  let res;
  for (let tentativa = 0; ; tentativa++) {
    res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (res.ok || method !== 'GET' || tentativa >= 2 || (res.status !== 429 && res.status < 500)) break;
    await new Promise(r => setTimeout(r, 700 * (tentativa + 1)));
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API [${res.status}]: ${err}`);
  }

  if (method !== 'GET') await invalidarCacheSheets();

  const dados = await res.json();
  if (chaveCache) {
    try {
      await caches.default.put(chaveCache, new Response(JSON.stringify(dados), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL}` },
      }));
    } catch {}
  }
  return dados;
}
