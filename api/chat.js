// api/chat.js — Proxy chat IA usando Groq
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

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  const session = getSession(req);
  if (!session) return res.status(401).json({error:'Não autorizado'});

  const body = await parseBody(req);
  const { messages, pagina } = body;
  if (!messages?.length) return res.status(400).json({error:'Mensagens inválidas'});

  const sistema = `Você é o assistente operacional do Pulse IA, dashboard da equipe de TV ao vivo da LiveMode.
IMPORTANTE: Você NÃO tem acesso à planilha de escalas nem ao Airtable. Quando perguntarem sobre dados específicos (quem está trabalhando, horários, eventos), diga claramente que não tem acesso aos dados em tempo real e oriente o usuário a verificar diretamente na tela de Escala ou Home do Pulse.
Você PODE ajudar com: dúvidas sobre regras trabalhistas, como interpretar alertas, boas práticas de escala, sugestões gerais de cobertura, e como usar o Pulse.
Usuário: ${session.nome}. Página atual: ${pagina||'/'}.
Responda em português brasileiro informal. Seja direto e conciso. NÃO invente dados. NÃO use tabelas markdown. Use texto simples com bullets (•) se precisar listar.`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 600,
        messages: [
          { role: 'system', content: sistema },
          ...messages.slice(-10)
        ]
      })
    });

    const d = await r.json();
    if (d.error) return res.status(500).json({error: d.error.message});
    const resposta = d.choices?.[0]?.message?.content || 'Não consegui responder agora.';
    return res.status(200).json({ ok: true, resposta });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
