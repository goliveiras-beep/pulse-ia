// api/auth/callback.js — Google OAuth callback (lean)
export const config = { maxDuration: 10 };
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }

export default async function handler(req, res) {
  const BASE_URL = process.env.PULSE_BASE_URL || 'https://pulse-ia-six.vercel.app';
  const { code, error } = req.query;
  if (error) return res.redirect(302, '/api/app?erro=acesso_negado');
  if (!code) return res.redirect(302, '/api/app');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${BASE_URL}/api/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token inválido');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();
    const email = (googleUser.email || '').toLowerCase();
    const nomeGoogle = googleUser.name || email.split('@')[0];
    if (!email) throw new Error('Email não obtido');

    // Salva email+nome no cookie e manda pro register
    const sessionData = `__oauth__${email}__${nomeGoogle}`;
    const ts = String(Date.now());
    const h = hash(sessionData + ts);
    const token = Buffer.from(`${sessionData}|${h}|${ts}`).toString('base64');
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
    return res.redirect(302, '/api/auth/register');

  } catch (err) {
    console.error('OAuth error:', err.message);
    return res.redirect(302, '/api/app?erro=falha_auth');
  }
}
