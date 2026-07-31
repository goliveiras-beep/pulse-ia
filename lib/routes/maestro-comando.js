// lib/routes/maestro-comando.js
// POST, exige sessao humana (getPulseSession) - enfileira um comando de controle
// (carregar_preset / trocar_entrada) como Pendente. NAO executa nada no equipamento
// direto - a nuvem nao alcanca a rede interna. o agente local (maestro-agent/) e quem
// busca comandos pendentes e executa o SNMP SET de fato.
import { getPulseSession } from '../maestro-session.js';
import { appendRowSafe } from '../maestro-sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.redirect(302, '/api/maestro-painel');

  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const { item, acao, parametro } = req.body || {};
  if (!item || !acao) return res.redirect(302, '/api/maestro-painel?erro=comando_invalido');
  if (acao !== 'carregar_preset' && acao !== 'trocar_entrada') {
    return res.redirect(302, '/api/maestro-painel?erro=comando_invalido');
  }

  const timestamp = new Date().toISOString();

  await appendRowSafe('Comandos', [
    timestamp,
    String(item).trim(),
    acao,
    String(parametro || '').trim(),
    'Pendente',
    session.nome,
    '',
    '',
  ]);

  return res.redirect(302, '/api/maestro-painel?comando=enfileirado');
}
