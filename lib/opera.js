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

// Faixa "Coordenação (Opera)" pra página de Escala: uma linha por coordenador, uma coluna por dia da visão atual.
// `datas` = lista "DD/MM" que a página já está mostrando.
export async function blocoCoordenacaoOpera(datas) {
  if (!Array.isArray(datas) || !datas.length) return '';
  const hoje = hojeBRT();
  const dias = datas.map(df => ({ df, d: ddmmParaData(df, hoje) })).filter(x => x.d);
  if (!dias.length) return '';
  const r = await getEscalaOpera(dias[0].d, dias[dias.length - 1].d);

  const moldura = corpo => `<details open style="margin-top:20px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px">
  <summary style="cursor:pointer;font-size:10px;font-weight:600;text-transform:uppercase;color:#888;letter-spacing:.04em">Coordenação · Operações CazéTV <span style="text-transform:none;font-weight:400">(somente leitura, vem do opera.livemode.ai)</span></summary>
  <div style="margin-top:10px">${corpo}</div>
</details>`;
  if (r.erro) {
    const msg = r.erro === 'sem-chave' ? 'Chave da Opera não configurada.' : r.erro === 'chave-recusada' ? 'A Opera recusou a chave de acesso (revogada ou errada).' : 'A escala da Opera não respondeu agora. Recarregue em alguns minutos.';
    return moldura(`<div style="font-size:12px;color:var(--text2)">${msg}</div>`);
  }

  const coord = r.turnos.filter(t => /coordena/i.test(t.cargo || ''));
  const porNome = new Map();
  for (const t of coord) {
    if (!porNome.has(t.nome)) porNome.set(t.nome, new Map());
    porNome.get(t.nome).set(t.data, t);
  }
  // Quem não tem nenhum turno no período sai da faixa: é o caso de quem tem a escala real no Pulse (Guilherme, Marcos),
  // que a Opera lista como folga todo dia — mostrar "Folga" a semana toda pra eles engana.
  for (const [nome, m] of porNome) if (![...m.values()].some(t => t.situacao === 'turno')) porNome.delete(nome);
  if (!porNome.size) return moldura(`<div style="font-size:12px;color:var(--text2)">Nenhum turno de Coordenação neste período.</div>`);

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
