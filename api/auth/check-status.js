// api/auth/check-status.js — Verifica status do usuário OAuth pendente
export const config = { maxDuration: 10 };
import { createHash } from 'crypto';
import { sheetsRequest } from '../../lib/google-auth.js';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }

function getOAuthSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    cookies[k.trim()] = v.join('=');
  });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (!data.startsWith('~~OAUTH~~')) return null;
    if (Date.now() - parseInt(ts) > COOKIE_MAX * 1000) return null;
    if (h !== hash(data + ts)) return null;
    const parts = data.split('~~').filter(Boolean);
    const email = parts[1] || '';
    const accessToken = parts[3] || '';
    const refreshToken = parts[4] || '';
    if (!email) return null;
    return { email, accessToken, refreshToken };
  } catch {
    return null;
  }
}

function setSession(res, nome, accessToken = '', refreshToken = '') {
  const ts = String(Date.now());
  const sessionData = `${nome}~~${accessToken}~~${refreshToken}`;
  const h = hash(sessionData + ts);
  const token = Buffer.from(`${sessionData}|${h}|${ts}`).toString('base64');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
}

export default async function handler(req, res) {
  const session = getOAuthSession(req);
  if (!session) return res.status(401).json({ status: 'nao_autenticado' });

  const { email, accessToken, refreshToken } = session;

  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:L200')}`);
    const equipe = d.values || [];
    const usuario = equipe.find(r => (r[9] || '').toLowerCase() === email.toLowerCase());

    if (!usuario) return res.status(200).json({ status: 'pendente' });

    const status = (usuario[10] || 'ativo').toLowerCase();

    if (status === 'ativo') {
      // Seta sessão definitiva para quando redirecionar
      setSession(res, usuario[0], accessToken, refreshToken);
      return res.status(200).json({ status: 'ativo' });
    }

    return res.status(200).json({ status });
  } catch (e) {
    return res.status(500).json({ status: 'erro', error: e.message });
  }
}
