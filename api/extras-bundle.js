// api/extras-bundle.js — agrupa rotas diversas (ausencias, repositorio, meu-turno, import-escala,
// upload-atestado, fix-gestor) em uma única Serverless Function, para caber no limite de 12
// functions do plano Hobby da Vercel. URLs públicas inalteradas (rewrite no vercel.json).
// maxDuration 60 porque import-escala precisa desse tempo.
export const config = { maxDuration: 60 };

import ausenciasHandler from '../lib/routes/ausencias.js';
import repositorioHandler from '../lib/routes/repositorio.js';
import meuTurnoHandler from '../lib/routes/meu-turno.js';
import importEscalaHandler from '../lib/routes/import-escala.js';
import uploadAtestadoHandler from '../lib/routes/upload-atestado.js';
import fixGestorHandler from '../lib/routes/fix-gestor.js';

const ROUTES = {
  'ausencias': ausenciasHandler,
  'repositorio': repositorioHandler,
  'meu-turno': meuTurnoHandler,
  'import-escala': importEscalaHandler,
  'upload-atestado': uploadAtestadoHandler,
  'fix-gestor': fixGestorHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
