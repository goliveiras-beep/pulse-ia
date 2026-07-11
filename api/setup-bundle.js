// api/setup-bundle.js — agrupa os scripts de provisionamento único (setup-auth, setup-config,
// setup-equipe, setup-escala, setup-sheets) em uma única Serverless Function, para caber no
// limite de 12 functions do plano Hobby da Vercel. URLs públicas inalteradas (rewrite no vercel.json).
export const config = { maxDuration: 30 };

import setupAuthHandler from '../lib/routes/setup-auth.js';
import setupConfigHandler from '../lib/routes/setup-config.js';
import setupEquipeHandler from '../lib/routes/setup-equipe.js';
import setupEscalaHandler from '../lib/routes/setup-escala.js';
import setupSheetsHandler from '../lib/routes/setup-sheets.js';

const ROUTES = {
  'setup-auth': setupAuthHandler,
  'setup-config': setupConfigHandler,
  'setup-equipe': setupEquipeHandler,
  'setup-escala': setupEscalaHandler,
  'setup-sheets': setupSheetsHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
