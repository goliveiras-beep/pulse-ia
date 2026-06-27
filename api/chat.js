
import { createHash, createSign } from 'crypto';

// ── helpers de sessão — igual ao app.js ──────────────────────────────────────

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX  = 60 * 60 * 24 * 7;

function hash(s) {
  return createHash('sha256')
    .update(s + process.env.PULSE_SECRET || 'pulse2026')
    .digest('hex')
    .slice(0, 32);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    cookies[k.trim()] = v.join('=');
  });
  return cookies;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token   = cookies[COOKIE_NAME];
  if (!token) return null;

  try {
    const decoded       = Buffer.from(token, 'base64').toString('utf8');
    const [nome, h, ts] = decoded.split('|');

    if (Date.now() - parseInt(ts) > COOKIE_MAX * 1000) return null;
    if (h !== hash(nome + ts)) return null;

    return { nome };
  } catch {
    return null;
  }
}

// ── Google Sheets via fetch puro ─────────────────────────────────────────────

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken() {
  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const sigInput = `${header}.${payload}`;
  const sign     = createSign('RSA-SHA256');
  sign.update(sigInput);

  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${sigInput}.${sig}`,
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    throw new Error('Token error: ' + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}

async function sheetsGet(token, range) {
  const id  = process.env.GOOGLE_SHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`;

  const res  = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();

  if (data.error) {
    throw new Error('Sheets GET: ' + JSON.stringify(data.error));
  }

  return data.values || [];
}

async function sheetsBatchUpdate(token, updates) {
  if (!updates.length) return { updated: 0 };

  const id  = process.env.GOOGLE_SHEET_ID;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates,
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error('Sheets batchUpdate: ' + JSON.stringify(data.error));
  }

  return data;
}

async function sheetsAppend(token, range, values) {
  const id  = process.env.GOOGLE_SHEET_ID;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );

  const data = await res.json();

  if (data.error) {
    throw new Error('Sheets append: ' + JSON.stringify(data.error));
  }

  return data;
}

// ── utilidades ───────────────────────────────────────────────────────────────

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

function limparJson(txt) {
  return String(txt || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function normalizarHora(h) {
  if (!h) return '';

  const texto = String(h).trim();

  const m = texto.match(/(\d{1,2})(?:[:hH](\d{0,2}))?/);
  if (!m) return '';

  const hora = String(m[1]).padStart(2, '0');
  const min  = String(m[2] || '00').padStart(2, '0');

  return `${hora}:${min}`;
}

function normalizarData(d) {
  if (!d) return '';

  const m = String(d).match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return '';

  return `${String(m[1]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}`;
}

function datasEntre(inicio, fim) {
  const start = normalizarData(inicio);
  const end   = normalizarData(fim || inicio);

  if (!start) return [];

  const ano = new Date().getFullYear();

  const [d1, m1] = start.split('/').map(Number);
  const [d2, m2] = end.split('/').map(Number);

  const datas = [];

  let cur   = new Date(ano, m1 - 1, d1);
  const lim = new Date(ano, m2 - 1, d2);

  while (cur <= lim) {
    datas.push(
      `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}`
    );
    cur.setDate(cur.getDate() + 1);
  }

  return datas;
}

function encontrarColaborador(nome, equipeRows) {
  const alvo = String(nome || '').toLowerCase().trim();
  if (!alvo) return null;

  const ativos = equipeRows.filter(r => (r[6] || '').toLowerCase() === 'ativo');

  const exato = ativos.find(r => (r[0] || '').toLowerCase().trim() === alvo);
  if (exato) return exato[0];

  const parcial = ativos.find(r => {
    const nomeReal = (r[0] || '').toLowerCase().trim();
    return nomeReal.includes(alvo) || alvo.includes(nomeReal);
  });

  if (parcial) return parcial[0];

  const porParte = ativos.find(r => {
    const partes = (r[0] || '')
      .toLowerCase()
      .split(' ')
      .filter(p => p.length > 3);

    return partes.some(p => alvo.includes(p));
  });

  return porParte ? porParte[0] : null;
}

function agoraBrasil() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
}

// ── IA: interpreta comando do usuário ────────────────────────────────────────

const ACTIONS = [
  'add_shift',
  'remove_shift',
  'set_dayoff',
  'set_vacation',
  'set_medical_leave',
  'query',
  'ask_info',
];

async function interpretarComando({ mensagem, equipeRows, hoje }) {
  const equipeTexto = equipeRows
    .filter(r => (r[6] || '').toLowerCase() === 'ativo')
    .map(r => r[0])
    .join(', ');

  const systemPrompt = `
Você é o interpretador operacional do Pulse IA.

Hoje é ${hoje}.

Colaboradores ativos:
${equipeTexto}

Sua função é transformar a mensagem do usuário em JSON válido.

Ações permitidas:

1. add_shift
Quando o usuário quiser adicionar, incluir, colocar, cadastrar ou registrar horário na escala.

2. remove_shift
Quando o usuário quiser excluir, remover, apagar ou tirar horário da escala.

3. set_dayoff
Quando o usuário quiser marcar folga.

4. set_vacation
Quando o usuário quiser marcar férias.

5. set_medical_leave
Quando o usuário quiser marcar dispensa médica, atestado ou afastamento médico.

6. query
Quando for apenas uma pergunta, consulta ou conversa, sem alteração na escala.

7. ask_info
Quando faltar informação obrigatória.

Formato para add_shift:

{
  "action": "add_shift",
  "employee": "Nome do colaborador",
  "startDate": "DD/MM",
  "endDate": "DD/MM",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "observation": "Ajustado IA"
}

Formato para remove_shift:

{
  "action": "remove_shift",
  "employee": "Nome do colaborador",
  "startDate": "DD/MM",
  "endDate": "DD/MM"
}

Formato para set_dayoff:

{
  "action": "set_dayoff",
  "employee": "Nome do colaborador",
  "startDate": "DD/MM",
  "endDate": "DD/MM",
  "observation": "Folga"
}

Formato para set_vacation:

{
  "action": "set_vacation",
  "employee": "Nome do colaborador",
  "startDate": "DD/MM",
  "endDate": "DD/MM",
  "observation": "Férias"
}

Formato para set_medical_leave:

{
  "action": "set_medical_leave",
  "employee": "Nome do colaborador",
  "startDate": "DD/MM",
  "endDate": "DD/MM",
  "observation": "Dispensa Médica"
}

Formato para ask_info:

{
  "action": "ask_info",
  "missing": ["colaborador", "data", "horário"]
}

Regras obrigatórias:
- Responda SOMENTE JSON válido.
- Não use markdown.
- Não explique.
- Não escreva texto fora do JSON.
- Se o usuário disser "Guilherme", "Gui" ou nome parcial, tente mapear para o nome completo da lista.
- Para add_shift precisa de employee, startDate, startTime e endTime.
- Para remove_shift precisa de employee e startDate.
- Para folga, férias e dispensa médica precisa de employee e startDate.
- Se houver intervalo, preencha startDate e endDate.
- Se houver uma única data, use a mesma data em startDate e endDate.
- Se faltar algo obrigatório, use ask_info.
`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: mensagem },
      ],
      temperature: 0,
      max_tokens: 500,
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    throw new Error('Groq interpretarComando: ' + err);
  }

  const data = await groqRes.json();
  const txt  = data.choices?.[0]?.message?.content || '{}';

  try {
    const json = JSON.parse(limparJson(txt));

    if (!ACTIONS.includes(json.action)) {
      json.action = 'query';
    }

    return json;
  } catch {
    return {
      action: 'ask_info',
      missing: ['comando'],
      raw: txt,
    };
  }
}

// ── ações na escala ──────────────────────────────────────────────────────────

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
      updates.push({
        range: `Escala!A${idx + 2}:F${idx + 2}`,
        values: [[data, '', turno.colaborador, turno.entrada, turno.saida, turno.obs || 'Ajustado IA']],
      });
    } else {
      const idxDataVazia = rows.findIndex(r => r[0] === data && !(r[2] || '').trim());

      if (idxDataVazia >= 0) {
        updates.push({
          range: `Escala!A${idxDataVazia + 2}:F${idxDataVazia + 2}`,
          values: [[data, '', turno.colaborador, turno.entrada, turno.saida, turno.obs || 'Ajustado IA']],
        });
      } else {
        appends.push([data, '', turno.colaborador, turno.entrada, turno.saida, turno.obs || 'Ajustado IA']);
      }
    }
  }

  if (updates.length > 0) {
    await sheetsBatchUpdate(token, updates);
  }

  for (const linha of appends) {
    await sheetsAppend(token, 'Escala!A:F', [linha]);
  }

  await sheetsAppend(token, 'Ajustes!A:G', [[
    agoraBrasil(),
    turno.colaborador,
    turno.datas.join(', '),
    turno.entrada,
    turno.saida,
    turno.obs || 'Ajustado IA',
    'Chat IA',
  ]]);

  return updates.length + appends.length;
}

async function removerTurnos(token, comando) {
  const rows    = await sheetsGet(token, 'Escala!A2:F500');
  const updates = [];

  for (const data of comando.datas) {
    rows.forEach((r, idx) => {
      const mesmaData = r[0] === data;
      const mesmoColaborador = (r[2] || '').trim().toLowerCase() === comando.colaborador.toLowerCase();

      if (mesmaData && mesmoColaborador) {
        updates.push({
          range: `Escala!C${idx + 2}:F${idx + 2}`,
          values: [['', '', '', '']],
        });
      }
    });
  }

  if (updates.length > 0) {
    await sheetsBatchUpdate(token, updates);
  }

  await sheetsAppend(token, 'Ajustes!A:G', [[
    agoraBrasil(),
    comando.colaborador,
    comando.datas.join(', '),
    '',
    '',
    'Removido pela IA',
    'Chat IA',
  ]]);

  return updates.length;
}

async function marcarAusencia(token, comando) {
  const rows    = await sheetsGet(token, 'Escala!A2:F500');
  const updates = [];
  const appends = [];

  for (const data of comando.datas) {
    const idx = rows.findIndex(r =>
      r[0] === data &&
      (r[2] || '').trim().toLowerCase() === comando.colaborador.toLowerCase()
    );

    if (idx >= 0) {
      updates.push({
        range: `Escala!A${idx + 2}:F${idx + 2}`,
        values: [[data, '', comando.colaborador, '', '', comando.obs]],
      });
    } else {
      const idxDataVazia = rows.findIndex(r => r[0] === data && !(r[2] || '').trim());

      if (idxDataVazia >= 0) {
        updates.push({
          range: `Escala!A${idxDataVazia + 2}:F${idxDataVazia + 2}`,
          values: [[data, '', comando.colaborador, '', '', comando.obs]],
        });
      } else {
        appends.push([data, '', comando.colaborador, '', '', comando.obs]);
      }
    }
  }

  if (updates.length > 0) {
    await sheetsBatchUpdate(token, updates);
  }

  for (const linha of appends) {
    await sheetsAppend(token, 'Escala!A:F', [linha]);
  }

  await sheetsAppend(token, 'Ajustes!A:G', [[
    agoraBrasil(),
    comando.colaborador,
    comando.datas.join(', '),
    '',
    '',
    comando.obs,
    'Chat IA',
  ]]);

  return updates.length + appends.length;
}

// ── resposta final com IA ────────────────────────────────────────────────────

async function gerarRespostaFinal({ session, pagina, hoje, equipeTexto, escalaTexto, resultado, messages }) {
  const systemPrompt = `Você é o assistente do Pulse IA, dashboard operacional de TV ao vivo da LiveMode.

Hoje: ${hoje}.
Usuário logado: ${session.nome}.
Página atual: ${pagina}.

EQUIPE ATIVA:
${equipeTexto}

ESCALA RELEVANTE:
${escalaTexto}

RESULTADO DA AÇÃO:
${JSON.stringify(resultado, null, 2)}

REGRAS:
- Responda em português BR.
- Seja direto, claro e operacional.
- Máximo 4 parágrafos curtos.
- Se uma ação foi gravada, confirme exatamente o que foi feito.
- Se faltou informação, diga o que faltou e dê um exemplo de comando correto.
- Se foi apenas consulta, responda usando somente os dados da escala fornecida.
- Nunca invente dados.
- Alertas trabalhistas: interjornada mínima 11h, jornada máxima 10h, máximo 7 dias consecutivos.`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    throw new Error('Groq gerarRespostaFinal: ' + err);
  }

  const data = await groqRes.json();

  return data.choices?.[0]?.message?.content || 'Não consegui processar.';
}

// ── handler principal ────────────────────────────────────────────────────────

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const { messages = [], pagina = '' } = req.body || {};

  if (!messages.length) {
    return res.status(400).json({ error: 'messages obrigatório' });
  }

  const ultimaMensagem = messages[messages.length - 1]?.content || '';

  try {
    const token = await getAccessToken();

    const [escalaRows, equipeRows] = await Promise.all([
      sheetsGet(token, 'Escala!A2:F500'),
      sheetsGet(token, 'Equipe!A2:I50'),
    ]);

    const hoje = new Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });

    const escalaRelevante = filtrarEscalaRelevante(escalaRows);

    const equipeTexto = equipeRows
      .filter(r => (r[6] || '').toLowerCase() === 'ativo')
      .map(r => `${r[0]} (${r[1] || 'sem cargo'})`)
      .join(', ');

    const escalaTexto = escalaRelevante.length > 0
      ? escalaRelevante.map(r =>
          `${r[0]}: ${r[2] || '-'} ${r[3] || ''}-${r[4] || ''}${r[5] ? ' [' + r[5] + ']' : ''}`
        ).join('\n')
      : 'Sem registros nesse período.';

    const comando = await interpretarComando({
      mensagem: ultimaMensagem,
      equipeRows,
      hoje,
    });

    let resultado = {
      action: comando.action,
      status: 'no_action',
      comando,
    };

    if (comando.action === 'add_shift') {
      const colaborador = encontrarColaborador(comando.employee, equipeRows);
      const entrada     = normalizarHora(comando.startTime);
      const saida       = normalizarHora(comando.endTime);
      const datas       = datasEntre(comando.startDate, comando.endDate || comando.startDate);

      const missing = [
        !colaborador ? 'colaborador' : null,
        !datas.length ? 'data' : null,
        !entrada ? 'horário de entrada' : null,
        !saida ? 'horário de saída' : null,
      ].filter(Boolean);

      if (missing.length) {
        resultado = {
          action: 'ask_info',
          status: 'missing_info',
          missing,
        };
      } else {
        const qtd = await gravarTurnos(token, {
          colaborador,
          entrada,
          saida,
          datas,
          obs: comando.observation || 'Ajustado IA',
        });

        resultado = {
          action: 'add_shift',
          status: 'success',
          colaborador,
          entrada,
          saida,
          datas,
          linhasGravadas: qtd,
        };
      }
    }

    else if (comando.action === 'remove_shift') {
      const colaborador = encontrarColaborador(comando.employee, equipeRows);
      const datas       = datasEntre(comando.startDate, comando.endDate || comando.startDate);

      const missing = [
        !colaborador ? 'colaborador' : null,
        !datas.length ? 'data' : null,
      ].filter(Boolean);

      if (missing.length) {
        resultado = {
          action: 'ask_info',
          status: 'missing_info',
          missing,
        };
      } else {
        const qtd = await removerTurnos(token, {
          colaborador,
          datas,
        });

        resultado = {
          action: 'remove_shift',
          status: qtd > 0 ? 'success' : 'not_found',
          colaborador,
          datas,
          linhasAlteradas: qtd,
        };
      }
    }

    else if (
      comando.action === 'set_dayoff' ||
      comando.action === 'set_vacation' ||
      comando.action === 'set_medical_leave'
    ) {
      const colaborador = encontrarColaborador(comando.employee, equipeRows);
      const datas       = datasEntre(comando.startDate, comando.endDate || comando.startDate);

      const obsMap = {
        set_dayoff: 'Folga',
        set_vacation: 'Férias',
        set_medical_leave: 'Dispensa Médica',
      };

      const obs = comando.observation || obsMap[comando.action];

      const missing = [
        !colaborador ? 'colaborador' : null,
        !datas.length ? 'data' : null,
      ].filter(Boolean);

      if (missing.length) {
        resultado = {
          action: 'ask_info',
          status: 'missing_info',
          missing,
        };
      } else {
        const qtd = await marcarAusencia(token, {
          colaborador,
          datas,
          obs,
        });

        resultado = {
          action: comando.action,
          status: 'success',
          colaborador,
          datas,
          obs,
          linhasGravadas: qtd,
        };
      }
    }

    else if (comando.action === 'ask_info') {
      resultado = {
        action: 'ask_info',
        status: 'missing_info',
        missing: comando.missing || ['informações'],
      };
    }

    else {
      resultado = {
        action: 'query',
        status: 'consulta',
      };
    }

    const resposta = await gerarRespostaFinal({
      session,
      pagina,
      hoje,
      equipeTexto,
      escalaTexto,
      resultado,
      messages,
    });

    return res.status(200).json({
      resposta,
      acaoRealizada: resultado,
    });

  } catch (err) {
    console.error('chat.js ERRO:', err.message, err.stack);

    return res.status(500).json({
      error: 'Erro interno',
      detail: err.message,
    });
  }
}
