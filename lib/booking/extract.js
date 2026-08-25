// lib/booking/extract.js
// Chamada ao modelo (Gemini, nao Groq/Anthropic - trocado depois do tier gratuito da Groq
// se mostrar insuficiente: so 8.000 tokens/min pro projeto INTEIRO, compartilhado com
// chat.js/app.js/gerar-escala.js, insuficiente ate pra 1 extracao com 1 autocorrecao. O
// tier gratuito do Gemini (gemini-2.5-flash) da 1.000.000 tokens/min - folga bem maior).
// Fluxo (spec 4.1): texto -> Gemini -> validacao Zod + campos derivados + avisos ->
// resultado pronto pra fila de revisao.
import { ToolInput, ExtractionResult } from './schema.js';
import { EXTRACTION_SYSTEM, mensagemUsuario } from './prompt.js';
import { matchDateBrtDoEvento } from './dates.js';

const MAX_TOKENS_RESPOSTA = 4000;
const MAX_TENTATIVAS = 3; // 1 chamada + 2 autocorrecoes (spec 4.3) - sem aperto de cota como na Groq

class GeminiRateLimitError extends Error {}

function extrairJson(texto) {
  const limpo = String(texto).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(limpo);
}

async function chamarGemini(mensagens) {
  const model = process.env.EXTRACTION_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM }] },
      contents: mensagens.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: 0, // extracao precisa ser deterministica (spec 4.3)
        maxOutputTokens: MAX_TOKENS_RESPOSTA,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 512 },
      },
    }),
  });
  if (r.status === 429) {
    const corpo = await r.text().catch(() => '');
    throw new GeminiRateLimitError(`Cota da API do Gemini esgotada. Espere um pouco e tente de novo. (${corpo.slice(0, 300)})`);
  }
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    throw new Error(`Gemini respondeu ${r.status}: ${corpo.slice(0, 500)}`);
  }
  const data = await r.json();
  const conteudo = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
  if (!conteudo) {
    const motivo = data.candidates?.[0]?.finishReason;
    throw new Error(`Gemini nao devolveu conteudo na resposta${motivo ? ` (finishReason: ${motivo})` : ''}.`);
  }
  return conteudo;
}

/**
 * Extrai um SignalEvent de um texto de documento ja limpo (ver extract-text.js).
 * Autocorrecao: se a validacao Zod falhar, devolve os erros ao modelo e pede
 * nova tentativa (max 2), mais barato que descartar e recomecar (spec 4.3).
 */
export async function extrairDocumento(texto, { nomeArquivo } = {}) {
  const messages = [
    { role: 'user', content: mensagemUsuario(texto, nomeArquivo) },
  ];

  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    let bruto;
    try {
      bruto = await chamarGemini(messages);
    } catch (e) {
      if (e instanceof GeminiRateLimitError) throw e; // sem retry - so pioraria a mesma cota
      ultimoErro = e;
      continue;
    }

    let json;
    try {
      json = extrairJson(bruto);
    } catch (e) {
      ultimoErro = e;
      messages.push({ role: 'assistant', content: bruto });
      messages.push({ role: 'user', content: `Sua resposta não é um JSON válido (${e.message}). Responda de novo, só com o JSON, sem texto ao redor.` });
      continue;
    }

    const validado = ToolInput.safeParse(json);
    if (validado.success) {
      return finalizarExtracao(validado.data, { nomeArquivo, rawText: texto });
    }

    ultimoErro = validado.error;
    messages.push({ role: 'assistant', content: bruto });
    messages.push({
      role: 'user',
      content: `A extração tem erros de validação, corrija e responda de novo só com o JSON:\n` +
        validado.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n'),
    });
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
