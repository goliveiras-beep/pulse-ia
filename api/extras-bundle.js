// api/extras-bundle.js — agrupa rotas diversas (ausencias, repositorio, meu-turno, import-escala,
// upload-atestado, fix-gestor, compasso) em uma única Serverless Function, para caber no limite
// de 12 functions do plano Hobby da Vercel. URLs públicas inalteradas (rewrite no vercel.json).
// maxDuration 60 porque import-escala precisa desse tempo.
export const config = { maxDuration: 60 };

import ausenciasHandler from '../lib/routes/ausencias.js';
import repositorioHandler from '../lib/routes/repositorio.js';
import meuTurnoHandler from '../lib/routes/meu-turno.js';
import importEscalaHandler from '../lib/routes/import-escala.js';
import uploadAtestadoHandler from '../lib/routes/upload-atestado.js';
import fixGestorHandler from '../lib/routes/fix-gestor.js';
import compassoHandler from '../lib/routes/compasso.js';
import registrosTecnicosHandler from '../lib/routes/registros-tecnicos.js';
import antenasHandler from '../lib/routes/antenas.js';
import compassoCronAgendaHandler from '../lib/routes/compasso-cron-agenda.js';
import mapaHandler from '../lib/routes/mapa.js';
import alexaHandler from '../lib/routes/alexa.js';
import avisarCentralHandler from '../lib/routes/avisar-central.js';
import pushHandler from '../lib/routes/push.js';

const ROUTES = {
  'ausencias': ausenciasHandler,
  'repositorio': repositorioHandler,
  'meu-turno': meuTurnoHandler,
  'import-escala': importEscalaHandler,
  'upload-atestado': uploadAtestadoHandler,
  'fix-gestor': fixGestorHandler,
  'compasso': compassoHandler,
  'registros-tecnicos': registrosTecnicosHandler,
  'antenas': antenasHandler,
  'compasso-cron-agenda': compassoCronAgendaHandler,
  'mapa': mapaHandler,
  'alexa': alexaHandler,
  'avisar-central': avisarCentralHandler,
  'push': pushHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
