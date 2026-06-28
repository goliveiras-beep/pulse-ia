// api/auth/callback.js — Google OAuth callback com cadastro + aprovação
export const config = { maxDuration: 10 };
import { createHash } from 'crypto';
import { sheetsRequest } from '../../lib/google-auth.js';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function getSheet(range) {
  try { const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}
async function appendSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, 'POST', { values });
}
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', { values });
}

function cadastroPage(email, nomeGoogle, erro = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Complete seu cadastro</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:32px;width:480px;max-width:100%}
.logo{width:44px;height:44px;border-radius:10px;background:#e53e3e;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
h1{text-align:center;font-size:20px;font-weight:700;color:#e2e8f0;margin-bottom:6px}
.sub{text-align:center;font-size:13px;color:#718096;margin-bottom:24px}
.email-badge{background:#1e2230;border:1px solid #2d3748;border-radius:8px;padding:8px 14px;font-size:13px;color:#63b3ed;margin-bottom:20px;text-align:center}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.field{margin-bottom:12px}
.field label{display:block;font-size:10px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.field input{width:100%;background:#1e2230;border:1px solid #2d3748;border-radius:8px;padding:10px 12px;font-size:13px;color:#e2e8f0;outline:none}
.field input:focus{border-color:#4a90d9}
.field input[readonly]{color:#718096;cursor:default}
.btn{width:100%;background:#1d4ed8;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;margin-top:8px}
.btn:hover{background:#1e40af}
.erro{background:#1f1010;border:1px solid #3d2020;border-radius:8px;padding:10px 14px;font-size:12px;color:#fc8181;margin-bottom:16px}
.info{background:#1a2744;border:1px solid #2a4080;border-radius:8px;padding:10px 14px;font-size:12px;color:#63b3ed;margin-bottom:20px}
</style>
</head>
<body>
<div class="box">
  <div class="logo">
    <svg width="24" height="24" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
      <path d="M36 54 C18 44 13 30 16 18 C19 7 30 3 36 10 C42 3 53 7 56 18 C59 30 54 44 36 54Z" fill="#fff" opacity="0.95"/>
      <polyline points="10,34 16,34 19,28 22,40 25,22 28,46 31,33 41,33 44,27 47,39 50,34 62,34" fill="none" stroke="#e53e3e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <h1>Complete seu cadastro</h1>
  <p class="sub">Preencha seus dados para solicitar acesso ao Pulse</p>
  ${erro ? `<div class="erro">⚠️ ${esc(erro)}</div>` : ''}
  <div class="info">📋 Seu acesso será liberado após aprovação do gestor.</div>
  <div class="email-badge">✉ ${esc(email)}</div>
  <form method="POST" action="/api/auth/callback?step=cadastro">
    <input type="hidden" name="email" value="${esc(email)}">
    <div class="field"><label>Nome completo *</label><input type="text" name="nome" value="${esc(nomeGoogle)}" required></div>
    <div class="grid2">
      <div class="field"><label>CPF *</label><input type="text" name="cpf" placeholder="000.000.000-00" required maxlength="14"></div>
      <div class="field"><label>RG *</label><input type="text" name="rg" placeholder="00.000.000-0" required maxlength="12"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Data de nascimento *</label><input type="date" name="nascimento" required></div>
      <div class="field"><label>Telefone</label><input type="tel" name="telefone" placeholder="(21) 99999-9999"></div>
    </div>
    <div class="field"><label>Endereço *</label><input type="text" name="endereco" placeholder="Rua, número, bairro, cidade" required></div>
    <button type="submit" class="btn">Solicitar acesso</button>
  </form>
</div>
</body>
</html>`;
}

function pendentePageHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Aguardando aprovação</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:40px 36px;width:400px;max-width:calc(100vw - 32px);text-align:center}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:20px;font-weight:700;color:#e2e8f0;margin-bottom:8px}
p{font-size:13px;color:#718096;line-height:1.6}
</style>
</head>
<body>
<div class="box">
  <div class="icon">⏳</div>
  <h1>Cadastro enviado!</h1>
  <p>Seus dados foram recebidos.<br>Aguarde a aprovação do gestor para acessar o portal.</p>
</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const BASE_URL = process.env.PULSE_BASE_URL || 'https://pulse-ia-six.vercel.app';

  // ── Passo 2: salvar cadastro enviado pelo formulário ──────────────────────
  if (req.method === 'POST' && req.query.step === 'cadastro') {
    const { email, nome, cpf, rg, nascimento, telefone, endereco } = req.body || {};
    if (!email || !nome || !cpf || !rg || !nascimento || !endereco) {
      return res.setHeader('Content-Type','text/html; charset=utf-8'),
             res.status(200).send(cadastroPage(email||'', nome||'', 'Preencha todos os campos obrigatórios.'));
    }
    // Verifica se já existe
    const equipe = await getSheet('Equipe!A2:K200');
    const jaExiste = equipe.find(r => (r[9]||'').toLowerCase() === email.toLowerCase());
    if (jaExiste) {
      // Já tem cadastro — redireciona
      if (jaExiste[10] === 'ativo') return res.redirect(302, '/api/app');
      return res.setHeader('Content-Type','text/html; charset=utf-8'),
             res.status(200).send(pendentePageHTML());
    }
    // A=Nome B=Cargo C=Nucleo D=CPF E=RG F=DataNasc G=Endereco H='' I=Perfil J=Email K=Status L=Telefone
    await appendSheet('Equipe!A:L', [[nome, '', '', cpf, rg, nascimento, endereco, '', 'colaborador', email, 'pendente', telefone||'']]);
    return res.setHeader('Content-Type','text/html; charset=utf-8'),
           res.status(200).send(pendentePageHTML());
  }

  // ── Passo 1: callback do Google OAuth ────────────────────────────────────
  const { code, error } = req.query;
  if (error) return res.redirect(302, '/api/app?erro=acesso_negado');
  if (!code) return res.redirect(302, '/api/app');

  try {
    // Troca code por token
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

    // Pega dados do Google e planilha em paralelo
    const [userRes, equipe] = await Promise.all([
      fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }),
      getSheet('Equipe!A2:K200'),
    ]);
    const googleUser = await userRes.json();
    const email = (googleUser.email || '').toLowerCase();
    const nomeGoogle = googleUser.name || email.split('@')[0];
    if (!email) throw new Error('Email não obtido');

    const usuario = equipe.find(r => (r[9]||'').toLowerCase() === email);

    if (!usuario) {
      // Novo — mostra formulário de cadastro
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(cadastroPage(email, nomeGoogle));
    }

    const status = (usuario[10] || 'ativo').toLowerCase();

    if (status === 'pendente') {
      // Aguardando aprovação
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(pendentePageHTML());
    }

    if (status === 'rejeitado') {
      return res.redirect(302, '/api/app?erro=acesso_negado');
    }

    // Ativo — cria sessão
    const nome = usuario[0];
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
