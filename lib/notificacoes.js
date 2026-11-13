// lib/notificacoes.js — avisos de mudança de escala para o celular (Web Push, ver lib/push.js e sw.js).
// Regras combinadas com o Guilherme (2026-11-13): só vale pra dias JÁ PUBLICADOS (de hoje até o horizonte), e é um aviso por edição.
// Abas na planilha (criadas sozinhas): Notificacoes (histórico/texto que o service worker busca) e PushInscricoes (aparelhos).
// Falha aqui NUNCA pode quebrar a edição da escala: tudo é try/catch e quem chama não espera exceção.
import { sheetsRequest } from './google-auth.js';
import { enviarPush, endpointValido } from './push.js';

const ID = () => process.env.GOOGLE_SHEET_ID;
const ABAS = {
  Notificacoes: ['id', 'quando', 'nome', 'titulo', 'corpo', 'url', 'push'],
  PushInscricoes: ['nome', 'endpoint', 'quando', 'aparelho'],
};
let abasOk = false;

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function brt() { return new Date(Date.now() - 3 * 3600 * 1000); }   // "agora" em BRT, lido com getUTC*
function agoraTxt() { const d = brt(); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; }

async function garantirAbas() {
  if (abasOk) return;
  const meta = await sheetsRequest(ID(), '?fields=sheets.properties.title');
  const tem = new Set((meta.sheets || []).map((s) => s.properties.title));
  const faltam = Object.keys(ABAS).filter((n) => !tem.has(n));
  if (faltam.length) {
    await sheetsRequest(ID(), ':batchUpdate', 'POST', { requests: faltam.map((n) => ({ addSheet: { properties: { title: n } } })) });
    for (const n of faltam) {
      const ult = String.fromCharCode(64 + ABAS[n].length);
      await sheetsRequest(ID(), `/values/${encodeURIComponent(`${n}!A1:${ult}1`)}?valueInputOption=RAW`, 'PUT', { values: [ABAS[n]] });
    }
  }
  abasOk = true;
}

async function ler(aba, ultimaCol) {
  const d = await sheetsRequest(ID(), `/values/${encodeURIComponent(`${aba}!A2:${ultimaCol}5000`)}`);
  return d.values || [];
}
async function gravarLinha(aba, ultimaCol, linha) {
  // sem values.append (desalinha colunas — ver CLAUDE.md 2026-07-11): calcula a próxima linha e grava com PUT
  const n = (await ler(aba, 'A')).length + 2;
  await sheetsRequest(ID(), `/values/${encodeURIComponent(`${aba}!A${n}:${ultimaCol}${n}`)}?valueInputOption=RAW`, 'PUT', { values: [linha] });
}

// ── aparelhos ──
export async function inscrever(nome, endpoint, aparelho) {
  if (!endpointValido(endpoint)) throw new Error('endereço de push inválido');
  await garantirAbas();
  const linhas = await ler('PushInscricoes', 'D');
  const i = linhas.findIndex((r) => r[1] === endpoint);
  const linha = [nome, endpoint, agoraTxt(), String(aparelho || '').slice(0, 120)];
  if (i >= 0) await sheetsRequest(ID(), `/values/${encodeURIComponent(`PushInscricoes!A${i + 2}:D${i + 2}`)}?valueInputOption=RAW`, 'PUT', { values: [linha] });
  else await gravarLinha('PushInscricoes', 'D', linha);
}
export async function desinscrever(nome, endpoint) {
  await garantirAbas();
  const linhas = await ler('PushInscricoes', 'D');
  const i = linhas.findIndex((r) => r[1] === endpoint && norm(r[0]) === norm(nome));
  if (i >= 0) await sheetsRequest(ID(), `/values/${encodeURIComponent(`PushInscricoes!A${i + 2}:D${i + 2}`)}?valueInputOption=RAW`, 'PUT', { values: [['', '', '', '']] });
}
export async function temInscricao(nome) {
  await garantirAbas();
  return (await ler('PushInscricoes', 'D')).some((r) => r[1] && norm(r[0]) === norm(nome));
}

// ── mensagens que o service worker busca (últimos minutos, dessa pessoa) ──
export async function pendentes(nome, minutos = 3) {
  await garantirAbas();
  const corte = new Date(brt().getTime() - minutos * 60000);
  return (await ler('Notificacoes', 'G'))
    .filter((r) => r[0] && norm(r[2]) === norm(nome) && new Date(String(r[1]).replace(' ', 'T') + 'Z') >= corte)
    .map((r) => ({ id: r[0], titulo: r[3], corpo: r[4], url: r[5] || '/api/app' }));
}

// ── envio ──
export async function notificarPessoa(nome, titulo, corpo, url = '/api/app') {
  try {
    await garantirAbas();
    const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const inscr = (await ler('PushInscricoes', 'D')).map((r, i) => ({ r, i })).filter((x) => x.r[1] && norm(x.r[0]) === norm(nome));
    let enviados = 0;
    // grava o texto ANTES de avisar, pra o service worker já encontrar quando o push chegar
    await gravarLinha('Notificacoes', 'G', [id, agoraTxt(), nome, titulo, corpo, url, inscr.length ? 'enviando' : 'sem aparelho']);
    for (const x of inscr) {
      const r = await enviarPush(x.r[1]);
      if (r.ok) enviados++;
      else if (r.expirou) await sheetsRequest(ID(), `/values/${encodeURIComponent(`PushInscricoes!A${x.i + 2}:D${x.i + 2}`)}?valueInputOption=RAW`, 'PUT', { values: [['', '', '', '']] }).catch(() => {});
    }
    return { enviados, aparelhos: inscr.length };
  } catch (e) {
    console.error('notificarPessoa falhou', nome, e && e.message);
    return { enviados: 0, aparelhos: 0, erro: true };
  }
}

// ── "dia publicado": de hoje até o horizonte (PulseConfig publicacao_horizonte, DD/MM) ──
export async function horizontePublicado() {
  try {
    const d = await sheetsRequest(ID(), `/values/${encodeURIComponent('PulseConfig!A2:B20')}`);
    const v = ((d.values || []).find((r) => r[0] === 'publicacao_horizonte') || [])[1] || '';
    const m = String(v).match(/^(\d{1,2})\/(\d{1,2})$/);
    return m ? { dia: +m[1], mes: +m[2] } : null;
  } catch { return null; }
}
function dataDoDDMM(ddmm, hoje) {
  const m = String(ddmm || '').match(/^(\d{1,2})\/(\d{1,2})$/); if (!m) return null;
  let d = new Date(Date.UTC(hoje.getUTCFullYear(), +m[2] - 1, +m[1]));
  if (d < hoje) d = new Date(Date.UTC(hoje.getUTCFullYear() + 1, +m[2] - 1, +m[1]));
  return d;
}
export async function datasPublicadas(datas) {
  const h = await horizontePublicado(); if (!h) return [];
  const b = brt(), hoje = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  let fim = new Date(Date.UTC(hoje.getUTCFullYear(), h.mes - 1, h.dia)); if (fim < hoje) fim = new Date(Date.UTC(hoje.getUTCFullYear() + 1, h.mes - 1, h.dia));
  return [...new Set(datas)].filter((x) => { const d = dataDoDDMM(x, hoje); return d && d <= fim; });
}

const hora = (t) => String(t || '').slice(0, 5);
function descreverEstado(e) {
  if (!e) return null;
  const obs = String(e.obs || '').trim();
  if (e.removido) return 'sem turno';
  if (/f[eé]rias/i.test(obs)) return 'férias';
  if (/dispensa|atestado/i.test(obs)) return 'dispensa médica';
  if (/folga/i.test(obs) && !e.ent) return 'folga';
  if (e.ent && e.sai) return `${hora(e.ent)}–${hora(e.sai)}`;
  return obs || null;
}

// Um aviso por chamada (= por edição). `datas`: DD/MM. `depois`: { ent, sai, obs } ou { removido:true } ou { texto } livre.
// `antes`: opcional, mesmo formato. `por`: nome de quem editou (aparece no aviso).
export async function notificarMudancaEscala({ colaborador, datas, antes = null, depois = null, por = '', texto = '' }) {
  try {
    if (!colaborador || !Array.isArray(datas) || !datas.length) return { enviados: 0 };
    const pub = await datasPublicadas(datas);
    if (!pub.length) return { enviados: 0, motivo: 'dia não publicado' };
    const b = brt(), hoje = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
    pub.sort((x, y) => dataDoDDMM(x, hoje) - dataDoDDMM(y, hoje));
    const dep = descreverEstado(depois), ant = descreverEstado(antes);
    let corpo;
    if (texto) corpo = texto;
    else if (pub.length === 1) corpo = ant && dep && ant !== dep ? `${pub[0]}: ${ant} → ${dep}` : `${pub[0]}: ${dep || 'turno alterado'}`;
    else corpo = `${pub.slice(0, 4).join(', ')}${pub.length > 4 ? ` e mais ${pub.length - 4}` : ''}: ${dep || 'turno alterado'}`;
    if (por && norm(por) !== norm(colaborador)) corpo += ` (por ${String(por).split(' ')[0]})`;
    return await notificarPessoa(colaborador, pub.length === 1 ? 'Seu turno mudou' : 'Sua escala mudou', corpo);
  } catch (e) {
    console.error('notificarMudancaEscala falhou', e && e.message);
    return { enviados: 0, erro: true };
  }
}

// Aviso pra várias pessoas de uma vez (ex.: escala publicada). Lê as inscrições uma vez só e ignora quem não tem aparelho cadastrado.
export async function notificarVarios(nomes, titulo, corpo, url = '/api/app') {
  let enviados = 0;
  try {
    await garantirAbas();
    const inscr = (await ler('PushInscricoes', 'D')).filter((r) => r[1]);
    const com = new Set(inscr.map((r) => norm(r[0])));
    for (const nome of [...new Set(nomes)].filter((n) => com.has(norm(n)))) { const r = await notificarPessoa(nome, titulo, corpo, url); enviados += r.enviados || 0; }
  } catch (e) { console.error('notificarVarios falhou', e && e.message); }
  return { enviados };
}
