// api/gestao-bundle.js — agrupa rotas de gestão de equipe/escala (equipe, equipe-view, dashboard,
// banco-horas, publicar) em uma única Serverless Function, para caber no limite de 12 functions
// do plano Hobby da Vercel. URLs públicas inalteradas (rewrite no vercel.json).
export const config = { maxDuration: 30 };

import equipeHandler from '../lib/routes/equipe.js';
import equipeViewHandler from '../lib/routes/equipe-view.js';
import dashboardHandler from '../lib/routes/dashboard.js';
import bancoHorasHandler from '../lib/routes/banco-horas.js';
import publicarHandler from '../lib/routes/publicar.js';

const ROUTES = {
  'equipe': equipeHandler,
  'equipe-view': equipeViewHandler,
  'dashboard': dashboardHandler,
  'banco-horas': bancoHorasHandler,
  'publicar': publicarHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
