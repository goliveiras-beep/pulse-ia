// api/chat.js — Proxy seguro para o chat IA do Pulse
export const config = { maxDuration: 30 };
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + process.env.PULSE_SECRET || 'pulse2026').digest('hex').slice(0,32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const[k,...v]=c.trim().split('=');cookies[k.trim()]=v.join('=');});
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const [nome,h,ts] = d.split('|');
    if (Date.now()-parseInt(ts) > 7*24*3600*1000) return null;
    if (h !== hash(nome+ts)) return null;
    return { nome };
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  const session = getSession(req);
  if (!session) return res.status(401).json({error:'Não autorizado'});

  const { messages, pagina } = req.body || {};
  if (!messages?.length) return res.status(400).json({error:'Mensagens inválidas'});

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: `Você é o assistente operacional do Pulse IA, dashboard da equipe de TV ao vivo da LiveMode.
Ajuda gestores com: escalas de trabalho, cobertura de eventos ao vivo (Copa do Mundo, futebol, programas), alertas trabalhistas (interjornada mínima 11h, máx 10h/dia, 7 dias consecutivos), e decisões operacionais.
Usuário logado: ${session.nome}. Página atual: ${pagina||'/'}.
Seja direto, prático, use linguagem informal brasileira. Máx 3 parágrafos. Use bullets para listas.`,
        messages: messages.slice(-10)
      })
    });

    const d = await r.json();
    const resposta = d.content?.[0]?.text || 'Não consegui responder agora.';
    return res.status(200).json({ ok: true, resposta });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
