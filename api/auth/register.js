// api/auth/register.js — Cadastro de novo colaborador
export const config = { maxDuration: 10 };
import { createHash } from 'crypto';
import { sheetsRequest } from '../../lib/google-auth.js';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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
    const nomeGoogle = decodeURIComponent(parts[2] || '');
    const accessToken = parts[3] || '';
    const refreshToken = parts[4] || '';
    if (!email) return null;
    return { email, nomeGoogle, accessToken, refreshToken };
  } catch {
    return null;
  }
}

async function getSheet(range) {
  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch {
    return [];
  }
}

function setSession(res, nome, accessToken = '', refreshToken = '') {
  const ts = String(Date.now());
  const sessionData = `${nome}~~${accessToken}~~${refreshToken}`;
  const h = hash(sessionData + ts);
  const token = Buffer.from(`${sessionData}|${h}|${ts}`).toString('base64');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX}; HttpOnly; SameSite=Lax`);
}

function paginaAguardando() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Pulse</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center}.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:40px;width:400px;text-align:center;color:#e2e8f0}.icon{font-size:48px;margin-bottom:16px}h1{font-size:20px;font-weight:700;margin-bottom:8px}p{font-size:13px;color:#718096;line-height:1.6;margin-bottom:6px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;margin:12px 3px 0;animation:pulse 1.4s ease-in-out infinite}.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}@keyframes pulse{0%,80%,100%{transform:scale(0);opacity:.5}40%{transform:scale(1);opacity:1}}</style>
</head><body><div class="box">
  <div class="icon">⏳</div>
  <h1>Aguardando aprovação</h1>
  <p>Seus dados foram enviados.<br>O gestor vai liberar seu acesso em breve.</p>
  <p style="font-size:11px;color:#4a5568;margin-top:8px">Verificando automaticamente...</p>
  <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
</div>
<script>
// Verifica a cada 5 segundos se foi aprovado
setInterval(async function() {
  try {
    const r = await fetch('/api/auth/check-status', { credentials: 'include' });
    const d = await r.json();
    if (d.status === 'ativo') {
      window.location.href = '/api/app';
    }
  } catch(e) {}
}, 5000);
</script>
</body></html>`;
}

export default async function handler(req, res) {
  const session = getOAuthSession(req);
  if (!session) return res.redirect(302, '/api/app');
  const { email, nomeGoogle, accessToken, refreshToken } = session;

  // POST — salvar cadastro
  if (req.method === 'POST') {
    const { nome, cpf, rg, nascimento, telefone, endereco } = req.body || {};
    if (!nome || !cpf || !rg || !nascimento || !endereco) {
      return res.redirect(302, '/api/auth/register?erro=campos');
    }
    try {
      // Anti-duplicata: checa se email já existe
      const existingRows = await getSheet('Equipe!A2:L200');
      const jaExiste = existingRows.find(r => (r[9] || '').toLowerCase() === email.toLowerCase());
      if (jaExiste) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(paginaAguardando());
      }
      const fmtNum = v => v ? "'" + String(v) : '';
      const nextRow = existingRows.length + 2;
      await sheetsRequest(
        process.env.GOOGLE_SHEET_ID,
        `/values/${encodeURIComponent('Equipe!A' + nextRow + ':L' + nextRow)}?valueInputOption=USER_ENTERED`,
        'PUT',
        { values: [[nome, '', '', fmtNum(cpf), fmtNum(rg), nascimento, endereco, '', 'colaborador', email, 'pendente', fmtNum(telefone)]] }
      );
    } catch (e) {
      console.error('Register error:', e.message);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaAguardando());
  }

  // GET — verificar se já tem cadastro
  const equipe = await getSheet('Equipe!A2:L200');
  const usuario = equipe.find(r => (r[9] || '').toLowerCase() === email.toLowerCase());

  if (usuario) {
    const status = (usuario[10] || 'ativo').toLowerCase();
    if (status === 'ativo') {
      setSession(res, usuario[0], accessToken, refreshToken);
      return res.redirect(302, '/api/app');
    }
    if (status === 'pendente') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(paginaAguardando());
    }
    return res.redirect(302, '/api/app?erro=acesso_negado');
  }

  // Novo usuário — formulário de cadastro
  const erro = req.query.erro === 'campos'
    ? '<div style="background:#1f1010;border:1px solid #3d2020;border-radius:8px;padding:10px;font-size:12px;color:#fc8181;margin-bottom:16px">Preencha todos os campos obrigatórios.</div>'
    : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Cadastro</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:32px;width:480px;max-width:100%}h1{text-align:center;font-size:20px;font-weight:700;color:#e2e8f0;margin-bottom:6px}.sub{text-align:center;font-size:13px;color:#718096;margin-bottom:20px}.email-badge{background:#1e2230;border:1px solid #2d3748;border-radius:8px;padding:8px 14px;font-size:13px;color:#63b3ed;margin-bottom:20px;text-align:center}.info{background:#1a2744;border:1px solid #2a4080;border-radius:8px;padding:10px 14px;font-size:12px;color:#63b3ed;margin-bottom:20px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{margin-bottom:12px}.field label{display:block;font-size:10px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}.field input{width:100%;background:#1e2230;border:1px solid #2d3748;border-radius:8px;padding:10px 12px;font-size:13px;color:#e2e8f0;outline:none}.field input:focus{border-color:#4a90d9}.btn{width:100%;background:#1d4ed8;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;margin-top:8px}.btn:disabled{opacity:.5;cursor:not-allowed}</style>
</head><body><div class="box">
  <h1>Complete seu cadastro</h1>
  <p class="sub">Preencha seus dados para solicitar acesso ao Pulse</p>
  ${erro}
  <div class="info">📋 Seu acesso será liberado após aprovação do gestor.</div>
  <div class="email-badge">✉ ${esc(email)}</div>
  <form method="POST" action="/api/auth/register" onsubmit="this.querySelector('.btn').disabled=true;this.querySelector('.btn').textContent='Enviando...'">
    <div class="field"><label>Nome completo *</label><input type="text" name="nome" value="${esc(nomeGoogle)}" required></div>
    <div class="grid2">
      <div class="field"><label>CPF *</label><input type="text" name="cpf" placeholder="000.000.000-00" required></div>
      <div class="field"><label>RG *</label><input type="text" name="rg" placeholder="00.000.000-0" required></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Data de nascimento *</label><input type="date" name="nascimento" required></div>
      <div class="field"><label>Telefone</label><input type="tel" name="telefone" placeholder="(21) 99999-9999"></div>
    </div>
    <div class="field"><label>Endereço *</label><input type="text" name="endereco" placeholder="Rua, número, bairro, cidade" required></div>
    <button type="submit" class="btn">Solicitar acesso</button>
  </form>
</div></body></html>`);
}
