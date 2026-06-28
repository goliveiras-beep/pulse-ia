// api/auth/callback.js — Google OAuth callback
export const config = { maxDuration: 10 };
import { createHash } from 'crypto';
import { sheetsRequest } from '../../lib/google-auth.js';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }

async function getSheet(range) {
  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch { return []; }
}

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(302, '/api/app?erro=acesso_negado');
  }

  if (!code) {
    return res.redirect(302, '/api/app');
  }

  try {
    // Troca o code pelo token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.PULSE_BASE_URL || 'https://pulse-ia-six.vercel.app'}/api/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token inválido');

    // Pega o email do usuário
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();
    const email = (user.email || '').toLowerCase();

    // Verifica domínio
    if (!email.endsWith('@livemode.com.br')) {
      return res.redirect(302, '/api/app?erro=dominio_invalido');
    }

    // Busca o colaborador na planilha pelo email (coluna J = índice 9)
    const equipe = await getSheet('Equipe!A2:J50');
    const usuario = equipe.find(r => (r[9] || '').toLowerCase() === email);

    if (!usuario) {
      return res.redirect(302, '/api/app?erro=usuario_nao_encontrado');
    }

    const nome = usuario[0]; // coluna A = nome

    // Cria sessão
    const ts = String(Date.now());
    const h = hash(nome + ts);
    const token = Buffer.from(`${nome}|${h}|${ts}`).toString('base64');
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
    return res.redirect(302, '/api/app');

  } catch (err) {
    console.error('OAuth error:', err);
    return res.redirect(302, '/api/app?erro=falha_auth');
  }
}
