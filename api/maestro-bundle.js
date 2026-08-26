// api/maestro-bundle.js
// bundle dedicado do MAESTRO - unica function fisica pras rotas do MAESTRO, isolada
// das rotas do Pulse (nenhum arquivo aqui e compartilhado com outro bundle), pra
// mexer no MAESTRO sem risco de derrubar o resto do portal. despacha por
// ?_route=, igual aos outros bundles (auth-bundle.js, gestao-bundle.js etc).
// 60 (teto do plano Hobby da Vercel) em vez de 30 - a extracao de Booking (maestro-booking.js)
// chama o Gemini e variou de 5s a 28s nos testes, perto demais do limite antigo.
export const config = { maxDuration: 60 };
import painelHandler from '../lib/routes/maestro-painel.js';
import telemetriaHandler from '../lib/routes/maestro-telemetria.js';
import ingestHandler from '../lib/routes/maestro-ingest.js';
import comandoHandler from '../lib/routes/maestro-comando.js';
import comandosPendentesHandler from '../lib/routes/maestro-comandos-pendentes.js';
import comandoResultadoHandler from '../lib/routes/maestro-comando-resultado.js';
import detalheHandler from '../lib/routes/maestro-detalhe.js';
import detalheIngestHandler from '../lib/routes/maestro-detalhe-ingest.js';
import bookingHandler from '../lib/routes/maestro-booking.js';
import bookingChecagemHandler from '../lib/routes/maestro-booking-checagem.js';
import bookingConfigHandler from '../lib/routes/maestro-booking-config.js';

const ROUTES = {
  painel: painelHandler,
  telemetria: telemetriaHandler,
  ingest: ingestHandler,
  comando: comandoHandler,
  'comandos-pendentes': comandosPendentesHandler,
  'comando-resultado': comandoResultadoHandler,
  detalhe: detalheHandler,
  'detalhe-ingest': detalheIngestHandler,
  booking: bookingHandler,
  'booking-checagem': bookingChecagemHandler,
  'booking-config': bookingConfigHandler,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query._route];
  if (!fn) return res.status(404).json({ error: 'Rota não encontrada' });
  return fn(req, res);
}
