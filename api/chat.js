import { createHash } from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

// ── helpers ──────────────────────────────────────────────────────────────────

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

async function getSheetsClient() {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ── leitura da planilha ───────────────────────────────────────────────────────

async function lerEscala(sheets) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Escala!A2:F500',
  });
  return res.data.values || [];
}

async function lerEquipe(sheets) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Equipe!A2:I50',
  });
  return res.data.values || [];
}

// Retorna escala dos últimos 3 dias + próximos 14 dias
function filtrarEscalaRelevante(linhas) {
  const hoje = new Date();
  const result = [];
  for (const row of linhas) {
    if (!row[0]) continue;
    const [d, m] = row[0].split('/').map(Number);
    if (!d || !m) continue;
    const ano = hoje.getFullYear();
    const data = new Date(ano, m - 1, d);
    const diff = (data - hoje) / (1000 * 60 * 60 * 24);
    if (diff >= -3 && diff <= 14) result.push(row);
  }
  return result;
}

// ── detecção de intenção de escrita ──────────────────────────────────────────

const WRITE_PATTERNS = [
  /adiciona[r]?/i, /inclui[r]?/i, /insere[r]?/i, /coloca[r]?/i,
  /cadastra[r]?/i, /registra[r]?/i, /grava[r]?/i, /salva[r]?/i,
  /cria[r]? (?:turno|escala|entrada)/i, /coloca na escala/i,
  /bota na escala/i, /adiciona (?:na|à) escala/i,
  /muda[r]? (?:o turno|a escala)/i, /altera[r]?/i, /atualiza[r]?/i,
  /cobre[r]? (?:os dias|o dia)/i,
];

function temIntencaoEscrita(msg) {
  return WRITE_PATTERNS.some(p => p.test(msg));
}

// ── parser de turno a partir da mensagem natural ──────────────────────────────

/*
  Exemplos suportados:
  - "adiciona o Guilherme de 10h00 até 19h00 do dia 22/06 até 28/06"
  - "adiciona do dia 22/06 ate o dia 28/06 o Guilherme de 10h00 ate 19h00"
  - "coloca a Ana de 08:00 às 17:00 no dia 25/06"
*/
function parseTurnosDaMensagem(msg, equipe) {

  // Extrai horários  ex: 10h00, 10:00, 10h
  const reHora = /(\d{1,2})[h:](\d{0,2})/g;
  const horas = [...msg.matchAll(reHora)].map(m => {
    const h = m[1].padStart(2, '0');
    const min = (m[2] || '00').padStart(2, '0');
    return `${h}:${min}`;
  });

  if (horas.length < 2) return null; // precisa de pelo menos entrada e saída

  const entrada = horas[0];
  const saida = horas[1];

  // Extrai datas  ex: 22/06, 22-06
  const reDatas = /(\d{1,2})[\/\-](\d{1,2})/g;
  const datas = [...msg.matchAll(reDatas)].map(m => `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}`);

  if (datas.length === 0) return null;

  // Intervalo de datas: se tiver 2, é de/até; se tiver 1, é um único dia
  const datasAlvo = [];
  if (datas.length >= 2) {
    const [d1m1, d2m2] = [datas[0], datas[1]];
    const [d1, m1] = d1m1.split('/').map(Number);
    const [d2, m2] = d2m2.split('/').map(Number);
    const ano = new Date().getFullYear();
    let cur = new Date(ano, m1 - 1, d1);
    const fim = new Date(ano, m2 - 1, d2);
    while (cur <= fim) {
      const dd = String(cur.getDate()).padStart(2, '0');
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      datasAlvo.push(`${dd}/${mm}`);
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    datasAlvo.push(datas[0]);
  }

  // Tenta identificar colaborador pelo nome (busca parcial, case-insensitive)
  let colaborador = null;
  const msgLower = msg.toLowerCase();
  for (const row of equipe) {
    const nome = (row[0] || '').trim();
    if (!nome) continue;
    const partes = nome.toLowerCase().split(' ');
    // busca pelo primeiro ou último nome
    for (const parte of partes) {
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

// ── escrita na planilha ───────────────────────────────────────────────────────

async function gravarTurnos(sheets, turnos) {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  // Lê escala atual para saber onde há linhas e onde estão as datas
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Escala!A2:F500',
  });
  const rows = res.data.values || [];

  const updates = []; // { range, values }
  const appends = []; // novas linhas

  for (const { colaborador, entrada, saida, datas } of turnos) {
    for (const data of datas) {
      // Procura linha existente para essa data + colaborador
      const idx = rows.findIndex(r => r[0] === data && (r[2] || '').trim().toLowerCase() === colaborador.toLowerCase());
      if (idx >= 0) {
        // Atualiza linha existente (linha real = idx + 2)
        const rowNum = idx + 2;
        updates.push({
          range: `Escala!C${rowNum}:E${rowNum}`,
          values: [[colaborador, entrada, saida]],
        });
      } else {
        // Verifica se existe linha com mesma data sem colaborador (linha de data vazia)
        const idxData = rows.findIndex(r => r[0] === data && !r[2]);
        if (idxData >= 0) {
          const rowNum = idxData + 2;
          updates.push({
            range: `Escala!A${rowNum}:F${rowNum}`,
            values: [[data, '', colaborador, entrada, saida, '']],
          });
        } else {
          // Nova linha
          appends.push([data, '', colaborador, entrada, saida, '']);
        }
      }
    }
  }

  // Aplica updates em batch
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
  }

  // Appends
  for (const linha of appends) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Escala!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [linha] },
    });
  }

  // Log na aba Ajustes
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  for (const { colaborador, entrada, saida, datas } of turnos) {
    const datasStr = datas.join(', ');
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Ajustes!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[agora, colaborador, datasStr, entrada, saida, '', 'Chat IA']],
      },
    });
  }

  return updates.length + appends.length;
}

// ── handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const session = parseSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  if (req.method === 'GET') {
    // Serve a UI do chat (redirecionamento para app.js tratar)
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message obrigatório' });

  try {
    const sheets = await getSheetsClient();
    const [escalaRows, equipeRows] = await Promise.all([
      lerEscala(sheets),
      lerEquipe(sheets),
    ]);

    const escalaRelevante = filtrarEscalaRelevante(escalaRows);

    // ── Detecção e execução de escrita ────────────────────────────────────────
    let acaoRealizada = null;

    if (temIntencaoEscrita(message)) {
      const turno = parseTurnosDaMensagem(message, equipeRows);
      if (turno) {
        const qtd = await gravarTurnos(sheets, [turno]);
        acaoRealizada = {
          colaborador: turno.colaborador,
          entrada: turno.entrada,
          saida: turno.saida,
          datas: turno.datas,
          linhasGravadas: qtd,
        };
      }
    }

    // ── Contexto para o modelo ────────────────────────────────────────────────
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const equipeAtiva = equipeRows
      .filter(r => (r[6] || '').toLowerCase() === 'ativo')
      .map(r => `${r[0]} (${r[1]}, ${r[5] || 'CLT'})`)
      .join(', ');

    const escalaTexto = escalaRelevante.length > 0
      ? escalaRelevante.map(r => `${r[0]}: ${r[2]} ${r[3]}-${r[4]}${r[5] ? ' [' + r[5] + ']' : ''}`).join('\n')
      : 'Sem registros nesse período.';

    const acaoTexto = acaoRealizada
      ? `\n\n✅ AÇÃO EXECUTADA: Gravei o turno de ${acaoRealizada.colaborador} (${acaoRealizada.entrada}-${acaoRealizada.saida}) nos dias: ${acaoRealizada.datas.join(', ')}. Total de ${acaoRealizada.linhasGravadas} linha(s) salvas na planilha.`
      : '';

    const systemPrompt = `Você é o assistente do Pulse IA, dashboard operacional de TV ao vivo da LiveMode.
Hoje é ${hoje}. Usuário logado: ${session.nome}.

EQUIPE ATIVA: ${equipeAtiva}

ESCALA REAL (últimos 3 dias + próximos 14 dias):
${escalaTexto}
${acaoTexto}

REGRAS:
- Responda sempre em português BR, de forma objetiva e direta.
- Se uma ação de escrita foi executada (veja ✅ acima), confirme ao usuário com os detalhes exatos do que foi gravado.
- Se o usuário pediu para gravar mas NÃO aparece ✅, informe que não conseguiu identificar os dados (colaborador, horário ou data) e peça para reformular.
- Para alertas trabalhistas: interjornada mínima 11h, jornada máx 10h, máx 7 dias consecutivos.
- Nunca invente dados que não estejam na escala fornecida.`;

    // ── Chama Groq ────────────────────────────────────────────────────────────
    const groqMessages = [
      ...history.slice(-10), // mantém até 10 turnos anteriores
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
        temperature: 0.4,
        max_tokens: 600,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'Erro ao chamar IA', detail: err });
    }

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'Não consegui processar sua mensagem.';

    return res.status(200).json({
      reply,
      acaoRealizada,
      updatedHistory: [...groqMessages, { role: 'assistant', content: reply }],
    });

  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({ error: 'Erro interno', detail: err.message });
  }
}
