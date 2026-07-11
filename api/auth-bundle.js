// api/auth-bundle.js — agrupa as rotas de autenticação (callback, check-status, drive-token, register)
// em uma única Serverless Function, para caber no limite de 12 functions do plano Hobby da Vercel.
// As URLs públicas (/api/auth/callback etc) continuam as mesmas — o roteamento é feito via rewrite
// no vercel.json, que injeta ?_route=<nome> antes de chegar aqui.
export const config = { maxDuration: 30 };

import callbackHandler from '../lib/routes/callback.js';
import checkStatusHandler from '../lib/routes/check-status.js';
import driveTokenHandler from '../lib/routes/drive-token.js';
import registerHandler from '../lib/routes/register.js';

const ROUTES = {
  'callback': callbackHandler,
  'check-status': checkStatusHandler,
  'drive-token': driveTokenHandler,
  'register': registerHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
