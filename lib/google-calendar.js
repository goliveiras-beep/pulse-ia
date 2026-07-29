// lib/google-calendar.js — sincroniza turnos/ausências da Escala com a Agenda do Google pessoal
// de cada colaborador (não a agenda do gestor — cada pessoa autoriza a própria agenda no login).
// Requer que o login tenha pedido o scope https://www.googleapis.com/auth/calendar.events e que
// o refresh token tenha sido persistido em Equipe!N (ver lib/routes/register.js).
import { createHash } from 'crypto';
import { sheetsRequest } from './google-auth.js';

function toMin(h) { if (!h) return null; const [hh, mm] = h.split(':').map(Number); return hh * 60 + (mm || 0); }
function fmtData(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; }
function addDias(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isoData(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// Constrói o horário como BRT explícito (-03:00) em vez de passar por Date+toISOString(), que
// converteria pra UTC usando o fuso do servidor (Vercel roda em UTC) e desalinharia o horário em 3h.
function isoBRT(d, h, min) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`;
}

// Gera um ID de evento determinístico (letras a-v e dígitos 0-9 — hex já cabe nesse alfabeto),
// então o mesmo turno/ausência sempre mapeia pro mesmo evento e dá pra fazer upsert sem duplicar.
function gerarEventId(chave) {
  return 'pulse' + createHash('sha1').update(chave).digest('hex').slice(0, 20);
}

async function getFreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('refresh_token inválido ou revogado: ' + JSON.stringify(data));
  return data.access_token;
}

// Lança erro detalhado em caso de falha — upsert "silencioso" escondia falhas reais da API
// (o chamador só via "sucesso" mesmo quando o evento nunca era criado de fato).
async function upsertEvento(accessToken, eventId, body) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
  const patchRes = await fetch(`${base}/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (patchRes.ok) return;
  if (patchRes.status === 404 || patchRes.status === 410) {
    const postRes = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, id: eventId }),
    });
    if (postRes.ok) return;
    throw new Error(`POST ${postRes.status}: ${await postRes.text()}`);
  }
  throw new Error(`PATCH ${patchRes.status}: ${await patchRes.text()}`);
}

async function deletarEvento(accessToken, eventId) {
  try {
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch { /* já não existia — ok */ }
}

// Sincroniza a agenda de UMA pessoa pro período [dataInicio, dataFim] (objetos Date, inclusive).
// escalaPessoa: linhas da Escala já filtradas pra essa pessoa (normalizarNome já aplicado por quem chama).
// ausenciasPessoa: linhas de Ausências já filtradas pra essa pessoa (aprovadas).
export async function sincronizarAgendaPessoa(refreshToken, nome, escalaPessoa, ausenciasPessoa, dataInicio, dataFim) {
  const accessToken = await getFreshAccessToken(refreshToken);
  const totalDias = Math.round((dataFim - dataInicio) / 86400000) + 1;
  const erros = [];

  const toNum = s => { const p = s.split('/'); return parseInt(p[1]) * 100 + parseInt(p[0]); };
  function ausenciaDoDia(df) {
    return ausenciasPessoa.find(a => {
      const ini = a[4], fim = a[5] || a[4];
      if (!ini) return false;
      const n = toNum(df), i = toNum(ini), f = toNum(fim);
      return f >= i ? (n >= i && n <= f) : (n >= i || n <= f);
    });
  }

  // Passo 1: um evento all-day por ausência (não por dia, senão duplicaria)
  for (const a of ausenciasPessoa) {
    const [tipo, , iniStr, fimStr] = [a[2], a[3], a[4], a[5] || a[4]];
    if (!iniStr) continue;
    const anoRef = dataInicio.getFullYear();
    const [di, mi] = iniStr.split('/').map(Number);
    const [df2, mf2] = fimStr.split('/').map(Number);
    const inicioAus = new Date(anoRef, mi - 1, di);
    const fimAusExclusivo = addDias(new Date(anoRef, mf2 - 1, df2), 1); // Calendar: end.date é exclusivo
    const eventId = gerarEventId(`aus|${nome}|${a[0]}|${iniStr}`);
    try {
      await upsertEvento(accessToken, eventId, {
        summary: `${tipo || 'Ausência'} — Pulse`,
        description: a[3] || '',
        start: { date: isoData(inicioAus) },
        end: { date: isoData(fimAusExclusivo) },
        transparency: 'transparent',
        colorId: '11',
      });
    } catch (e) { erros.push(`ausencia ${iniStr}: ${e.message}`); }
  }

  // Passo 2: turnos dia a dia (pulando dias já cobertos por ausência — a ausência tem prioridade)
  for (let i = 0; i < totalDias; i++) {
    const data = addDias(dataInicio, i);
    const df = fmtData(data);
    const eventId = gerarEventId(`turno|${nome}|${df}|${data.getFullYear()}`);
    try {
      if (ausenciaDoDia(df)) { await deletarEvento(accessToken, eventId); continue; }
      const reg = escalaPessoa.find(r => r[0] === df);
      const entrada = reg?.[3], saida = reg?.[4], obs = reg?.[5];
      if (!reg || !entrada || !saida || obs === 'Folga' || obs === 'Folga/Ausente') {
        await deletarEvento(accessToken, eventId);
        continue;
      }
      const [eh, em] = entrada.split(':').map(Number);
      const [sh, sm] = saida.split(':').map(Number);
      const diaFim = toMin(saida) <= toMin(entrada) ? addDias(data, 1) : data; // turno virou a noite
      await upsertEvento(accessToken, eventId, {
        summary: 'Turno — Livemode',
        description: obs && obs !== 'Gerado IA' && obs !== 'Ajustado IA' ? obs : '',
        start: { dateTime: isoBRT(data, eh, em), timeZone: 'America/Sao_Paulo' },
        end: { dateTime: isoBRT(diaFim, sh, sm), timeZone: 'America/Sao_Paulo' },
        // transparent = não conta como "ocupado" na agenda; o turno é informativo, não pode
        // bloquear convites/reuniões de outras pessoas durante o horário de trabalho.
        transparency: 'transparent',
        colorId: '9',
      });
    } catch (e) { erros.push(`turno ${df}: ${e.message}`); }
  }

  if (erros.length) {
    throw new Error(erros.slice(0, 5).join(' | ') + (erros.length > 5 ? ` ... (+${erros.length - 5} mais)` : ''));
  }
}

function normalizarNomeCalendar(s) {
  return String(s || '').toLowerCase()
    .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c').replace(/ñ/g, 'n')
    .trim();
}

// Sincroniza a agenda de UMA pessoa pelo nome, buscando os dados dela mesma (Equipe/Escala/
// Ausências/PulseConfig) — pra ser chamada logo depois de qualquer ação que altere a escala ou
// uma ausência dela (ajuste manual, aprovar solicitação, troca aceita, comando do chat de IA),
// sem esperar o próximo "Sincronizar agenda" manual ou a próxima publicação de horizonte.
// Não lança erro — quem chama não precisa tratar falha, só loga no console.
export async function sincronizarUmaPessoa(nome) {
  try {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const getSheet = async (range) => {
      try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
      catch { return []; }
    };
    const [equipeRaw, escalaRaw, ausenciasRaw, cfgRaw] = await Promise.all([
      getSheet('Equipe!A2:N200'),
      getSheet('Escala!A2:F5000'),
      getSheet('Ausências!A2:F500'),
      getSheet('PulseConfig!A2:B20'),
    ]);
    const nomeNorm = normalizarNomeCalendar(nome);
    const pessoa = equipeRaw.find(r => r[0] && normalizarNomeCalendar(r[0]) === nomeNorm && (r[10] || 'ativo').toLowerCase() === 'ativo' && r[13]);
    if (!pessoa) return; // não é ativo ou ainda não autorizou a agenda — nada a sincronizar

    const agora = new Date();
    const hojeBRT = new Date(agora.getTime() + ((-3 * 60) - agora.getTimezoneOffset()) * 60000);
    hojeBRT.setHours(0, 0, 0, 0);

    const horizonteStr = (cfgRaw.find(r => r[0] === 'publicacao_horizonte') || [])[1] || '';
    let dataFim;
    if (horizonteStr) {
      const [dh, mh] = horizonteStr.split('/').map(Number);
      dataFim = new Date(hojeBRT.getFullYear(), mh - 1, dh);
      if (dataFim < hojeBRT) dataFim.setFullYear(dataFim.getFullYear() + 1);
    } else {
      dataFim = new Date(hojeBRT); dataFim.setDate(dataFim.getDate() + 14);
    }

    const escalaPessoa = escalaRaw.filter(r => r[2] && normalizarNomeCalendar(r[2]) === nomeNorm);
    const ausenciasPessoa = ausenciasRaw.filter(r => r[1] && normalizarNomeCalendar(r[1]) === nomeNorm && String(r[0] || '').startsWith('APROVADO'));
    await sincronizarAgendaPessoa(pessoa[13], pessoa[0], escalaPessoa, ausenciasPessoa, hojeBRT, dataFim);
  } catch (e) {
    console.error('sincronizarUmaPessoa falhou pra', nome, e.message);
  }
}
