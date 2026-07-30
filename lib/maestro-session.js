// lib/maestro-session.js
// leitura do pulse_session (mesmo cookie do portal Pulse IA) - MAESTRO nao tem
// login proprio, reaproveita quem ja esta autenticado no Pulse. so leitura: nunca
// cria/edita esse cookie por aqui, isso continua sendo responsabilidade de api/app.js
// e api/auth/*.
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const parts = c.trim().split('=');
    const k = parts.shift();
    cookies[k] = parts.join('=');
  });
  return cookies;
}

export function getPulseSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(data + ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch {
    return null;
  }
}
