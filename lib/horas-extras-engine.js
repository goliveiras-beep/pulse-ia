// lib/horas-extras-engine.js — regras de banco de horas / hora extra por tipo de contrato
// Extraído de lib/routes/banco-horas.js (2026-07-31) para ser reutilizado também por
// api/gerar-escala.js, evitando duas cópias da mesma regra trabalhista divergindo com o tempo.

export function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }

export function duracaoHoras(ent, sai) {
  const e = toMin(ent), s = toMin(sai);
  if (e===null||s===null) return 0;
  const dur = s > e ? s - e : (1440 - e) + s; // turno virando a noite
  return dur / 60;
}

// ── Regras por tipo de contrato ──────────────────────────────────────────
// Temporário (LET) — jornada 6x1, 6h/dia. Dia normal: até 2h extras vão pro banco, depois disso é
// hora extra 50%. CLT e PJ — jornada padrão 8h/dia (turno de 9h com 1h de intervalo). Dia normal: até
// 2h excedentes por dia vão para o banco de horas (limite do art. 59 da CLT); acima disso é hora extra
// 100% — regra provisória, ajustar o limite de LIMITE_BANCO_CLT_PJ abaixo se o acordo real da empresa
// usar outro valor.
// Domingo, feriado (nacional) ou 7º dia consecutivo sem folga: pra QUALQUER tipo de contrato, não tem
// banco de horas nesse dia — o excedente inteiro vira hora extra 100% (é dia de descanso obrigatório
// sendo trabalhado, não dá pra compensar com banco).
// Live Mode e PJ também têm um teto SEMANAL de 40h (contrato) — além da regra diária acima (que já
// cobre jornadas longas em UM dia), se a soma da semana passar de 40h em dias "normais" (sem ser
// domingo/feriado/7º dia, que já são 100% à parte), o que sobrar da conta diária vira hora extra 100%
// também. Isso cobre o caso de várias jornadas curtas (ex: 6 dias de 7h = 42h/semana) que a regra
// diária isolada não pega, porque nenhum dia individualmente passa de 8h.
export const LIMITE_BANCO_CLT_PJ = 2;
export const JORNADA_SEMANAL_CLT_PJ = 40;
export function jornadaContratada(tipo) { return tipo === 'Temporário' ? 6 : 8; }

// Segunda-feira da semana (seg-dom) que contém a data — usado só pra agrupar dias na conta do teto
// semanal de 40h.
export function segundaDaSemana(d) {
  const dt = new Date(d);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
  return dt;
}

// Recebe os cálculos diários (já com banco/extra100 da regra diária) de um período e devolve quanto
// precisa ser promovido a extra 100% pra respeitar o teto de 40h/semana — só olha dias "normais"
// (semBanco=false), já que domingo/feriado/7º dia já são 100% integral por conta própria.
export function topUpSemanal40h(diaCalcs) {
  const porSemana = new Map();
  diaCalcs.forEach(d => {
    if (d.semBanco) return;
    const chave = segundaDaSemana(d.data).getTime();
    const acc = porSemana.get(chave) || { horas: 0, banco: 0 };
    acc.horas += d.trabalhadas;
    acc.banco += d.banco;
    porSemana.set(chave, acc);
  });
  let topUp = 0;
  porSemana.forEach(acc => {
    const excedenteSemanal = Math.max(0, acc.horas - JORNADA_SEMANAL_CLT_PJ);
    topUp += Math.max(0, excedenteSemanal - acc.banco);
  });
  return topUp;
}

export function horasEfetivas(durBruta, tipo) {
  if (tipo === 'Temporário') return durBruta; // turno de 6h, sem intervalo
  return durBruta > 6 ? durBruta - 1 : durBruta; // CLT/PJ com 1h de intervalo em turnos maiores
}

export function calcularDia(durBruta, tipo, semBanco) {
  const trabalhadas = horasEfetivas(durBruta, tipo);
  const excedente = Math.max(0, trabalhadas - jornadaContratada(tipo));
  let banco = 0, extra50 = 0, extra100 = 0;
  if (semBanco) {
    extra100 = excedente; // domingo, feriado ou 7º dia consecutivo — sem banco, tudo 100%
  } else if (tipo === 'Temporário') {
    banco = Math.min(excedente, 2); extra50 = Math.max(0, excedente - 2);
  } else {
    banco = Math.min(excedente, LIMITE_BANCO_CLT_PJ);
    extra100 = Math.max(0, excedente - LIMITE_BANCO_CLT_PJ);
  }
  return { trabalhadas, excedente, banco, extra50, extra100 };
}

// Calendário de feriados nacionais (fixos + móveis via cálculo da Páscoa, algoritmo de
// Meeus/Jones/Butcher). Não inclui feriados estaduais/municipais — ajustar aqui se a Livemode
// precisar considerar algum. Memoizado por ano.
const _feriadosCache = new Map();
export function calcularPascoa(ano) {
  const a = ano % 19, b = Math.floor(ano/100), c = ano % 100;
  const d = Math.floor(b/4), e = b%4;
  const f = Math.floor((b+8)/25), g = Math.floor((b-f+1)/3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c/4), k = c%4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l)/451);
  const mes = Math.floor((h + l - 7*m + 114)/31);
  const dia = ((h + l - 7*m + 114) % 31) + 1;
  return new Date(ano, mes-1, dia);
}
export function feriadosDoAno(ano) {
  if (_feriadosCache.has(ano)) return _feriadosCache.get(ano);
  const pascoa = calcularPascoa(ano);
  const addDias = (data, n) => { const d = new Date(data); d.setDate(d.getDate()+n); return d; };
  const dfmt = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  const set = new Set([
    '01/01', '21/04', '01/05', '07/09', '12/10', '02/11', '15/11', '20/11', '25/12',
    dfmt(addDias(pascoa, -48)), dfmt(addDias(pascoa, -47)), // Carnaval (seg/ter)
    dfmt(addDias(pascoa, -2)),  // Sexta-feira Santa
    dfmt(addDias(pascoa, 60)),  // Corpus Christi
  ]);
  _feriadosCache.set(ano, set);
  return set;
}

// Adicional noturno — 20% sobre as horas efetivamente trabalhadas entre 22h e 5h (regra geral CLT
// art. 73, sem considerar aqui a "hora noturna reduzida" de 52min30s — ajustar se a Livemode aplicar
// a redução). Conta minuto a minuto pra lidar corretamente com turnos que viram a madrugada; devolve
// as horas BRUTAS no período noturno — quem chama aplica o fator de 20% (ver uso em banco-horas.js).
export function horasNoturnas(ent, sai) {
  const e = toMin(ent), s = toMin(sai);
  if (e === null || s === null) return 0;
  const fimAbs = s > e ? s : s + 1440;
  let minutos = 0;
  for (let m = e; m < fimAbs; m++) {
    const hora = m % 1440;
    if (hora >= 22*60 || hora < 5*60) minutos++;
  }
  return minutos / 60;
}
