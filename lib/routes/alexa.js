// lib/routes/alexa.js — skill privada da Alexa ("central pulse"): responde por voz com dados do Pulse.
// Rota: POST /api/alexa?k=<ALEXA_KEY>  (via extras-bundle, rewrite em vercel.json)
//
// Segurança (a rota é pública na internet, então fica FECHADA por padrão):
//   - ALEXA_KEY (segredo do Cloudflare) tem que ser igual ao parâmetro ?k= da URL cadastrada na skill. Sem ela configurada, recusa tudo (503).
//   - ALEXA_SKILL_ID (opcional até a skill existir): se configurado, só aceita pedidos dessa skill.
//   - o horário do pedido tem que estar a menos de 150 s de agora (regra da Amazon contra repetição).
//   - A assinatura digital da Amazon ainda NÃO é validada; pra uma skill privada de uso pessoal as três travas acima bastam,
//     mas se a skill for publicada/certificada isso precisa ser acrescentado.
// Os dados vêm do mesmo lugar do mapa 3D (montarDados em mapa.js): plantão, eventos no ar, chamados.
export const config = { maxDuration: 30 };
import { timingSafeEqual } from 'crypto';
import { SALAS, montarDados } from './mapa.js';

const nomeSala = id => (SALAS.find(s => s.id === id) || {}).nome || '';
const primeiro = n => String(n || '').trim().split(' ')[0];
const falaLista = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1];
// texto puro pra voz: sem emoji nem símbolos que a Alexa leria em voz alta
const limpa = t => String(t || '').replace(/[^\p{L}\p{N}\s.,:;!?()+\-/#]/gu, ' ').replace(/\s+/g, ' ').trim();
const horaFalada = hhmm => { const [h, m] = String(hhmm || '').split(':').map(Number); if (isNaN(h)) return ''; return h + (h === 1 ? ' hora' : ' horas') + (m ? ' e ' + m : ''); };
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

// ── o que a Alexa fala (funções puras: recebem os dados do mapa e devolvem texto) ──
export function falaPlantao(d) {
  const n = d.pessoas.length;
  if (!n) return 'Não há ninguém de plantão agora.';
  const central = d.pessoas.filter(p => p.sala === 'central').map(p => primeiro(p.nome));
  const porSala = {};
  d.pessoas.filter(p => p.sala !== 'central').forEach(p => { porSala[p.sala] = (porSala[p.sala] || 0) + 1; });
  const salas = Object.entries(porSala).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, q]) => nomeSala(id) + ', ' + plural(q, 'pessoa', 'pessoas'));
  let t = 'Agora há ' + plural(n, 'pessoa', 'pessoas') + ' de plantão.';
  if (central.length) t += ' Na central: ' + falaLista(central.slice(0, 8)) + '.';
  if (salas.length) t += ' Nas outras salas: ' + falaLista(salas) + '.';
  return t;
}
export function falaNoAr(d) {
  const ev = d.eventos.filter(e => e.noAr);
  if (!ev.length) return 'Não há nada no ar agora.';
  const itens = ev.slice(0, 3).map(e => limpa(e.nome) + (e.sala ? ', no ' + nomeSala(e.sala) : '') + (e.fim ? ', até ' + horaFalada(e.fim) : ''));
  return 'No ar agora: ' + falaLista(itens) + '.' + (ev.length > 3 ? ' E mais ' + (ev.length - 3) + '.' : '');
}
export function falaProximo(d) {
  const prox = d.eventos.find(e => !e.noAr && e.inicio > d.agora);
  if (!prox) return 'Não há mais eventos hoje.';
  return 'O próximo evento é ' + limpa(prox.nome) + ', às ' + horaFalada(prox.inicio) + (prox.sala ? ', no ' + nomeSala(prox.sala) : '') + '.';
}
export function falaChamados(d) {
  const n = d.chamados.length;
  if (!n) return 'Não há chamados abertos.';
  const urgentes = d.chamados.filter(c => /urgente|alta/i.test(c.prioridade || ''));
  let t = 'Há ' + plural(n, 'chamado aberto', 'chamados abertos') + '.';
  if (urgentes.length) {
    const u = urgentes[0];
    t += ' ' + plural(urgentes.length, 'é urgente', 'são urgentes') + ': ' + limpa(u.equipamento) + (u.problema ? ', ' + limpa(u.problema) : '') + (u.sala ? ', no ' + nomeSala(u.sala) : '') + '.';
  }
  return t;
}
export function falaResumo(d) {
  const noAr = d.eventos.filter(e => e.noAr).length;
  return 'São ' + horaFalada(d.agora) + '. ' + plural(d.pessoas.length, 'pessoa de plantão', 'pessoas de plantão') + ', ' +
    (noAr ? plural(noAr, 'evento no ar', 'eventos no ar') : 'nada no ar') + ', e ' +
    (d.chamados.length ? plural(d.chamados.length, 'chamado aberto', 'chamados abertos') : 'nenhum chamado aberto') + '. ' + falaProximo(d);
}
const BOAS_VINDAS = 'Central Pulse. Pergunte quem está de plantão, o que está no ar, o próximo evento, os chamados, ou peça um resumo.';
const AJUDA = 'Você pode perguntar: quem está de plantão, o que está no ar, qual o próximo evento, tem chamado aberto, ou me dar um resumo.';

const INTENTS = { PlantaoIntent: falaPlantao, NoArIntent: falaNoAr, ProximoEventoIntent: falaProximo, ChamadosIntent: falaChamados, ResumoIntent: falaResumo };

// ── resposta no formato da Alexa ──
const resposta = (texto, fim = true, reprompt = '') => ({
  version: '1.0',
  response: {
    outputSpeech: { type: 'PlainText', text: texto },
    ...(reprompt ? { reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } } } : {}),
    shouldEndSession: fim,
  },
});

function chaveConfere(recebida, esperada) {
  const a = Buffer.from(String(recebida || '')), b = Buffer.from(String(esperada || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const chave = process.env.ALEXA_KEY;
  if (!chave) return res.status(503).json({ error: 'Alexa não configurada' });
  if (!chaveConfere(req.query.k, chave)) return res.status(401).json({ error: 'Não autorizado' });

  const corpo = req.body || {};
  const appId = (corpo.session && corpo.session.application && corpo.session.application.applicationId)
    || (corpo.context && corpo.context.System && corpo.context.System.application && corpo.context.System.application.applicationId);
  if (process.env.ALEXA_SKILL_ID && appId !== process.env.ALEXA_SKILL_ID) return res.status(403).json({ error: 'Skill não autorizada' });
  const quando = Date.parse(corpo.request && corpo.request.timestamp);
  if (!quando || Math.abs(Date.now() - quando) > 150000) return res.status(400).json({ error: 'Pedido fora do prazo' });

  const tipo = corpo.request && corpo.request.type;
  if (tipo === 'LaunchRequest') return res.status(200).json(resposta(BOAS_VINDAS, false, AJUDA));
  if (tipo === 'SessionEndedRequest') return res.status(200).json({ version: '1.0', response: {} });
  if (tipo !== 'IntentRequest') return res.status(200).json(resposta('Não entendi esse pedido.'));

  const nome = corpo.request.intent && corpo.request.intent.name;
  if (nome === 'AMAZON.HelpIntent') return res.status(200).json(resposta(AJUDA, false, AJUDA));
  if (nome === 'AMAZON.StopIntent' || nome === 'AMAZON.CancelIntent') return res.status(200).json(resposta('Até logo.'));
  const fala = INTENTS[nome];
  if (!fala) return res.status(200).json(resposta('Não entendi. ' + AJUDA, false, AJUDA));
  try {
    return res.status(200).json(resposta(fala(await montarDados())));
  } catch (e) {
    console.error('alexa: falha ao montar os dados', e && e.message);
    return res.status(200).json(resposta('Não consegui consultar o Pulse agora. Tente de novo em instantes.'));
  }
}
