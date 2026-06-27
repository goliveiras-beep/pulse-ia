import { createHash, createSign } from 'crypto';

// ── helpers de sessão ─────────────────────────────────────────────────────────

function hash(s) {
  return createHash('sha256')
    .update(s + (process.env.PULSE_SECRET || 'pulse2026'))
    .digest('hex')
    .slice(0, 32);
}

function parseSession(req) {
  const raw = req.headers.cookie?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('pulse_session='))
    ?.split('=')[1];
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const [nome, h, ts] = decoded.split('|');
    if (hash(nome + ts) !== h) return null;
    if (Date.now() - Number(ts) > 7 * 24 * 60 * 60 * 1000) return null;
    return { nome };
  } catch { return null; }
}

// ── Google Sheets via fetch (sem googleapis) ──────────────────────────────────

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const sigInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${sigInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Token error: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

// ── Sheets helpers ────────────────────────────────────────────────────────────

async function sheetsGet(token, range) {
  const id  = process.env.GOOGLE_SHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error('Sheets GET error: ' + JSON.stringify(data.error));
  return data.values || [];
}

async function sheetsBatchUpdate(token, updates) {
  const id  = process.env.GOOGLE_SHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
  });
  return res.json();
}

async function sheetsAppend(token, range, values) {
  const id  = process.env.GOOGLE_SHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  return res.json();
}

// ── filtro de escala relevante ────────────────────────────────────────────────

function filtrarEscalaRelevante(linhas) {
  const hoje = new Date();
  return linhas.filter(row => {
    if (!row[0]) return false;
    const [d, m] = row[0].split('/').map(Number);
    if (!d || !m) return false;
    const data = new Date(hoje.getFullYear(), m - 1, d);
    const diff = (data - hoje) / (1000 * 60 * 60 * 24);
    return diff >= -3 && diff <= 14;
  });
}

// ── detecção de intenção de escrita ──────────────────────────────────────────

const WRITE_PATTERNS = [
  /adiciona[r]?/i, /inclui[r]?/i, /insere[r]?/i, /coloca[r]?/i,
  /cadastra[r]?/i, /registra[r]?/i, /grava[r]?/i, /salva[r]?/i,
  /bota na escala/i, /adiciona (?:na|a) escala/i,
  /muda[r]? (?:o turno|a escala)/i, /altera[r]?/i, /atualiza[r]?/i,
];

function temIntencaoEscrita(msg) {
  return WRITE_PATTERNS.some(p => p.test(msg));
}

// ── parser de turno ───────────────────────────────────────────────────────────

function parseTurnosDaMensagem(msg, equipe) {
  // Horários: 10h00, 10:00, 10h
  const reHora = /(\d{1,2})[h:](\d{0,2})/g;
  const horas  = [...msg.matchAll(reHora)].map(m => {
    return `${m[1].padStart(2,'0')}:${(m[2]||'00').padStart(2,'0')}`;
  });
  if (horas.length < 2) return null;
  const entrada = horas[0];
  const saida   = horas[1];

  // Datas: 22/06, 22-06
  const reDatas = /(\d{1,2})[\/\-](\d{1,2})/g;
  const datas   = [...msg.matchAll(reDatas)].map(m =>
    `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`
  );
  if (datas.length === 0) return null;

  // Gera intervalo de datas
  const datasAlvo = [];
  if (datas.length >= 2) {
    const [d1, m1] = datas[0].split('/').map(Number);
    const [d2, m2] = datas[1].split('/').map(Number);
    const ano = new Date().getFullYear();
    let cur = new Date(ano, m1 - 1, d1);
    const fim = new Date(ano, m2 - 1, d2);
    while (cur <= fim) {
      datasAlvo.push(
        `${String(cur.getDate()).padStart(2,'0')}/${String(cur.getMonth()+1).padStart(2,'0')}`
      );
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    datasAlvo.push(datas[0]);
  }
  if (datasAlvo.length === 0) return null;

  // Identifica colaborador por nome parcial
  const msgLower = msg.toLowerCase();
  let colaborador = null;
  for (const row of equipe) {
    const nome = (row[0] || '').trim();
    if (!nome) continue;
    for (const parte of nome.toLowerCase().split(' ')) {
      if (parte.length > 3 && msgLower.includes(parte)) {
        colaborador = nome;
        break;
      }
    }
    if (colaborador) break;
  }
  if (!colaborador) return null;

  return { colaborador, entrada, saida, datas: datasAlvo };
}

// ── grava turnos na planilha ──────────────────────────────────────────────────

async function gravarTurnos(token, turno) {
  const rows    = await sheetsGet(token, 'Escala!A2:F500');
  const updates = [];
  const appends = [];

  for (const data of turno.datas) {
    const idx = rows.findIndex(r =>
      r[0] === data &&
      (r[2] || '').trim().toLowerCase() === turno.colaborador.toLowerCase()
    );

    if (idx >= 0) {
      // linha existente — atualiza
      updates.push({
        range: `Escala!C${idx + 2}:E${idx + 2}`,
        values: [[turno.colaborador, turno.entrada, turno.saida]],
      });
    } else {
      // procura linha do dia sem colaborador
      const idxData = rows.findIndex(r => r[0] === data && !r[2]);
      if (idxData >= 0) {
        updates.push({
          range: `Escala!A${idxData + 2}:F${idxData + 2}`,
          values: [[data, '', turno.colaborador, turno.entrada, turno.saida, '']],
        });
      } else {
        appends.push([data, '', turno.colaborador, turno.entrada, turno.saida, '']);
      }
    }
  }

  if (updates.length > 0) await sheetsBatchUpdate(token, updates);
  for (const linha of appends) await sheetsAppend(token, 'Escala!A:F', [linha]);

  // Log Ajustes
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  await sheetsAppend(token, 'Ajustes!A:G', [[
    agora, turno.colaborador, turno.datas.join(', '),
    turno.entrada, turno.saida, '', 'Chat IA',
  ]]);

  return updates.length + appends.length;
}

// ── handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const session = parseSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  if (req.method !== 'POST') return res.status(405).end();

  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message obrigatório' });

  try {
    const token = await getAccessToken();

    const [escalaRows, equipeRows] = await Promise.all([
      sheetsGet(token, 'Escala!A2:F500'),
      sheetsGet(token, 'Equipe!A2:I50'),
    ]);

    const escalaRelevante = filtrarEscalaRelevante(escalaRows);
    const isEscrita = temIntencaoEscrita(message);

    // tenta gravar se for intenção de escrita
    let acaoRealizada = null;
    if (isEscrita) {
      const turno = parseTurnosDaMensagem(message, equipeRows);
      if (turno) {
        const qtd = await gravarTurnos(token, turno);
        acaoRealizada = { ...turno, linhasGravadas: qtd };
      }
    }

    // contexto para o modelo
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const equipeTexto = equipeRows
      .filter(r => (r[6] || '').toLowerCase() === 'ativo')
      .map(r => `${r[0]} (${r[1]})`)
      .join(', ');

    const escalaTexto = escalaRelevante.length > 0
      ? escalaRelevante.map(r =>
          `${r[0]}: ${r[2]||'-'} ${r[3]||''}-${r[4]||''}${r[5]?' ['+r[5]+']':''}`
        ).join('\n')
      : 'Sem registros nesse período.';

    let acaoTexto = '';
    if (acaoRealizada) {
      acaoTexto = `\n\n✅ GRAVADO: ${acaoRealizada.colaborador} ${acaoRealizada.entrada}–${acaoRealizada.saida} nos dias ${acaoRealizada.datas.join(', ')} (${acaoRealizada.linhasGravadas} linha(s)).`;
    } else if (isEscrita) {
      acaoTexto = `\n\n⚠️ NÃO GRAVADO: não identifiquei colaborador, horário ou data na mensagem.`;
    }

    const systemPrompt = `Você é o assistente do Pulse IA, dashboard operacional de TV ao vivo da LiveMode.
Hoje: ${hoje}. Usuário: ${session.nome}.

EQUIPE ATIVA: ${equipeTexto}

ESCALA (3 dias atrás + 14 dias à frente):
${escalaTexto}
${acaoTexto}

REGRAS:
- Responda em português BR, direto e objetivo.
- Se há ✅ acima, confirme ao usuário o que foi gravado com os detalhes exatos.
- Se há ⚠️ acima, informe o que faltou e peça para reformular.
- Alertas trabalhistas: interjornada mín 11h, jornada máx 10h, máx 7 dias consecutivos.
- Nunca invente dados ausentes da escala fornecida.`;

    // chama Groq
    const groqMessages = [
      ...history.slice(-10),
      { role: 'user', content: message },
    ];

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: systemPrompt }, ...groqMessages],
        temperature: 0.3,
        max_tokens: 600,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'Erro ao chamar IA', detail: err });
    }

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'Não consegui processar.';

    return res.status(200).json({
      reply,
      acaoRealizada,
      updatedHistory: [...groqMessages, { role: 'assistant', content: reply }],
    });

  } catch (err) {
    console.error('chat.js ERRO:', err.message, err.stack);
    return res.status(500).json({ error: 'Erro interno', detail: err.message });
  }
}
