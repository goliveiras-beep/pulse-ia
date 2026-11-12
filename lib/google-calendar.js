// lib/google-calendar.js — sincroniza turnos/ausências da Escala com a Agenda do Google pessoal
// de cada colaborador (não a agenda do gestor — cada pessoa autoriza a própria agenda no login).
// Requer que o login tenha pedido o scope https://www.googleapis.com/auth/calendar.events e que
// o refresh token tenha sido persistido em Equipe!N (ver lib/routes/register.js).
import { createHash } from 'crypto';
import { sheetsRequest } from './google-auth.js';

function toMin(h) { if (!h) return null; const [hh, mm] = h.split(':').map(Number); return hh * 60 + (mm || 0); }
function fmtData(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; }
function addDias(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
// Folga em verde claro (Sage); turno em azul (9); demais ausências (férias, atestado...) seguem em tomate (11).
const COR_FOLGA_AGENDA = '2';
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
  // PUT (events.update) substitui o evento inteiro: PATCH misturava start.date novo com um start.dateTime
  // antigo (evento editado pela pessoa) e o Google respondia 400 "Invalid start time".
  const patchRes = await fetch(`${base}/${eventId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    // status 'confirmed' restaura um evento que a pessoa apagou na própria agenda (fica "cancelado" e o
    // PATCH comum nele falha com 400 "Invalid start time").
    body: JSON.stringify({ ...body, status: 'confirmed' }),
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
  throw new Error(`PUT ${patchRes.status}: ${await patchRes.text()}`);
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
    let fimAus = new Date(anoRef, mf2 - 1, df2);
    // Virada de ano (ex.: 28/12 a 03/01): o fim cai no ano seguinte. Qualquer outro fim antes do início é dado inválido.
    if (fimAus < inicioAus && mi >= 11 && mf2 <= 2) fimAus = new Date(anoRef + 1, mf2 - 1, df2);
    if (isNaN(inicioAus) || isNaN(fimAus) || fimAus < inicioAus) { erros.push(`ausencia ${iniStr}→${fimStr} (${tipo || '?'}): datas inválidas (fim antes do início)`); continue; }
    const fimAusExclusivo = addDias(fimAus, 1); // Calendar: end.date é exclusivo
    const eventId = gerarEventId(`aus|${nome}|${a[0]}|${iniStr}`);
    try {
      await upsertEvento(accessToken, eventId, {
        summary: `${tipo || 'Ausência'} — Pulse`,
        description: a[3] || '',
        start: { date: isoData(inicioAus) },
        end: { date: isoData(fimAusExclusivo) },
        transparency: 'transparent',
        colorId: COR_FOLGA_AGENDA && /^folga/i.test(tipo || '') ? COR_FOLGA_AGENDA : '11',
      });
    } catch (e) { erros.push(`ausencia ${iniStr}→${fimStr} (${tipo || '?'}): ${e.message.replace(/s+/g, ' ').slice(0, 160)}`); }
  }

  // Passo 2: turnos dia a dia (pulando dias já cobertos por ausência — a ausência tem prioridade)
  for (let i = 0; i < totalDias; i++) {
    const data = addDias(dataInicio, i);
    const df = fmtData(data);
    // Turno = faixa de dia inteiro com o horário no título (mesmo formato de "Folga — Pulse").
    // Id novo ("turnodia"): o evento antigo tinha hora (start.dateTime) e trocar pra start.date num
    // evento existente é frágil na API; então o antigo ("turno") é apagado e este é criado.
    const eventId = gerarEventId(`turnodia|${nome}|${df}|${data.getFullYear()}`);
    const eventIdLegado = gerarEventId(`turno|${nome}|${df}|${data.getFullYear()}`);
    // ID separado pro aviso de folga marcada direto na Escala (obs "Folga"/"Folga/Ausente") —
    // antes só apagava o evento de turno e o dia ficava vazio na agenda, sem indicar a folga.
    const folgaEventId = gerarEventId(`folga|${nome}|${df}|${data.getFullYear()}`);
    try {
      if (ausenciaDoDia(df)) { await Promise.all([deletarEvento(accessToken, eventId), deletarEvento(accessToken, eventIdLegado), deletarEvento(accessToken, folgaEventId)]); continue; }
      const reg = escalaPessoa.find(r => r[0] === df);
      const entrada = reg?.[3], saida = reg?.[4], obs = reg?.[5];
      const ehFolga = obs === 'Folga' || obs === 'Folga/Ausente';
      if (!reg || !entrada || !saida || ehFolga) {
        await Promise.all([deletarEvento(accessToken, eventId), deletarEvento(accessToken, eventIdLegado)]);
        if (ehFolga) {
          await upsertEvento(accessToken, folgaEventId, {
            summary: 'Folga — Pulse',
            start: { date: isoData(data) },
            end: { date: isoData(addDias(data, 1)) },
            transparency: 'transparent',
            colorId: COR_FOLGA_AGENDA,
          });
        } else {
          await deletarEvento(accessToken, folgaEventId);
        }
        continue;
      }
      // limpa aviso de folga de um dia que virou turno de novo + o evento de turno antigo (com hora)
      await Promise.all([deletarEvento(accessToken, folgaEventId), deletarEvento(accessToken, eventIdLegado)]);
      const viraNoite = toMin(saida) <= toMin(entrada); // turno atravessa a meia-noite
      await upsertEvento(accessToken, eventId, {
        summary: `Turno — Pulse · ${entrada}–${saida}`,
        description: [viraNoite ? 'Termina no dia seguinte.' : '', obs && obs !== 'Gerado IA' && obs !== 'Ajustado IA' ? obs : ''].filter(Boolean).join('\n'),
        start: { date: isoData(data) },
        end: { date: isoData(addDias(data, 1)) },
        // transparent = não conta como "ocupado" na agenda; o turno é informativo, não pode
        // bloquear convites/reuniões de outras pessoas durante o horário de trabalho.
        transparency: 'transparent',
        // Azul (Blueberry, colorId 9): distingue do Folga/Ausência (tomate, 11) e das tarefas do Compasso.
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
      getSheet('Escala!A2:F10000'),
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

// Mesma paleta usada nos badges de prioridade/SLA do Compasso (dc2626/d97706/16a34a) — dentro
// do que o Calendar permite, já que evento não aceita hex customizado, só os 11 colorId fixos.
const CORES_PRIORIDADE_CALENDAR = { Alta: '11', Média: '6', Baixa: '10' };
const URL_COMPASSO = 'https://pulse.livemode.ai/api/compasso';

// ── Compasso ↔ Agenda do Google ──────────────────────────────────────────────────────────────
// Antes (até 2026-11-04) o prazo só ia pra agenda quando alguém criava/editava/apagava a tarefa, os erros
// eram engolidos e não existia nenhuma conferência depois: tarefa anterior à sincronização (02/08) ou de
// quem ainda não tinha autorizado a agenda nunca chegava lá. Agora: (1) cada chamada devolve o que
// aconteceu, (2) reconciliarAgendaCompasso() confere/ajusta TODAS as tarefas e roda todo dia (cron) e sob
// demanda (botão do gestor, com simulação), (3) tarefa atrasada sobe pra hoje, em vermelho.

function hojeBRTStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // YYYY-MM-DD
}
function somaDiasStr(s, n) {
  const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasEntreStr(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
function brData(s) { return s.split('-').reverse().join('/'); }

// Corpo do evento de dia inteiro de uma tarefa, ou null quando não deve haver evento (concluída ou sem prazo).
export function eventoDeTarefa(tarefa, hoje = hojeBRTStr()) {
  if (!tarefa || tarefa.status === 'Concluído' || !/^\d{4}-\d{2}-\d{2}$/.test(tarefa.prazo || '')) return null;
  const atraso = diasEntreStr(tarefa.prazo, hoje);
  const atrasada = atraso > 0;
  const dia = atrasada ? hoje : tarefa.prazo;
  const rotulo = atrasada
    ? `⚠ Atrasada há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}: ${tarefa.titulo} — Compasso`
    : `📌 Prazo: ${tarefa.titulo} — Compasso`;
  return {
    // Evento dia-inteiro (mesmo padrão de Folga/Ausência) — aparece como flag colorida no topo do dia.
    // end.date é exclusivo, por isso +1 dia. Atrasada: vira "hoje" em vermelho, até ser atualizada ou concluída.
    summary: rotulo,
    description: [
      atrasada ? `Prazo original: ${brData(tarefa.prazo)}. Atualize o andamento ou ajuste o prazo no Compasso.` : '',
      tarefa.descricao,
      `Abrir no Compasso: ${URL_COMPASSO}`,
    ].filter(Boolean).join('\n\n'),
    start: { date: dia },
    end: { date: somaDiasStr(dia, 1) },
    transparency: 'transparent',
    colorId: atrasada ? '11' : (CORES_PRIORIDADE_CALENDAR[tarefa.prioridade] || '6'),
    // Em evento dia-inteiro o Calendar só aceita "minutes" em múltiplos de 1440 (dias) — 0 = no dia,
    // 1440 = 1 dia antes. O horário do alerta segue a config do usuário (padrão 9h).
    reminders: { useDefault: false, overrides: atrasada ? [{ method: 'popup', minutes: 0 }] : [{ method: 'popup', minutes: 0 }, { method: 'popup', minutes: 1440 }] },
  };
}

async function lerEvento(accessToken, eventId) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (r.status === 404 || r.status === 410) return null;
  if (!r.ok) throw new Error(`GET ${r.status}: ${await r.text()}`);
  const ev = await r.json();
  return ev.status === 'cancelled' ? { cancelado: true } : ev;
}

// Aplica (ou remove, com corpo null) o evento de UMA tarefa. Devolve o que aconteceu:
// criado | atualizado | removido | sem_mudanca  (em simulação: criaria | atualizaria | removeria | sem_mudanca).
// Evento apagado antes fica "cancelado" e o mesmo id não pode ser recriado com POST (409): o PATCH com
// status 'confirmed' o restaura — sem isso, tarefa reaberta depois de concluída nunca voltava pra agenda.
async function aplicarTarefaNaAgenda(accessToken, eventId, corpo, simular = false) {
  const atual = await lerEvento(accessToken, eventId);
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const cab = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  if (!corpo) {
    if (!atual || atual.cancelado) return 'sem_mudanca';
    if (simular) return 'removeria';
    await deletarEvento(accessToken, eventId);
    return 'removido';
  }
  if (!atual) {
    if (simular) return 'criaria';
    const r = await fetch(base, { method: 'POST', headers: cab, body: JSON.stringify({ ...corpo, id: eventId }) });
    if (!r.ok) throw new Error(`POST ${r.status}: ${await r.text()}`);
    return 'criado';
  }
  const igual = !atual.cancelado && atual.summary === corpo.summary && atual.colorId === corpo.colorId
    && (atual.start || {}).date === corpo.start.date && (atual.end || {}).date === corpo.end.date
    && (atual.description || '') === corpo.description;
  if (igual) return 'sem_mudanca';
  if (simular) return 'atualizaria';
  const r = await fetch(`${base}/${eventId}`, { method: 'PATCH', headers: cab, body: JSON.stringify({ ...corpo, status: 'confirmed' }) });
  if (!r.ok) throw new Error(`PATCH ${r.status}: ${await r.text()}`);
  return 'atualizado';
}

// Resolve a pessoa na Equipe: { pessoa } pronta pra sincronizar, ou { estado } explicando por que não dá.
function localizarPessoaAgenda(equipe, nome) {
  const norm = normalizarNomeCalendar(nome);
  const linha = equipe.find(r => r[0] && normalizarNomeCalendar(r[0]) === norm);
  if (!linha) return { estado: 'nao_encontrada' };
  if ((linha[10] || 'ativo').toLowerCase() !== 'ativo') return { estado: 'inativo' };
  if (!linha[13]) return { estado: 'sem_autorizacao' };
  return { pessoa: linha };
}

// Estados que significam "o prazo NÃO está na agenda dessa pessoa" (a tela avisa quem criou/editou a tarefa).
export const ESTADOS_AGENDA_PROBLEMA = ['sem_autorizacao', 'token_invalido', 'erro'];

// Sincroniza (upsert) ou remove o evento de prazo de UMA tarefa na agenda de UMA pessoa — chamado ao
// criar/editar/excluir a tarefa (`tarefa` null = remover). Nunca lança erro; devolve { nome, estado, detalhe? }.
export async function sincronizarTarefaCompasso(nome, tarefaId, tarefa) {
  try {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const eq = (await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:N200')}`).catch(() => ({ values: [] }))).values || [];
    const achou = localizarPessoaAgenda(eq, nome);
    if (!achou.pessoa) return { nome, estado: achou.estado };
    let accessToken;
    try { accessToken = await getFreshAccessToken(achou.pessoa[13]); }
    catch (e) { console.error('sincronizarTarefaCompasso: acesso à agenda recusado pra', nome, e.message); return { nome, estado: 'token_invalido', detalhe: e.message }; }
    const estado = await aplicarTarefaNaAgenda(accessToken, gerarEventId(`tarefa|${nome}|${tarefaId}`), eventoDeTarefa(tarefa));
    return { nome, estado };
  } catch (e) {
    console.error('sincronizarTarefaCompasso falhou pra', nome, e.message);
    return { nome, estado: 'erro', detalhe: e.message };
  }
}

// Confere TODAS as tarefas do Compasso contra a agenda de cada responsável e corrige o que estiver fora:
// cria o que faltou, atualiza prazo/atraso, remove o que foi concluído. { simular: true } só relata.
// Roda todo dia (cron) e pelo botão "Sincronizar agenda" do gestor.
export async function reconciliarAgendaCompasso({ simular = false } = {}) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const ler = async (range) => (await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`)).values || [];
  const [linhas, equipe] = await Promise.all([ler('Compasso!A2:I500'), ler('Equipe!A2:N200')]);
  const hoje = hojeBRTStr();
  const tarefas = linhas.filter(r => r[0]).map(r => ({
    id: r[0], titulo: r[1] || '', descricao: r[2] || '', responsavel: r[3] || '', status: r[4] || 'A Fazer', prioridade: r[5] || 'Baixa', prazo: r[8] || '',
  }));

  const porPessoa = new Map(); // nome normalizado -> { nome, tarefas: [] }
  for (const t of tarefas) {
    for (const nome of t.responsavel.split(',').map(s => s.trim()).filter(Boolean)) {
      const k = normalizarNomeCalendar(nome);
      if (!porPessoa.has(k)) porPessoa.set(k, { nome, tarefas: [] });
      porPessoa.get(k).tarefas.push({ t, grafia: nome }); // o id do evento usa a grafia exata gravada na tarefa
    }
  }

  const processar = async ({ nome, tarefas: lista }) => {
    const rel = { nome, estado: 'ok', tarefas: lista.length, criado: 0, atualizado: 0, removido: 0, semMudanca: 0, erros: [] };
    const achou = localizarPessoaAgenda(equipe, nome);
    if (!achou.pessoa) { rel.estado = achou.estado; return rel; }
    let accessToken;
    try { accessToken = await getFreshAccessToken(achou.pessoa[13]); }
    catch (e) { rel.estado = 'token_invalido'; rel.erros.push(e.message); return rel; }
    for (const { t, grafia } of lista) { // em sequência por pessoa: poupa a cota da API do Google
      try {
        const r = await aplicarTarefaNaAgenda(accessToken, gerarEventId(`tarefa|${grafia}|${t.id}`), eventoDeTarefa(t, hoje), simular);
        if (r === 'criado' || r === 'criaria') rel.criado++;
        else if (r === 'atualizado' || r === 'atualizaria') rel.atualizado++;
        else if (r === 'removido' || r === 'removeria') rel.removido++;
        else rel.semMudanca++;
      } catch (e) { rel.erros.push(`${t.titulo}: ${e.message}`); }
    }
    if (rel.erros.length) rel.estado = 'erro';
    return rel;
  };

  const pessoas = await Promise.all([...porPessoa.values()].map(processar));
  const soma = (campo) => pessoas.reduce((n, p) => n + p[campo], 0);
  return {
    simulacao: simular, hoje,
    resumo: {
      pessoas: pessoas.length, tarefas: tarefas.length,
      criado: soma('criado'), atualizado: soma('atualizado'), removido: soma('removido'), semMudanca: soma('semMudanca'),
      semAutorizacao: pessoas.filter(p => p.estado === 'sem_autorizacao').map(p => p.nome),
      acessoRecusado: pessoas.filter(p => p.estado === 'token_invalido').map(p => p.nome),
      comErro: pessoas.filter(p => p.estado === 'erro').map(p => p.nome),
    },
    pessoas,
  };
}
