// worker.js — entrada do Cloudflare Workers. Mesmo código das rotas da Vercel, via adaptador
// (ver cloudflare/adapter.js). Estáticos vêm do binding ASSETS (pasta .cf-assets, gerada por
// scripts/cf-assets.mjs). Os crons do vercel.json viram Cron Triggers (wrangler.toml).
import { criarReqRes } from './cloudflare/adapter.js';
import { resolverRota, CABECALHOS, CRONS } from './cloudflare/rotas.js';

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

export default {
  async fetch(request, env, ctx) {
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
