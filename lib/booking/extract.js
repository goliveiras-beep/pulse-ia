// lib/booking/extract.js
// Chamada ao modelo (Groq, nao Anthropic - decisao explicita: reaproveitar o
// GROQ_API_KEY que o Pulse ja usa, em vez de exigir uma chave nova da Anthropic).
// Fluxo (spec 4.1): texto -> Groq com saida estruturada -> validacao Zod + campos
// derivados + avisos -> resultado pronto pra fila de revisao.
import { ToolInput, ExtractionResult } from './schema.js';
import { EXTRACTION_SYSTEM, mensagemUsuario } from './prompt.js';
import { matchDateBrtDoEvento } from './dates.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// O tier "on_demand" da Groq da 8.000 tokens/min pro projeto INTEIRO (compartilhado com
// chat.js/app.js/gerar-escala.js, nao so a extracao). A API conta prompt + max_tokens
// pedido contra essa cota, nao so o que o modelo de fato gera - entao cada tentativa aqui
// "reserva" ~2.450 (prompt fixo) + max_tokens, mesmo que a resposta real seja bem menor.
// Por isso: max_tokens baixo, poucas tentativas, e a tentativa de autocorrecao NAO reenvia
// a resposta anterior inteira do modelo (so o resumo do erro) - senao o prompt cresce a
// cada volta e a segunda tentativa sozinha já passa da cota.
const MAX_TOKENS_RESPOSTA = 1800;
const MAX_TENTATIVAS = 2; // 1 chamada + 1 autocorrecao - uma 3a tentativa quase sempre estoura a cota de 1 minuto

class GroqRateLimitError extends Error {}

function extrairJson(texto) {
  const limpo = String(texto).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(limpo);
}

async function chamarGroq(messages) {
  const model = process.env.EXTRACTION_MODEL || 'openai/gpt-oss-20b';
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0, // extracao precisa ser deterministica (spec 4.3)
      max_tokens: MAX_TOKENS_RESPOSTA,
      messages,
    }),
  });
  if (r.status === 429) {
    const corpo = await r.text().catch(() => '');
    throw new GroqRateLimitError(`Cota de tokens/minuto da Groq esgotada. Espere ~1 minuto e tente de novo. (${corpo.slice(0, 300)})`);
  }
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    throw new Error(`Groq respondeu ${r.status}: ${corpo.slice(0, 500)}`);
  }
  const data = await r.json();
  const conteudo = data.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('Groq nao devolveu conteudo na resposta.');
  return conteudo;
}

/**
 * Extrai um SignalEvent de um texto de documento ja limpo (ver extract-text.js).
 * Autocorrecao: se a validacao Zod falhar, devolve so o RESUMO dos erros ao modelo
 * (nao a resposta anterior inteira - ver nota de cota acima) e pede nova tentativa.
 */
export async function extrairDocumento(texto, { nomeArquivo } = {}) {
  const mensagemBase = [
    { role: 'system', content: EXTRACTION_SYSTEM },
    { role: 'user', content: mensagemUsuario(texto, nomeArquivo) },
  ];
  let mensagemErroAnterior = null;

  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const messages = mensagemErroAnterior
      ? [...mensagemBase, { role: 'user', content: mensagemErroAnterior }]
      : mensagemBase;

    let bruto;
    try {
      bruto = await chamarGroq(messages);
    } catch (e) {
      if (e instanceof GroqRateLimitError) throw e; // sem retry - so pioraria a mesma cota
      ultimoErro = e;
      continue;
    }

    let json;
    try {
      json = extrairJson(bruto);
    } catch (e) {
      ultimoErro = e;
      mensagemErroAnterior = `Sua resposta não é um JSON válido (${e.message}). Responda de novo, só com o JSON, sem texto ao redor.`;
      continue;
    }

    const validado = ToolInput.safeParse(json);
    if (validado.success) {
      return finalizarExtracao(validado.data, { nomeArquivo, rawText: texto });
    }

    ultimoErro = validado.error;
    mensagemErroAnterior = `A extração anterior teve erros de validação, corrija e responda de novo só com o JSON:\n` +
      validado.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
  }

  throw new Error(`Extração falhou após ${MAX_TENTATIVAS} tentativas: ${ultimoErro?.message || ultimoErro}`);
}

// Campos derivados em codigo (nunca pelo modelo) + verificacoes da secao 4.5.
function finalizarExtracao({ event, confidence, warnings }, { nomeArquivo, rawText }) {
  const eventoCompleto = {
    ...event,
    rawText,
    sourceFileName: nomeArquivo ?? null,
    matchDateBrt: matchDateBrtDoEvento(event),
  };

  const avisosCodigo = verificacoesPosExtracao(eventoCompleto);

  const resultado = ExtractionResult.parse({
    event: eventoCompleto,
    confidence,
    warnings: [...warnings, ...avisosCodigo],
  });
  return resultado;
}

// spec 4.5 - tudo que pode ser calculado deve ser calculado, nao extraido.
function verificacoesPosExtracao(event) {
  const avisos = [];

  if (event.transmissionStartUtc && event.transmissionEndUtc) {
    if (Date.parse(event.transmissionEndUtc) <= Date.parse(event.transmissionStartUtc)) {
      avisos.push('Fim não é posterior ao início.');
    }
  }

  if (event.transmissionStartUtc && event.matchDateBrt) {
    const diaUtc = event.transmissionStartUtc.slice(0, 10);
    if (diaUtc !== event.matchDateBrt) {
      avisos.push(`A janela começa em ${diaUtc} UTC mas o jogo é ${event.matchDateBrt} em Brasília.`);
    }
  }

  for (const [i, caminho] of event.signalPaths.entries()) {
    if (caminho.medium === 'satellite' && !caminho.satellite?.downlinkFreqMhz) {
      avisos.push(`Caminho ${i}: satélite sem frequência de downlink.`);
    }
    if ((caminho.medium === 'srt' || caminho.medium === 'udp') && !caminho.ip?.url && !caminho.ip?.port) {
      avisos.push(`Caminho ${i}: caminho IP sem URL nem porta.`);
    }
    if (caminho.encryption?.type === 'desconhecido') {
      avisos.push(`Caminho ${i}: criptografia indefinida, confirme com o fornecedor.`);
    }
  }

  if (event.signalPaths.length === 0) avisos.push('Nenhum caminho identificado, revise à mão.');
  if (!event.transmissionStartUtc && !event.kickoffUtc) avisos.push('Nenhum prazo será calculado, preencha à mão.');

  return avisos;
}
