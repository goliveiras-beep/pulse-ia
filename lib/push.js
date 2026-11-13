// lib/push.js — envio de Web Push (notificação no celular/computador) usando só VAPID, SEM payload.
// O push chega "vazio" e o service worker (sw.js) busca o texto em /api/push?acao=pendentes. Assim não precisa
// da criptografia de payload (RFC 8291) e o texto nunca passa pelo servidor do Google/Apple.
// Chaves: VAPID_PUBLIC (var em wrangler.toml) e VAPID_PRIVATE_JWK (secret, JSON da chave privada P-256).

function b64u(bytes) {
  let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Só aceita endereços de push dos serviços de verdade (evita o servidor ser usado pra chamar qualquer URL).
const HOSTS_PUSH = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function endpointValido(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && endpoint.length < 1000 && HOSTS_PUSH.some(r => r.test(u.hostname)); }
  catch { return false; }
}

export const chavePublica = () => process.env.VAPID_PUBLIC || '';

let chaveCache = null;
async function chavePrivada() {
  if (chaveCache) return chaveCache;
  const txt = process.env.VAPID_PRIVATE_JWK;
  if (!txt) return null;
  chaveCache = await crypto.subtle.importKey('jwk', JSON.parse(txt), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return chaveCache;
}

// Retorna { ok, status, expirou } — expirou = a inscrição não existe mais (404/410) e deve ser apagada.
export async function enviarPush(endpoint) {
  if (!endpointValido(endpoint)) return { ok: false, status: 0, expirou: true };
  const k = await chavePrivada();
  if (!k || !chavePublica()) return { ok: false, status: 0, erro: 'chaves VAPID não configuradas' };
  const enc = (s) => b64u(new TextEncoder().encode(s));
  const cab = enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://pulse.livemode.ai' }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, new TextEncoder().encode(cab + '.' + corpo));
  const jwt = cab + '.' + corpo + '.' + b64u(sig);
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `vapid t=${jwt}, k=${chavePublica()}`, TTL: '86400', Urgency: 'high', 'Content-Length': '0' } });
    return { ok: r.ok, status: r.status, expirou: r.status === 404 || r.status === 410 };
  } catch (e) { return { ok: false, status: 0, erro: String(e && e.message || e).slice(0, 120) }; }
}
