// lib/opera.js — leitura da escala do sistema de Operações CazéTV (opera.livemode.ai), API da Ste.
//
//   GET https://opera.livemode.ai/api/v1/escala?inicio=AAAA-MM-DD&fim=AAAA-MM-DD
//   Authorization: Bearer <OPERA_API_KEY>   (chave pessoal do Guilherme, começa com opk_ — secret do Cloudflare, nunca no código)
//
// Resposta: { turnos: [{ data, cargo, nome, situacao: turno|folga|ferias|dispensa, entrada, saida, origem: registrado|previsto }] }
// Limites da API: até 62 dias por consulta e até 31 dias à frente de hoje; a resposta deles já fica 5 min em cache.
// Só leitura: nada daqui é gravado na planilha do Pulse (não entra em alerta CLT, aviso, agenda nem mapa).

const OPERA_URL = 'https://opera.livemode.ai/api/v1/escala';
const CACHE_TTL = 300;          // mesmo tempo do cache do lado deles
const MAX_FRENTE = 31, MAX_JANELA = 62;

const isoUTC = d => d.toISOString().slice(0, 10);
function hojeBRT() {
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
const somaDias = (d, n) => new Date(d.getTime() + n * 86400000);

// "DD/MM" (formato da aba Escala, sem ano) → Date UTC no ano que deixa a data mais perto de hoje
export function ddmmParaData(ddmm, hoje = hojeBRT()) {
  const [dia, mes] = String(ddmm || '').split('/').map(Number);
  if (!dia || !mes) return null;
  let melhor = null;
  for (const ano of [hoje.getUTCFullYear() - 1, hoje.getUTCFullYear(), hoje.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCMonth() !== mes - 1) continue;
    if (!melhor || Math.abs(d - hoje) < Math.abs(melhor - hoje)) melhor = d;
  }
  return melhor;
}

// Busca os turnos entre inicio e fim (Date UTC), já recortado pros limites da API.
// Devolve { turnos, fimEfetivo } ou { erro } — nunca lança (a página da escala não pode cair por causa da Opera).
export async function getEscalaOpera(inicio, fim) {
  const chave = process.env.OPERA_API_KEY;
  if (!chave) return { erro: 'sem-chave' };
  const hoje = hojeBRT();
  const limite = somaDias(hoje, MAX_FRENTE);
  if (fim > limite) fim = limite;
  if (inicio > fim) return { turnos: [], fimEfetivo: fim };
  if ((fim - inicio) / 86400000 > MAX_JANELA) inicio = somaDias(fim, -MAX_JANELA);

  const url = `${OPERA_URL}?inicio=${isoUTC(inicio)}&fim=${isoUTC(fim)}`;
  const chaveCache = `https://opera-cache.pulse.internal/escala?i=${isoUTC(inicio)}&f=${isoUTC(fim)}`;
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (cache) {
    try { const hit = await cache.match(chaveCache); if (hit) return { turnos: (await hit.json()).turnos || [], fimEfetivo: fim }; } catch {}
  }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${chave}` }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) { console.error('opera: escala respondeu', r.status); return { erro: r.status === 401 ? 'chave-recusada' : 'indisponivel' }; }
    const texto = await r.text();
    const turnos = JSON.parse(texto).turnos || [];
    if (cache) {
      try { await cache.put(chaveCache, new Response(texto, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })); } catch {}
    }
    return { turnos, fimEfetivo: fim };
  } catch (e) {
    console.error('opera: falha lendo escala', e?.message);
    return { erro: 'indisponivel' };
  }
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ROTULO = { folga: 'Folga', ferias: 'Férias', dispensa: 'Dispensa' };

// Busca uma vez só os turnos da Opera pros dias que a página está mostrando (`datas` = lista "DD/MM").
export async function carregarOpera(datas) {
  const hoje = hojeBRT();
  const dias = (Array.isArray(datas) ? datas : []).map(df => ({ df, d: ddmmParaData(df, hoje) })).filter(x => x.d);
  if (!dias.length) return { dias, r: { turnos: [], fimEfetivo: hoje } };
  return { dias, r: await getEscalaOpera(dias[0].d, dias[dias.length - 1].d) };
}

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const tokens = s => semAcento(s).split(/\s+/).filter(t => t && !PARTICULAS.has(t));

// Casa as pessoas de Coordenação do Pulse com as da Opera. Os nomes não batem certinho ("Osmar Araujo" no Pulse é
// "Osmar Felipe de Araújo Mulina Pereira" na Opera): vale o mesmo primeiro nome + o último sobrenome do Pulse aparecer
// no nome da Opera. Se der mais de um candidato, não casa (melhor célula vazia que horário da pessoa errada).
// Devolve { porPulse: Map(nomePulse → Map("DD/MM" → turno)), casadosOpera: Set(nomeOpera) }.
export function casarCoordenadores(nomesPulse, carga) {
  const porPulse = new Map(), casadosOpera = new Set();
  if (!carga || carga.r.erro) return { porPulse, casadosOpera };
  const ddmm = new Map(carga.dias.map(x => [isoUTC(x.d), x.df]));
  const opera = new Map();   // nomeOpera → Map("DD/MM" → turno)
  for (const t of carga.r.turnos) {
    if (!/coordena/i.test(t.cargo || '') || !ddmm.has(t.data)) continue;
    if (!opera.has(t.nome)) opera.set(t.nome, new Map());
    opera.get(t.nome).set(ddmm.get(t.data), t);
  }
  // Quem só tem folga no período não casa (Guilherme/Marcos: escala real no Pulse, a Opera lista folga todo dia).
  for (const [n, m] of opera) if (![...m.values()].some(t => t.situacao === 'turno')) opera.delete(n);
  for (const nomeP of nomesPulse) {
    const tp = tokens(nomeP);
    if (tp.length < 2) continue;
    const cands = [...opera.keys()].filter(n => { const to = tokens(n); return to[0] === tp[0] && to.includes(tp[tp.length - 1]); });
    if (cands.length !== 1) continue;
    porPulse.set(nomeP, opera.get(cands[0]));
    casadosOpera.add(cands[0]);
  }
  return { porPulse, casadosOpera };
}

// Célula da grade da Escala preenchida pela Opera (só quando o Pulse não tem linha pra pessoa naquele dia).
// Contorno tracejado + selo "Opera" pra nunca confundir com turno lançado no Pulse. modo: 'semana' | 'dia' | 'mes'.
export function celulaOpera(t, modo) {
  const turno = t.situacao === 'turno';
  const txt = turno ? `${esc(t.entrada || '?')}–${esc(t.saida || '?')}` : esc(ROTULO[t.situacao] || t.situacao);
  const dica = `Escala da Opera (${t.origem === 'previsto' ? 'prevista, pode mudar até o dia' : 'registrada'}) — não está lançado no Pulse`;
  const cor = turno ? 'var(--text)' : 'var(--text2)';
  if (modo === 'mes') return `<div style="font-size:7px;line-height:1.15;color:${cor}" title="${esc(dica)}">${turno ? `${esc(t.entrada || '?')}<br>${esc(t.saida || '?')}` : txt}</div>`;
  const pad = modo === 'dia' ? '8px 10px' : '5px 6px', fs = modo === 'dia' ? 12 : 10;
  return `<div title="${esc(dica)}" style="border:1px dashed var(--border);border-radius:6px;padding:${pad};min-height:${modo === 'dia' ? 0 : 52}px">
    <div style="font-size:${fs}px;font-weight:700;color:${cor}">${txt}</div>
    <div style="font-size:8px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Opera</div>
  </div>`;
}

// Faixa "Coordenação (Opera)" pra página de Escala: uma linha por coordenador da Opera que NÃO está na equipe do Pulse
// (os que estão já aparecem na própria linha deles, via celulaOpera). Uma coluna por dia da visão atual.
export async function blocoCoordenacaoOpera(datas, carga, casadosOpera = new Set()) {
  if (!Array.isArray(datas) || !datas.length) return '';
  const hoje = hojeBRT();
  carga = carga || await carregarOpera(datas);
  const { dias, r } = carga;
  if (!dias.length) return '';

  const moldura = corpo => `<details open style="margin-top:20px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px">
  <summary style="cursor:pointer;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;letter-spacing:.04em">Coordenação · Operações CazéTV <span style="text-transform:none;font-weight:400">(somente leitura, vem do opera.livemode.ai)</span></summary>
  <div style="margin-top:10px">${corpo}</div>
</details>`;
  if (r.erro) {
    const msg = r.erro === 'sem-chave' ? 'Chave da Opera não configurada.' : r.erro === 'chave-recusada' ? 'A Opera recusou a chave de acesso (revogada ou errada).' : 'A escala da Opera não respondeu agora. Recarregue em alguns minutos.';
    return moldura(`<div style="font-size:12px;color:var(--text2)">${msg}</div>`);
  }

  const coord = r.turnos.filter(t => /coordena/i.test(t.cargo || '') && !casadosOpera.has(t.nome));
  const porNome = new Map();
  for (const t of coord) {
    if (!porNome.has(t.nome)) porNome.set(t.nome, new Map());
    porNome.get(t.nome).set(t.data, t);
  }
  // Quem não tem nenhum turno no período sai da faixa: é o caso de quem tem a escala real no Pulse (Guilherme, Marcos),
  // que a Opera lista como folga todo dia — mostrar "Folga" a semana toda pra eles engana.
  for (const [nome, m] of porNome) if (![...m.values()].some(t => t.situacao === 'turno')) porNome.delete(nome);
  if (!porNome.size) return '';   // todo mundo com turno já aparece na própria linha da grade

  const hojeISO = isoUTC(hoje);
  const cab = dias.map(({ df, d }) => {
    const ehHoje = isoUTC(d) === hojeISO;
    return `<th style="padding:6px 8px;font-size:10px;font-weight:600;color:${ehHoje ? 'var(--text)' : '#888'};text-align:center;white-space:nowrap;border-bottom:1px solid var(--border)">${DIAS[d.getUTCDay()]}<br>${esc(df)}</th>`;
  }).join('');
  const linhas = [...porNome.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(nome => {
    const m = porNome.get(nome);
    const cels = dias.map(({ d }) => {
      const iso = isoUTC(d);
      if (d > r.fimEfetivo) return `<td style="padding:6px 8px;text-align:center;font-size:11px;color:var(--text3)" title="A Opera só mostra até 31 dias à frente">—</td>`;
      const t = m.get(iso);
      if (!t) return `<td style="padding:6px 8px;text-align:center;font-size:11px;color:var(--text3)">—</td>`;
      if (t.situacao === 'turno') {
        const h = `${esc(t.entrada || '?')}–${esc(t.saida || '?')}`;
        return `<td style="padding:6px 8px;text-align:center;font-size:11px;color:var(--text);white-space:nowrap" title="${t.origem === 'previsto' ? 'Previsto (pode mudar até o dia)' : 'Registrado'}">${h}</td>`;
      }
      return `<td style="padding:6px 8px;text-align:center;font-size:11px;color:var(--text2)">${esc(ROTULO[t.situacao] || t.situacao)}</td>`;
    }).join('');
    return `<tr><td style="padding:6px 8px;font-size:12px;color:var(--text);white-space:nowrap;border-right:1px solid var(--border)">${esc(nome)}</td>${cels}</tr>`;
  }).join('');

  return moldura(`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="border-bottom:1px solid var(--border)"></th>${cab}</tr></thead><tbody>${linhas}</tbody></table></div>`);
}
