// api/setup-config.js — cria a aba PulseConfig no Google Sheets se não existir
export const config = { maxDuration: 30 };
import { sheetsRequest, getAccessToken } from '../google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function hash(s) { return createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const p=c.trim().split('=');cookies[p.shift()]=p.join('=');});
  const token = cookies[COOKIE_NAME];
  if(!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const last=d.lastIndexOf('|'), sec=d.lastIndexOf('|',last-1);
    const data=d.slice(0,sec), h=d.slice(sec+1,last), ts=d.slice(last+1);
    if(Date.now()-parseInt(ts,10)>7*24*3600*1000) return null;
    if(h!==hash(data+ts)) return null;
    if(data.startsWith('~~OAUTH~~')) return null;
    return { nome: data.split('~~')[0] };
  } catch { return null; }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  // Verificar se é gestor
  try {
    const eq = await sheetsRequest(SHEET_ID,'/values/Equipe!A2:I200').then(d=>d.values||[]);
    const u = eq.find(r=>r[0]===session.nome);
    if (u?.[8] !== 'gestor') return res.redirect(302, '/api/app');
  } catch(e) { return res.status(500).json({error:e.message}); }

  if (req.method === 'GET') {
    // Página HTML com botão
    return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Configuração inicial</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#1c1f26;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}</style>
</head><body>
<div style="background:#242836;border:1px solid #2d3748;border-radius:16px;padding:32px;max-width:480px;width:100%;text-align:center">
  <div style="font-size:48px;margin-bottom:16px">⚙️</div>
  <h1 style="font-size:18px;font-weight:700;margin-bottom:8px">Criar aba PulseConfig</h1>
  <p style="font-size:13px;color:#718096;margin-bottom:24px">Cria a aba <strong style="color:#e2e8f0">PulseConfig</strong> na sua planilha Google Sheets. Necessária para o controle de publicação da escala. Operação segura — não altera nenhuma outra aba.</p>
  <button id="btn" onclick="criar()" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:14px 32px;font-size:15px;font-weight:600;cursor:pointer;width:100%">Criar aba PulseConfig</button>
  <div id="msg" style="display:none;margin-top:16px;font-size:13px;padding:10px;border-radius:8px"></div>
  <div style="margin-top:20px"><a href="/api/app" style="font-size:12px;color:#4a5568">← Voltar para o Pulse</a></div>
</div>
<script>
async function criar(){
  var btn=document.getElementById('btn'),msg=document.getElementById('msg');
  btn.textContent='Criando...';btn.disabled=true;btn.style.background='#374151';
  try{
    var r=await fetch('/api/setup-config',{method:'POST',credentials:'include'});
    var d=await r.json();
    msg.style.display='block';
    if(d.ok){
      msg.style.background='#0d2010';msg.style.color='#68d391';
      msg.textContent='✓ '+d.mensagem;
      btn.textContent='✓ Concluído';btn.style.background='#166534';
      setTimeout(()=>window.location='/api/app',2000);
    } else {
      msg.style.background='#1f1010';msg.style.color='#fc8181';
      msg.textContent='Erro: '+(d.error||'?');
      btn.textContent='Tentar novamente';btn.disabled=false;btn.style.background='#1d4ed8';
    }
  }catch(e){
    msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';
    msg.textContent='Erro de conexão: '+e.message;
    btn.textContent='Tentar novamente';btn.disabled=false;btn.style.background='#1d4ed8';
  }
}
</script>
</body></html>`);
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    // 1. Buscar lista de abas existentes
    const token = await getAccessToken();
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const meta = await metaRes.json();
    const sheets = (meta.sheets||[]).map(s=>s.properties?.title);

    if (sheets.includes('PulseConfig')) {
      return res.status(200).json({ ok: true, mensagem: 'Aba PulseConfig já existia — nada alterado.' });
    }

    // 2. Criar a aba
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'PulseConfig' } } }] })
    });

    // 3. Adicionar cabeçalho
    await sheetsRequest(SHEET_ID, `/values/PulseConfig!A1:B1?valueInputOption=USER_ENTERED`, 'PUT', {
      values: [['chave', 'valor']]
    });

    return res.status(200).json({ ok: true, mensagem: 'Aba PulseConfig criada com sucesso! Redirecionando...' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
