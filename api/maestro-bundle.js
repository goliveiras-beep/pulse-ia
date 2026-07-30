// api/maestro-bundle.js
// bundle dedicado do MAESTRO - unica function fisica pras rotas do MAESTRO, isolada
// das rotas do Pulse (nenhum arquivo aqui e compartilhado com outro bundle), pra
// mexer no MAESTRO sem risco de derrubar o resto do portal. despacha por
// ?_route=, igual aos outros bundles (auth-bundle.js, gestao-bundle.js etc).
export const config = { maxDuration: 30 };
import painelHandler from '../lib/routes/maestro-painel.js';
import telemetriaHandler from '../lib/routes/maestro-telemetria.js';

const ROUTES = {
  painel: painelHandler,
  telemetria: telemetriaHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
