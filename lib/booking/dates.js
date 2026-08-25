// lib/booking/dates.js
// Instante UTC canonico e derivacao do dia do jogo em BRT, pro modulo de Booking
// (ver Especificacao - Modulo de Parametros de Sinal e Prazos de Booking, secao 3).
//
// So aceita o subconjunto de ISO-8601 que a spec do ECMAScript OBRIGA Date.parse a
// suportar (separador "T", fuso "Z" ou "+-HH:MM") - separador por espaco e offset
// sem dois-pontos sao implementation-defined (V8 aceita, outros motores nao), e
// aceitar isso reintroduziria a dependencia de ambiente que esta regra existe pra
// eliminar (Armadilha 1 da spec).
const STRICT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function canonicalIso(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!STRICT_ISO.test(s)) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Dia do jogo no fuso de Sao Paulo (UTC-3 fixo, sem horario de verao desde 2019).
export function toMatchDateBrt(utcIso) {
  const canon = canonicalIso(utcIso);
  if (!canon) return null;
  return new Date(Date.parse(canon) - 3 * 3600_000).toISOString().slice(0, 10);
}

// Regra de fallback de ancora, valida em todo o sistema (extracao e prazos):
// kickoff -> cai pra transmissionStart; transmissionStart -> cai pra kickoff.
// Se os dois forem nulos, nao ha data - nunca inventar (marco fica "no_date").
export function resolverAncora(tipo, event) {
  const kick = canonicalIso(event.kickoffUtc);
  const inicio = canonicalIso(event.transmissionStartUtc);
  if (tipo === 'kickoff') return kick ?? inicio ?? null;
  if (tipo === 'transmissionStart') return inicio ?? kick ?? null;
  throw new Error(`tipo de ancora desconhecido: ${tipo}`);
}

export function matchDateBrtDoEvento(event) {
  return toMatchDateBrt(resolverAncora('kickoff', event));
}
