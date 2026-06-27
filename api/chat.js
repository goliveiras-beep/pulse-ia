// api/chat.js — Proxy chat IA com contexto da planilha
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
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

async function getSheet(range) {
  try { const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  const session = getSession(req);
  if (!session) return res.status(401).json({error:'Não autorizado'});

  const body = await parseBody(req);
  const { messages, pagina } = body;
  if (!messages?.length) return res.status(400).json({error:'Mensagens inválidas'});

  // Busca dados reais da planilha
  const hoje = getBRT();
  const d14 = new Date(hoje); d14.setDate(hoje.getDate()+14);

  const [escalaRaw, equipeRaw, ausenciasRaw] = await Promise.all([
    getSheet('Escala!A2:F500'),
    getSheet('Equipe!A2:I50'),
    getSheet('Ausencias!A2:I500'),
  ]);

  // Monta contexto de escala dos próximos 14 dias
  const diasContexto = [];
  for (let i = -3; i <= 14; i++) {
    const d = new Date(hoje); d.setDate(hoje.getDate()+i);
    const df = fmtData(d);
    const escalaDia = escalaRaw.filter(r => r[0]===df && r[3] && r[4] && r[5]!=='Folga');
    const folgasDia = escalaRaw.filter(r => r[0]===df && r[5]==='Folga');
    const ausenciasDia = ausenciasRaw.filter(a => a[1] && (a[4]===df||a[5]===df));
    if (escalaDia.length > 0 || folgasDia.length > 0) {
      diasContexto.push(`${df}: ${escalaDia.map(r=>`${r[2]} ${r[3]}-${r[4]}`).join(', ')}${folgasDia.length?` | Folga: ${folgasDia.map(r=>r[2]).join(', ')}`:''}${ausenciasDia.length?` | Ausente: ${ausenciasDia.map(a=>a[1]).join(', ')}`:''}`)
    }
  }

  const equipeAtiva = equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo').map(r=>`${r[0]} (${r[1]||'Op'}, ${r[5]||'CLT'})`).join(', ');

  const contextoEscala = diasContexto.length > 0
    ? `\n\nESCALA REAL (últimos 3 dias + próximos 14 dias):\n${diasContexto.join('\n')}`
    : '';

  const sistema = `Você é o assistente operacional do Pulse IA, dashboard da equipe de TV ao vivo da LiveMode.
Você TEM ACESSO aos dados reais de escala abaixo. Use-os para responder perguntas específicas sobre quem está trabalhando, horários, folgas e cobertura.
Usuário: ${session.nome}. Página: ${pagina||'/'}.
Data/hora atual BRT: ${hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}.

EQUIPE ATIVA: ${equipeAtiva}${contextoEscala}

Responda em português brasileiro informal. Seja direto e conciso. Use bullets (•) para listas. Máx 4 parágrafos.`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 700,
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
