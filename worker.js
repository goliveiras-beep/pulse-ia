// worker.js — entrada do Cloudflare Workers. Mesmo código das rotas da Vercel, via adaptador
// (ver cloudflare/adapter.js). Estáticos vêm do binding ASSETS (pasta .cf-assets, gerada por
// scripts/cf-assets.mjs). Os crons do vercel.json viram Cron Triggers (wrangler.toml).
import { criarReqRes } from './cloudflare/adapter.js';
import { resolverRota, CABECALHOS, CRONS } from './cloudflare/rotas.js';
import { Presenca } from './cloudflare/presenca.js';
import { Sensores } from './cloudflare/sensores.js';
import { sessaoDoCookie, getRacks } from './lib/routes/mapa.js';
export { Presenca, Sensores };

// comparação sem vazar, pelo tempo, quantos caracteres batem (token da ponte dos sensores)
function igual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

function comCabecalhos(resposta) {
  const h = new Headers(resposta.headers);
  for (const [k, v] of CABECALHOS) h.set(k, v);
  return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers: h });
}

async function despachar(request) {
  const url = new URL(request.url);
  const rota = resolverRota(url.pathname);
  if (!rota) return null;
  const { req, res, montarResposta } = await criarReqRes(request, rota);
  try {
    await rota.handler(req, res);
  } catch (err) {
    console.error('erro na rota', url.pathname, err?.stack || err);
    res.status(500).json({ error: 'Erro interno' });
  }
  return montarResposta();
}

// IP → rack/equipamento (aba MapaRacks da planilha), só pra ligar cada alerta do Zabbix ao rack certo; o IP NUNCA sai daqui pro navegador.
let cacheIps = { t: 0, mapa: new Map() };
async function mapaDeIps() {
  if (Date.now() - cacheIps.t < 5 * 60000 && cacheIps.mapa.size) return cacheIps.mapa;
  try {
    const m = new Map();
    for (const r of await getRacks()) for (const i of r.itens.concat(r.fora)) { const ip = String(i.ip || '').trim(); if (ip) m.set(ip, { rack: r.codigo, equip: i.nome }); }
    cacheIps = { t: Date.now(), mapa: m };
  } catch (e) { console.error('zabbix: não li a planilha de racks', e && e.message); cacheIps.t = Date.now() - 4 * 60000; }
  return cacheIps.mapa;
}
async function zabbixParaNavegador(corpoDO) {
  const d = JSON.parse(corpoDO); if (!d.zabbix) return d;
  const ips = await mapaDeIps();
  d.zabbix.problemas = d.zabbix.problemas.map(p => { const hit = ips.get(p.ip) || {}; const { ip, ...resto } = p; return { ...resto, rack: p.rack || hit.rack || '', equip: hit.equip || '' }; });
  return d;
}

export default {
  async fetch(request, env, ctx) {
    // Endereço do workers.dev: existe só pra skill da Alexa. Qualquer outra rota nele é 404 (o Pulse de verdade fica em pulse.livemode.ai).
    const alvo = new URL(request.url);
    if (alvo.hostname.endsWith('.workers.dev') && alvo.pathname !== '/api/alexa') return new Response('Não encontrado', { status: 404 });
    // Mapa 3D: quem está passeando agora / "olha isso" (Durable Object, ver cloudflare/presenca.js). Só logado.
    if (alvo.pathname === '/api/presenca') {
      const s = sessaoDoCookie(request.headers.get('cookie') || '');
      if (!s) return comCabecalhos(Response.json({ error: 'Não autenticado' }, { status: 401 }));
      const h = new Headers({ 'x-pulse-nome': encodeURIComponent(s.nome), 'content-type': 'application/json' });
      const obj = env.PRESENCA.get(env.PRESENCA.idFromName('central'));
      const r = await obj.fetch('https://presenca/', { method: request.method, headers: h, body: request.method === 'POST' ? await request.text() : undefined });
      return comCabecalhos(new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
    }
    // Sensores de temperatura da central (Durable Object, ver cloudflare/sensores.js).
    // POST /api/sensores/leitura: só a ponte, com o token (SENSOR_TOKEN). GET /api/sensores: só logado.
    if (alvo.pathname === '/api/sensores/leitura' && request.method === 'POST') {
      const esperado = env.SENSOR_TOKEN ? 'Bearer ' + env.SENSOR_TOKEN : '';
      if (!esperado || !igual(request.headers.get('authorization') || '', esperado)) return comCabecalhos(Response.json({ error: 'Não autorizado' }, { status: 401 }));
      const corpo = await request.text();
      if (corpo.length > 8000) return comCabecalhos(Response.json({ error: 'Grande demais' }, { status: 413 }));
      const obj = env.SENSORES.get(env.SENSORES.idFromName('central'));
      const r = await obj.fetch('https://sensores/', { method: 'POST', body: corpo });
      return comCabecalhos(new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
    }
    if (alvo.pathname === '/api/sensores' && request.method === 'GET') {
      if (!sessaoDoCookie(request.headers.get('cookie') || '')) return comCabecalhos(Response.json({ error: 'Não autenticado' }, { status: 401 }));
      const obj = env.SENSORES.get(env.SENSORES.idFromName('central'));
      const r = await obj.fetch('https://sensores/', { method: 'GET' });
      return comCabecalhos(new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
    }
    // Zabbix do Bruno (SÓ LEITURA no Pulse): a ponte manda o resumo; o mapa lê. Mesmo token da ponte dos sensores.
    if (alvo.pathname === '/api/zabbix/leitura' && request.method === 'POST') {
      const esperado = env.SENSOR_TOKEN ? 'Bearer ' + env.SENSOR_TOKEN : '';
      if (!esperado || !igual(request.headers.get('authorization') || '', esperado)) return comCabecalhos(Response.json({ error: 'Não autorizado' }, { status: 401 }));
      const corpo = await request.text();
      if (corpo.length > 400000) return comCabecalhos(Response.json({ error: 'Grande demais' }, { status: 413 }));
      const obj = env.SENSORES.get(env.SENSORES.idFromName('central'));
      const r = await obj.fetch('https://sensores/zabbix', { method: 'POST', body: corpo });
      return comCabecalhos(new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
    }
    if (alvo.pathname === '/api/zabbix' && request.method === 'GET') {
      if (!sessaoDoCookie(request.headers.get('cookie') || '')) return comCabecalhos(Response.json({ error: 'Não autenticado' }, { status: 401 }));
      const obj = env.SENSORES.get(env.SENSORES.idFromName('central'));
      const r = await obj.fetch('https://sensores/zabbix', { method: 'GET' });
      const d = await zabbixParaNavegador(await r.text());
      return comCabecalhos(new Response(JSON.stringify(d), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
    }
    const resp = await despachar(request);
    if (resp) return comCabecalhos(resp);
    if (new URL(request.url).pathname.startsWith('/api/')) {
      return comCabecalhos(Response.json({ error: 'Rota não encontrada' }, { status: 404 }));
    }
    return comCabecalhos(await env.ASSETS.fetch(request));
  },

  // Cron Triggers: a expressão em wrangler.toml tem que bater com vercel.json "crons".
  async scheduled(event, env, ctx) {
    const base = env.PULSE_BASE_URL || 'https://pulse.livemode.ai';
    const c = CRONS.find((x) => x.schedule === event.cron);
    if (!c) return;
    const request = new Request(base + c.path, { headers: { authorization: `Bearer ${env.CRON_SECRET || ''}` } });
    const resp = await despachar(request);
    console.log('cron', c.path, resp?.status);
  },
};
