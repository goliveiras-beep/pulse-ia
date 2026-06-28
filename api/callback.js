// api/auth/callback.js — Google OAuth callback com auto-cadastro
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

async function appendSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, 'POST', { values });
}

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) return res.redirect(302, '/api/app?erro=acesso_negado');
  if (!code) return res.redirect(302, '/api/app');

  try {
    // 1. Troca o code pelo token
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

    // 2. Pega dados do usuário Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();
    const email = (googleUser.email || '').toLowerCase();
    const nomeGoogle = googleUser.name || email.split('@')[0];

    if (!email) throw new Error('Email não obtido');

    // 3. Busca na planilha pelo email (coluna J = índice 9)
    const equipe = await getSheet('Equipe!A2:J200');
    const usuarioExistente = equipe.find(r => (r[9] || '').toLowerCase() === email);

    let nomeLogin;

    if (usuarioExistente) {
      // Já cadastrado — usa o nome da planilha
      nomeLogin = usuarioExistente[0];
    } else {
      // Novo usuário — auto-cadastra na planilha
      // Colunas: A=Nome, B=Cargo, C=Nucleo, D='', E='', F='', G='', H='', I=acesso, J=email
      nomeLogin = nomeGoogle;
      await appendSheet('Equipe!A:J', [[nomeGoogle, '', '', '', '', '', '', '', 'colaborador', email]]);
    }

    // 4. Cria sessão
    const ts = String(Date.now());
    const h = hash(nomeLogin + ts);
    const token = Buffer.from(`${nomeLogin}|${h}|${ts}`).toString('base64');
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
    return res.redirect(302, '/api/app');

  } catch (err) {
    console.error('OAuth error:', err);
    return res.redirect(302, '/api/app?erro=falha_auth');
  }
}
