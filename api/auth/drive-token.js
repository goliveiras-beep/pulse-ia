// api/auth/drive-token.js — Endpoint único para capturar refresh_token do gestor para Drive
export const config = { maxDuration: 30 };

const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

export default async function handler(req, res) {
  const BASE_URL = process.env.PULSE_BASE_URL || 'https://pulse-ia-six.vercel.app';
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  const { code, error } = req.query;

  // Passo 1: sem code → redireciona para OAuth do Google pedindo Drive
  if (!code && !error) {
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(BASE_URL + '/api/auth/drive-token')}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive')}` +
      `&access_type=offline` +
      `&prompt=consent`;
    return res.redirect(302, oauthUrl);
  }

  if (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<h2>Erro: ${error}</h2>`);
  }

  // Passo 2: recebeu code → troca por tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: `${BASE_URL}/api/auth/drive-token`,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`
        <h2>Erro: refresh_token não retornado</h2>
        <p>Resposta: ${JSON.stringify(tokenData)}</p>
        <p><a href="/api/auth/drive-token">Tentar de novo</a></p>
      `);
    }

    const refreshToken = tokenData.refresh_token;

    // Passo 3: salva na Vercel via API
    let saved = false;
    if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
      try {
        const vercelRes = await fetch(
          `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${VERCEL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: 'GOOGLE_DRIVE_REFRESH_TOKEN',
              value: refreshToken,
              type: 'encrypted',
              target: ['production', 'preview'],
            }),
          }
        );
        const vercelData = await vercelRes.json();
        saved = vercelRes.ok || vercelData.error?.code === 'ENV_ALREADY_EXISTS';

        // Se já existe, atualiza
        if (vercelData.error?.code === 'ENV_ALREADY_EXISTS') {
          const listRes = await fetch(
            `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env`,
            { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
          );
          const listData = await listRes.json();
          const existing = listData.envs?.find(e => e.key === 'GOOGLE_DRIVE_REFRESH_TOKEN');
          if (existing) {
            const updateRes = await fetch(
              `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env/${existing.id}`,
              {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: refreshToken }),
              }
            );
            saved = updateRes.ok;
          }
        }
      } catch (e) {
        console.error('Vercel API error:', e.message);
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Pulse — Drive Token</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f1117;min-height:100vh;display:flex;align-items:center;justify-content:center}.box{background:#161920;border:1px solid #2d3748;border-radius:16px;padding:40px;width:480px;text-align:center;color:#e2e8f0}.icon{font-size:48px;margin-bottom:16px}h1{font-size:20px;font-weight:700;margin-bottom:12px}p{font-size:13px;color:#718096;line-height:1.6;margin-bottom:8px}.token{background:#1e2230;border:1px solid #2d3748;border-radius:8px;padding:10px;font-size:11px;color:#63b3ed;word-break:break-all;margin:12px 0;text-align:left}.step{background:#1a2744;border:1px solid #2a4080;border-radius:8px;padding:10px 14px;font-size:12px;color:#63b3ed;margin-top:16px;text-align:left}</style>
</head><body><div class="box">
  <div class="icon">${saved ? '✅' : '⚠️'}</div>
  <h1>${saved ? 'Token salvo com sucesso!' : 'Token gerado — salve manualmente'}</h1>
  ${saved
    ? `<p>O <code>GOOGLE_DRIVE_REFRESH_TOKEN</code> foi salvo na Vercel automaticamente.</p>
       <p style="color:#68d391;margin-top:8px">Faça um redeploy na Vercel para ativar.</p>`
    : `<p>Copie o token abaixo e adicione manualmente na Vercel como variável <code>GOOGLE_DRIVE_REFRESH_TOKEN</code>:</p>
       <div class="token">${refreshToken}</div>
       <div class="step">1. Vercel → Settings → Environment Variables<br>2. Add: GOOGLE_DRIVE_REFRESH_TOKEN<br>3. Cole o token acima<br>4. Redeploy</div>`
  }
</div></body></html>`);

  } catch (err) {
    console.error('drive-token error:', err.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<h2>Erro: ${err.message}</h2>`);
  }
}
