import { createHash, createSign } from 'crypto';

// ── helpers de sessão ────────────────────────────────────────────────────────

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX  = 60 * 60 * 24 * 7;

const PENDING_COOKIE_NAME = 'pulse_pending_action';
const PENDING_MAX = 60 * 10;

function hash(s) {
  return createHash('sha256')
    .update(s + 'pulse2026')
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
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [nome, h, ts] = decoded.split('|');
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(nome + ts)) return null;
    return { nome };
  } catch { return null; }
}

function encodePending(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hash(body);
  return `${body}.${sig}`;
}

function decodePending(token) {
  if (!token) return null;
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    if (hash(body) !== sig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.createdAt) return null;
    if (Date.now() - payload.createdAt > PENDING_MAX * 1000) return null;
    return payload;
  } catch { return null; }
}

function getPendingAction(req) {
  const cookies = parseCookies(req.headers.cookie);
  return decodePending(cookies[PENDING_COOKIE_NAME]);
}

function setPendingAction(res, action) {
  const token = encodePending({ createdAt: Date.now(), action });
  res.setHeader('Set-Cookie', [
    `${PENDING_COOKIE_NAME}=${token}; Path=/; Max-Age=${PENDING_MAX}; SameSite=Lax; HttpOnly; Secure`,
  ]);
}

function clearPendingAction(res) {
  res.setHeader('Set-Cookie', [
    `${PENDING_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure`,
  ]);
}

// ── Google Sheets via fetch puro ─────────────────────────────────────────────

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
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
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${sigInput}.${sig}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token error: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

async function sheetsGet(token, range) {
  const id = process.env.GOOGLE_SHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error('Sheets GET: ' + JSON.stringify(data.error));
  return data.values || [];
}

async function sheetsBatchUpdate(token, updates) {
  if (!updates || !updates.length) return { updated: 0 };
  const id = process.env.GOOGLE_SHEET_ID;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Sheets batchUpdate: ' + JSON.stringify(data.error));
  return data;
}

async function sheetsAppend(token, range, values) {
  const id = process.env.GOOGLE_SHEET_ID;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error('Sheets append: ' + JSON.stringify(data.error));
  return data;
}

// ── utilidades ───────────────────────────────────────────────────────────────

function limparJson(txt) {
  return String(txt || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

function agoraBrasil() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function hojeBrasil() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function normalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isConfirmacao(msg) {
  const t = normalizarTexto(msg);
  return ['sim','confirmar','confirmo','confirma','pode confirmar','pode gravar','gravar','aplicar','manda','ok','fechado'].includes(t);
}

function isCancelamento(msg) {
  const t = normalizarTexto(msg);
  return ['nao','não','cancelar','cancela','cancele','desistir','deixa','deixa pra la','deixa pra lá'].includes(t);
}

function normalizarHora(h) {
  if (!h) return '';
  const texto = String(h).trim();
  const m = texto.match(/(\d{1,2})(?:[:hH](\d{0,2}))?/);
  if (!m) return '';
  const hora = Number(m[1]);
  const min = Number(m[2] || 0);
  if (hora < 0 || hora > 23) return '';
  if (min < 0 || min > 59) return '';
  return `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizarData(d) {
  if (!d) return '';
  const m = String(d).match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return '';
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31) return '';
  if (mes < 1 || mes > 12) return '';
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

function datasEntre(inicio, fim) {
  const start = normalizarData(inicio);
  const end = normalizarData(fim || inicio);
  if (!start || !end) return [];
  const ano = new Date().getFullYear();
  const [d1, m1] = start.split('/').map(Number);
  const [d2, m2] = end.split('/').map(Number);
  let cur = new Date(ano, m1 - 1, d1);
  let lim = new Date(ano, m2 - 1, d2);
  if (lim < cur) lim = cur;
  const datas = [];
  while (cur <= lim) {
    datas.push(`${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}`);
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
    const partes = (r[0] || '').toLowerCase().split(' ').filter(p => p.length > 2);
    return partes.some(p => alvo.includes(p));
  });
  return porParte ? porParte[0] : null;
}

function equipeAtivaTexto(equipeRows) {
  return equipeRows.filter(r => (r[6] || '').toLowerCase() === 'ativo').map(r => r[0]).filter(Boolean).join(', ');
}

// ── IA: interpreta comando ────────────────────────────────────────────────────

const ACTIONS = ['add_shift','remove_shift','swap_employee','update_shift','set_dayoff','set_vacation','set_medical_leave','query','ask_info'];

async function interpretarComando({ mensagem, equipeRows, hoje }) {
  const equipeTexto = equipeAtivaTexto(equipeRows);

  const systemPrompt = `Você é o interpretador operacional do Pulse IA.

Hoje é ${hoje}.

Colaboradores ativos:
${equipeTexto}

Sua função é transformar a mensagem do usuário em JSON válido.

Ações permitidas:
1. add_shift — adicionar horário na escala
2. remove_shift — remover horário da escala
3. swap_employee — trocar colaborador mantendo horário
4. update_shift — alterar horário existente
5. set_dayoff — marcar folga
6. set_vacation — marcar férias
7. set_medical_leave — marcar dispensa médica/atestado
8. query — consulta sem alteração
9. ask_info — falta informação obrigatória

Formatos:
add_shift: {"action":"add_shift","employee":"Nome","startDate":"DD/MM","endDate":"DD/MM","startTime":"HH:MM","endTime":"HH:MM","observation":"Ajustado IA"}
remove_shift: {"action":"remove_shift","employee":"Nome","startDate":"DD/MM","endDate":"DD/MM"}
swap_employee: {"action":"swap_employee","fromEmployee":"Nome","toEmployee":"Nome","startDate":"DD/MM","endDate":"DD/MM"}
update_shift: {"action":"update_shift","employee":"Nome","startDate":"DD/MM","endDate":"DD/MM","startTime":"HH:MM","endTime":"HH:MM","observation":"Ajustado IA"}
set_dayoff: {"action":"set_dayoff","employee":"Nome","startDate":"DD/MM","endDate":"DD/MM","observation":"Folga"}
set_vacation: {"action":"set_vacation","employee":"Nome","startDate":"DD/MM","endDate":"DD/MM","observation":"Férias"}
set_medical_leave: {"action":"set_medical_leave","employee":"Nome","startDate":"DD/MM","endDate":"DD/MM","observation":"Dispensa Médica"}
ask_info: {"action":"ask_info","missing":["colaborador","data","horário"]}

Regras:
- Responda SOMENTE JSON válido, sem markdown, sem texto fora do JSON.
- Para add_shift precisa de employee, startDate, startTime e endTime.
- Para remove_shift precisa de employee e startDate.
- Para swap_employee precisa de fromEmployee, toEmployee e startDate.
- Se uma única data, use a mesma em startDate e endDate.
- Se faltar algo obrigatório, use ask_info.`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
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

  if (!groqRes.ok) throw new Error('Groq interpretarComando: ' + await groqRes.text());

  const data = await groqRes.json();
  const txt = data.choices?.[0]?.message?.content || '{}';

  try {
    const json = JSON.parse(limparJson(txt));
    if (!ACTIONS.includes(json.action)) json.action = 'query';
    return json;
  } catch {
    return { action: 'ask_info', missing: ['comando'], raw: txt };
  }
}

// ── ações na escala ──────────────────────────────────────────────────────────

async function gravarTurnos(token, turno) {
  const rows = await sheetsGet(token, 'Escala!A2:F2000');
  const updates = [], appends = [];
  for (const data of turno.datas) {
    const idx = rows.findIndex(r => r[0] === data && (r[2] || '').trim().toLowerCase() === turno.colaborador.toLowerCase());
    if (idx >= 0) {
      updates.push({ range: `Escala!A${idx + 2}:F${idx + 2}`, values: [[data,'',turno.colaborador,turno.entrada,turno.saida,turno.obs||'Ajustado IA']] });
    } else {
      const idxVazio = rows.findIndex(r => r[0] === data && !(r[2] || '').trim());
      if (idxVazio >= 0) updates.push({ range: `Escala!A${idxVazio + 2}:F${idxVazio + 2}`, values: [[data,'',turno.colaborador,turno.entrada,turno.saida,turno.obs||'Ajustado IA']] });
      else appends.push([data,'',turno.colaborador,turno.entrada,turno.saida,turno.obs||'Ajustado IA']);
    }
  }
  if (updates.length) await sheetsBatchUpdate(token, updates);
  for (const linha of appends) await sheetsAppend(token, 'Escala!A:F', [linha]);
  await sheetsAppend(token, 'Ajustes!A:G', [[agoraBrasil(),turno.colaborador,turno.datas.join(', '),turno.entrada,turno.saida,turno.obs||'Ajustado IA','Chat IA']]);
  return updates.length + appends.length;
}

async function removerTurnos(token, comando) {
  const rows = await sheetsGet(token, 'Escala!A2:F2000');
  const updates = [];
  for (const data of comando.datas) {
    rows.forEach((r, idx) => {
      if (r[0] === data && (r[2] || '').trim().toLowerCase() === comando.colaborador.toLowerCase())
        updates.push({ range: `Escala!C${idx + 2}:F${idx + 2}`, values: [['','','','']] });
    });
  }
  if (updates.length) await sheetsBatchUpdate(token, updates);
  await sheetsAppend(token, 'Ajustes!A:G', [[agoraBrasil(),comando.colaborador,comando.datas.join(', '),'','','Removido pela IA','Chat IA']]);
  return updates.length;
}

async function marcarAusencia(token, comando) {
  const rows = await sheetsGet(token, 'Escala!A2:F2000');
  const updates = [], appends = [];
  for (const data of comando.datas) {
    const idx = rows.findIndex(r => r[0] === data && (r[2] || '').trim().toLowerCase() === comando.colaborador.toLowerCase());
    if (idx >= 0) {
      updates.push({ range: `Escala!A${idx + 2}:F${idx + 2}`, values: [[data,'',comando.colaborador,'','',comando.obs]] });
    } else {
      const idxVazio = rows.findIndex(r => r[0] === data && !(r[2] || '').trim());
      if (idxVazio >= 0) updates.push({ range: `Escala!A${idxVazio + 2}:F${idxVazio + 2}`, values: [[data,'',comando.colaborador,'','',comando.obs]] });
      else appends.push([data,'',comando.colaborador,'','',comando.obs]);
    }
  }
  if (updates.length) await sheetsBatchUpdate(token, updates);
  for (const linha of appends) await sheetsAppend(token, 'Escala!A:F', [linha]);
  await sheetsAppend(token, 'Ajustes!A:G', [[agoraBrasil(),comando.colaborador,comando.datas.join(', '),'','',comando.obs,'Chat IA']]);
  return updates.length + appends.length;
}

async function trocarColaborador(token, comando) {
  const rows = await sheetsGet(token, 'Escala!A2:F2000');
  const updates = [];
  for (const data of comando.datas) {
    rows.forEach((r, idx) => {
      if (r[0] === data && (r[2] || '').trim().toLowerCase() === comando.fromColaborador.toLowerCase())
        updates.push({ range: `Escala!A${idx + 2}:F${idx + 2}`, values: [[data,'',comando.toColaborador,r[3]||'',r[4]||'',comando.obs||`Substituiu ${comando.fromColaborador}`]] });
    });
  }
  if (updates.length) await sheetsBatchUpdate(token, updates);
  await sheetsAppend(token, 'Ajustes!A:G', [[agoraBrasil(),`${comando.fromColaborador} → ${comando.toColaborador}`,comando.datas.join(', '),'','',comando.obs||'Troca feita pela IA','Chat IA']]);
  return updates.length;
}

async function atualizarHorario(token, comando) {
  const rows = await sheetsGet(token, 'Escala!A2:F2000');
  const updates = [], appends = [];
  for (const data of comando.datas) {
    const idx = rows.findIndex(r => r[0] === data && (r[2] || '').trim().toLowerCase() === comando.colaborador.toLowerCase());
    if (idx >= 0) {
      updates.push({ range: `Escala!A${idx + 2}:F${idx + 2}`, values: [[data,'',comando.colaborador,comando.entrada,comando.saida,comando.obs||'Ajustado IA']] });
    } else {
      const idxVazio = rows.findIndex(r => r[0] === data && !(r[2] || '').trim());
      if (idxVazio >= 0) updates.push({ range: `Escala!A${idxVazio + 2}:F${idxVazio + 2}`, values: [[data,'',comando.colaborador,comando.entrada,comando.saida,comando.obs||'Ajustado IA']] });
      else appends.push([data,'',comando.colaborador,comando.entrada,comando.saida,comando.obs||'Ajustado IA']);
    }
  }
  if (updates.length) await sheetsBatchUpdate(token, updates);
  for (const linha of appends) await sheetsAppend(token, 'Escala!A:F', [linha]);
  await sheetsAppend(token, 'Ajustes!A:G', [[agoraBrasil(),comando.colaborador,comando.datas.join(', '),comando.entrada,comando.saida,comando.obs||'Ajustado IA','Chat IA']]);
  return updates.length + appends.length;
}

// ── confirmação / resposta ──────────────────────────────────────────────────

function montarPreviewConfirmacao(action) {
  if (action.action === 'add_shift') return `⚠️ Confirma esta inclusão?\n\nColaborador: ${action.colaborador}\nHorário: ${action.entrada} às ${action.saida}\nDias: ${action.datas.join(', ')}\n\nResponda "confirmar" ou "cancelar".`;
  if (action.action === 'remove_shift') return `⚠️ Confirma esta remoção?\n\nColaborador: ${action.colaborador}\nDias: ${action.datas.join(', ')}\n\nResponda "confirmar" ou "cancelar".`;
  if (action.action === 'swap_employee') return `⚠️ Confirma esta troca?\n\nSai: ${action.fromColaborador}\nEntra: ${action.toColaborador}\nDias: ${action.datas.join(', ')}\n\nO horário existente será mantido.\n\nResponda "confirmar" ou "cancelar".`;
  if (action.action === 'update_shift') return `⚠️ Confirma esta alteração?\n\nColaborador: ${action.colaborador}\nNovo horário: ${action.entrada} às ${action.saida}\nDias: ${action.datas.join(', ')}\n\nResponda "confirmar" ou "cancelar".`;
  if (['set_dayoff','set_vacation','set_medical_leave'].includes(action.action)) return `⚠️ Confirma este lançamento?\n\nTipo: ${action.obs}\nColaborador: ${action.colaborador}\nDias: ${action.datas.join(', ')}\n\nResponda "confirmar" ou "cancelar".`;
  return 'Tenho uma ação pendente. Responda "confirmar" ou "cancelar".';
}

function montarRespostaFinal(resultado) {
  const s = resultado.status;
  const a = resultado.action;
  if (a === 'add_shift') return s === 'success' ? `✅ Horário adicionado.\n\nColaborador: ${resultado.colaborador}\nHorário: ${resultado.entrada} às ${resultado.saida}\nDias: ${resultado.datas.join(', ')}` : `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`;
  if (a === 'remove_shift') { if (s === 'success') return `✅ Horário removido.\n\nColaborador: ${resultado.colaborador}\nDias: ${resultado.datas.join(', ')}`; if (s === 'not_found') return `⚠️ Nenhum horário encontrado.\n\nColaborador: ${resultado.colaborador}\nDias: ${resultado.datas.join(', ')}`; return `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`; }
  if (a === 'swap_employee') { if (s === 'success') return `✅ Troca realizada.\n\nSaiu: ${resultado.fromColaborador}\nEntrou: ${resultado.toColaborador}\nDias: ${resultado.datas.join(', ')}`; if (s === 'not_found') return `⚠️ Não encontrei escala para a troca.`; return `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`; }
  if (a === 'update_shift') return s === 'success' ? `✅ Horário alterado.\n\nColaborador: ${resultado.colaborador}\nNovo horário: ${resultado.entrada} às ${resultado.saida}\nDias: ${resultado.datas.join(', ')}` : `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`;
  if (a === 'set_dayoff') return s === 'success' ? `✅ Folga registrada.\n\nColaborador: ${resultado.colaborador}\nDias: ${resultado.datas.join(', ')}` : `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`;
  if (a === 'set_vacation') return s === 'success' ? `✅ Férias registradas.\n\nColaborador: ${resultado.colaborador}\nDias: ${resultado.datas.join(', ')}` : `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`;
  if (a === 'set_medical_leave') return s === 'success' ? `✅ Dispensa médica registrada.\n\nColaborador: ${resultado.colaborador}\nDias: ${resultado.datas.join(', ')}` : `⚠️ Faltam: ${(resultado.missing||[]).join(', ')}`;
  if (a === 'ask_info') return `⚠️ Preciso de: ${(resultado.missing||['informações']).join(', ')}.\n\nExemplos:\n- Adiciona Guilherme Oliveira das 10 às 19 no dia 22/06\n- Troca Guilherme Oliveira por Rodrigo Silva no dia 22/06\n- Muda o horário do Guilherme no dia 22/06 para 12 às 21`;
  return `Posso consultar e alterar a escala.\n\nExemplos:\n- Adiciona Guilherme Oliveira das 10 às 19 no dia 22/06\n- Remove Guilherme Oliveira do dia 22/06\n- Troca Guilherme por Rodrigo no dia 22/06\n- Marca folga para Guilherme no dia 22/06`;
}

function validarAddShift(comando, equipeRows) {
  const colaborador = encontrarColaborador(comando.employee, equipeRows);
  const entrada = normalizarHora(comando.startTime);
  const saida = normalizarHora(comando.endTime);
  const datas = datasEntre(comando.startDate, comando.endDate || comando.startDate);
  const missing = [!colaborador?'colaborador':null,!datas.length?'data':null,!entrada?'horário de entrada':null,!saida?'horário de saída':null].filter(Boolean);
  return { colaborador, entrada, saida, datas, missing };
}

function validarPessoaData(comando, equipeRows) {
  const colaborador = encontrarColaborador(comando.employee, equipeRows);
  const datas = datasEntre(comando.startDate, comando.endDate || comando.startDate);
  const missing = [!colaborador?'colaborador':null,!datas.length?'data':null].filter(Boolean);
  return { colaborador, datas, missing };
}

function validarTroca(comando, equipeRows) {
  const fromColaborador = encontrarColaborador(comando.fromEmployee, equipeRows);
  const toColaborador = encontrarColaborador(comando.toEmployee, equipeRows);
  const datas = datasEntre(comando.startDate, comando.endDate || comando.startDate);
  const missing = [!fromColaborador?'colaborador que sai':null,!toColaborador?'colaborador que entra':null,!datas.length?'data':null].filter(Boolean);
  return { fromColaborador, toColaborador, datas, missing };
}

function validarUpdateShift(comando, equipeRows) {
  const colaborador = encontrarColaborador(comando.employee, equipeRows);
  const entrada = normalizarHora(comando.startTime);
  const saida = normalizarHora(comando.endTime);
  const datas = datasEntre(comando.startDate, comando.endDate || comando.startDate);
  const missing = [!colaborador?'colaborador':null,!datas.length?'data':null,!entrada?'horário de entrada':null,!saida?'horário de saída':null].filter(Boolean);
  return { colaborador, entrada, saida, datas, missing };
}

async function executarAcaoPendente(token, action) {
  if (action.action === 'add_shift') { const qtd = await gravarTurnos(token, { colaborador: action.colaborador, entrada: action.entrada, saida: action.saida, datas: action.datas, obs: action.obs||'Ajustado IA' }); return { action: 'add_shift', status: 'success', colaborador: action.colaborador, entrada: action.entrada, saida: action.saida, datas: action.datas, linhasGravadas: qtd }; }
  if (action.action === 'remove_shift') { const qtd = await removerTurnos(token, { colaborador: action.colaborador, datas: action.datas }); return { action: 'remove_shift', status: qtd > 0 ? 'success' : 'not_found', colaborador: action.colaborador, datas: action.datas, linhasAlteradas: qtd }; }
  if (action.action === 'swap_employee') { const qtd = await trocarColaborador(token, { fromColaborador: action.fromColaborador, toColaborador: action.toColaborador, datas: action.datas, obs: action.obs }); return { action: 'swap_employee', status: qtd > 0 ? 'success' : 'not_found', fromColaborador: action.fromColaborador, toColaborador: action.toColaborador, datas: action.datas, linhasAlteradas: qtd }; }
  if (action.action === 'update_shift') { const qtd = await atualizarHorario(token, { colaborador: action.colaborador, entrada: action.entrada, saida: action.saida, datas: action.datas, obs: action.obs||'Ajustado IA' }); return { action: 'update_shift', status: 'success', colaborador: action.colaborador, entrada: action.entrada, saida: action.saida, datas: action.datas, linhasAlteradas: qtd }; }
  if (['set_dayoff','set_vacation','set_medical_leave'].includes(action.action)) { const qtd = await marcarAusencia(token, { colaborador: action.colaborador, datas: action.datas, obs: action.obs }); return { action: action.action, status: 'success', colaborador: action.colaborador, datas: action.datas, obs: action.obs, linhasGravadas: qtd }; }
  return { action: 'query', status: 'consulta' };
}

// ── handler principal ────────────────────────────────────────────────────────

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });
  if (req.method !== 'POST') return res.status(405).end();

  const { messages = [], pagina = '' } = req.body || {};
  if (!messages.length) return res.status(400).json({ error: 'messages obrigatório' });

  const ultimaMensagem = messages[messages.length - 1]?.content || '';

  try {
    const token = await getAccessToken();
    const equipeRows = await sheetsGet(token, 'Equipe!A2:I50');
    const pending = getPendingAction(req);

    if (pending?.action && isConfirmacao(ultimaMensagem)) {
      const resultado = await executarAcaoPendente(token, pending.action);
      clearPendingAction(res);
      return res.status(200).json({ resposta: montarRespostaFinal(resultado), acaoRealizada: resultado });
    }

    if (pending?.action && isCancelamento(ultimaMensagem)) {
      clearPendingAction(res);
      return res.status(200).json({ resposta: '✅ Alteração cancelada. Nada foi gravado.', acaoRealizada: { action: 'cancel', status: 'cancelled' } });
    }

    if (pending?.action) {
      return res.status(200).json({ resposta: `${montarPreviewConfirmacao(pending.action)}\n\nVocê ainda tem essa alteração pendente. Responda "confirmar" ou "cancelar".`, acaoRealizada: { action: 'pending', status: 'awaiting_confirmation' } });
    }

    const hoje = hojeBrasil();
    const comando = await interpretarComando({ mensagem: ultimaMensagem, equipeRows, hoje });

    if (comando.action === 'add_shift') {
      const { colaborador, entrada, saida, datas, missing } = validarAddShift(comando, equipeRows);
      if (missing.length) return res.status(200).json({ resposta: montarRespostaFinal({ action: 'ask_info', status: 'missing_info', missing }), acaoRealizada: { action: 'ask_info', status: 'missing_info', missing } });
      const action = { action: 'add_shift', colaborador, entrada, saida, datas, obs: comando.observation||'Ajustado IA' };
      setPendingAction(res, action);
      return res.status(200).json({ resposta: montarPreviewConfirmacao(action), acaoRealizada: { action: 'add_shift', status: 'awaiting_confirmation', preview: action } });
    }

    if (comando.action === 'swap_employee') {
      const { fromColaborador, toColaborador, datas, missing } = validarTroca(comando, equipeRows);
      if (missing.length) return res.status(200).json({ resposta: montarRespostaFinal({ action: 'ask_info', status: 'missing_info', missing }), acaoRealizada: { action: 'ask_info', status: 'missing_info', missing } });
      const action = { action: 'swap_employee', fromColaborador, toColaborador, datas, obs: `Substituiu ${fromColaborador}` };
      setPendingAction(res, action);
      return res.status(200).json({ resposta: montarPreviewConfirmacao(action), acaoRealizada: { action: 'swap_employee', status: 'awaiting_confirmation', preview: action } });
    }

    if (comando.action === 'update_shift') {
      const { colaborador, entrada, saida, datas, missing } = validarUpdateShift(comando, equipeRows);
      if (missing.length) return res.status(200).json({ resposta: montarRespostaFinal({ action: 'ask_info', status: 'missing_info', missing }), acaoRealizada: { action: 'ask_info', status: 'missing_info', missing } });
      const action = { action: 'update_shift', colaborador, entrada, saida, datas, obs: comando.observation||'Ajustado IA' };
      setPendingAction(res, action);
      return res.status(200).json({ resposta: montarPreviewConfirmacao(action), acaoRealizada: { action: 'update_shift', status: 'awaiting_confirmation', preview: action } });
    }

    if (comando.action === 'remove_shift') {
      const { colaborador, datas, missing } = validarPessoaData(comando, equipeRows);
      if (missing.length) return res.status(200).json({ resposta: montarRespostaFinal({ action: 'ask_info', status: 'missing_info', missing }), acaoRealizada: { action: 'ask_info', status: 'missing_info', missing } });
      const action = { action: 'remove_shift', colaborador, datas };
      setPendingAction(res, action);
      return res.status(200).json({ resposta: montarPreviewConfirmacao(action), acaoRealizada: { action: 'remove_shift', status: 'awaiting_confirmation', preview: action } });
    }

    if (['set_dayoff','set_vacation','set_medical_leave'].includes(comando.action)) {
      const { colaborador, datas, missing } = validarPessoaData(comando, equipeRows);
      const obsMap = { set_dayoff: 'Folga', set_vacation: 'Férias', set_medical_leave: 'Dispensa Médica' };
      const obs = comando.observation || obsMap[comando.action];
      if (missing.length) return res.status(200).json({ resposta: montarRespostaFinal({ action: 'ask_info', status: 'missing_info', missing }), acaoRealizada: { action: 'ask_info', status: 'missing_info', missing } });
      const action = { action: comando.action, colaborador, datas, obs };
      setPendingAction(res, action);
      return res.status(200).json({ resposta: montarPreviewConfirmacao(action), acaoRealizada: { action: comando.action, status: 'awaiting_confirmation', preview: action } });
    }

    // query — busca contexto real e responde em linguagem natural
    if (comando.action === 'query' || !ACTIONS.includes(comando.action)) {
      const [escalaRows, ausRows] = await Promise.all([
        sheetsGet(token, 'Escala!A2:F2000'),
        sheetsGet(token, 'Ausências!A2:F500'),
      ]);

      // Buscar eventos do Airtable (hoje + próximos 3 dias)
      let eventosCtx = '';
      try {
        const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const [d, m, a] = hoje.split('/');
        const hojeIso = `${a}-${m}-${d}`;
        const r = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID || 'appwE9LmmTxynTGFY'}/${process.env.AIRTABLE_TABLE_ID || 'tblpibvwAIGBQXr0H'}?filterByFormula=DATESTR({fldRnfbwPVzFiHMqs})>='${hojeIso}'&maxRecords=20&sort[0][field]=Hor%C3%A1rio%20KO&sort[0][direction]=asc`, {
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
        });
        const d2 = await r.json();
        if (d2.records) {
          eventosCtx = d2.records.map(ev => `${ev.fields['Horário KO']||''} - ${ev.fields['Match ID']||'Evento'} (${ev.fields['Tipo de Conteúdo']||''})`).join('
');
        }
      } catch {}

      const escalaCtx = escalaRows.slice(0, 100).map(r => r.join(' | ')).join('
');
      const ausCtx = ausRows.slice(0, 50).map(r => r.join(' | ')).join('
');
      const equipeCtx = equipeAtivaTexto(equipeRows);

      const sysQuery = `Você é o assistente operacional do Pulse IA da Livemode, empresa de TV.
Hoje é ${hojeBrasil()} — ${agoraBrasil()}.

Equipe ativa: ${equipeCtx}

Escala recente (Data | Dia | Colaborador | Entrada | Saída | Obs):
${escalaCtx || 'Sem registros'}

Ausências registradas (ID | Colaborador | Tipo | Motivo | Início | Fim):
${ausCtx || 'Nenhuma'}

Próximos eventos (Horário - Nome - Tipo):
${eventosCtx || 'Sem eventos encontrados'}

Responda de forma direta, clara e útil. Use emojis com moderação. Se não souber algo, diga honestamente.`;

      const groqQuery = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: sysQuery },
            ...messages,
          ],
          temperature: 0.4,
          max_tokens: 800,
        }),
      });
      const groqData = await groqQuery.json();
      const resposta = groqData.choices?.[0]?.message?.content?.trim() || 'Não consegui responder agora.';
      return res.status(200).json({ resposta, acaoRealizada: { action: 'query', status: 'answered' } });
    }

    const resultado = comando.action === 'ask_info'
      ? { action: 'ask_info', status: 'missing_info', missing: comando.missing || ['informações'], comando }
      : { action: 'query', status: 'consulta', comando };

    return res.status(200).json({ resposta: montarRespostaFinal(resultado), acaoRealizada: resultado });

  } catch (err) {
    console.error('chat.js ERRO:', err.message, err.stack);
    return res.status(500).json({ error: 'Erro interno', detail: err.message });
  }
}
