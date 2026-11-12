// lib/escalas-engine.js
// Motor de regras trabalhistas para análise da escala
// Linhas de Ausências recebidas aqui (parâmetro `ausencias`/`ausencia`) seguem sempre o layout de 6 colunas:
// 0=id/status (prefixo APROVADO-.../RECUSADO/CANCELADO, senão pendente), 1=nome, 2=tipo, 3=motivo, 4=início DD/MM, 5=fim DD/MM

export function toMin(h) {
  if (!h) return null;
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + (mm || 0);
}

// Duração do turno em minutos (lida com virada de meia-noite)
export function duracaoTurno(entrada, saida) {
  if (!entrada || !saida) return 0;
  const i = toMin(entrada), f = toMin(saida);
  if (f === null || i === null) return 0;
  return f >= i ? f - i : (24 * 60 - i) + f;
}

// Status da ausência a partir do prefixo/valor da coluna A (ID)
function statusAusencia(id) {
  if (!id) return 'pendente';
  if (id.startsWith('APROVADO')) return 'aprovado';
  if (id === 'RECUSADO') return 'recusado';
  if (id === 'CANCELADO') return 'cancelado';
  return 'pendente';
}

// Verifica se a data DD/MM está dentro do período [ini, fim] de uma ausência (inclusive)
function dentroPeriodo(ini, fim, df) {
  if (!ini) return false;
  const toNum = s => { const p = s.split('/'); return parseInt(p[1]) * 100 + parseInt(p[0]); };
  const n = toNum(df), i = toNum(ini), f = toNum(fim || ini);
  if (f >= i) return n >= i && n <= f;
  return n >= i || n <= f; // período vira o ano
}

// Interjornada entre fim de um turno e início do próximo (em minutos)
// O turno "atual" é sempre do dia seguinte ao anterior. Se o anterior virou a meia-noite
// (saída < entrada), a saída dele já cai no dia do turno atual: descanso = entradaAtual - saída.
// Senão, a saída foi no dia anterior: descanso = (24h - saída) + entradaAtual — inclusive
// quando as horas coincidem (ex.: sai 22:00 num dia, entra 22:00 no outro = 24h, não 0h).
export function interjornada(saiAnterior, entradaAtual, entradaAnterior) {
  if (!saiAnterior || !entradaAtual) return null;
  const s = toMin(saiAnterior), e = toMin(entradaAtual), ea = toMin(entradaAnterior);
  if (s === null || e === null) return null;
  const anteriorVirouMeiaNoite = ea !== null && s < ea;
  return anteriorVirouMeiaNoite ? e - s : (24 * 60 - s) + e;
}

// ── Regras do "Controle de jornada — Guia da liderança" (RH, 28/10/2026, go live 16/11/2026) ──
// • CLT: 8h/dia + no máx. 2h extras (vão pro banco, compensar em até 90 dias). Passou de 2h extras
//   = Hora Extra Irregular (HEI), não pode acontecer. 40h/semana, modelo 5x2 (2 folgas por semana).
// • Estágio e jovem aprendiz: 6h/dia e 30h/semana, ZERO hora extra.
// • Interjornada mínima de 11h pra todo mundo. Ninguém trabalha mais de 6 dias seguidos.
// • Tolerância: até 10 min no dia não contam (CLT art. 58).
// Temporário (LET 6x1) fica fora do guia: mantém jornada de 6h + até 2h e não entra na regra 5x2.
// Sem tipo de contrato cadastrado = tratado como CLT (a maior parte da equipe).
export const TOLERANCIA_MIN = 10;
export function categoriaContrato(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (/est[aá]gi|aprendiz/.test(t)) return 'estagio';
  if (t === 'temporário' || t === 'temporario') return 'temporario';
  return 'clt'; // CLT, PJ ou vazio
}
export function regrasContrato(tipo) {
  const cat = categoriaContrato(tipo);
  if (cat === 'estagio') return { cat, jornadaDia: 6, extraMaxDia: 0, jornadaSemana: 30, intervalo: false, regra5x2: true };
  if (cat === 'temporario') return { cat, jornadaDia: 6, extraMaxDia: 2, jornadaSemana: 36, intervalo: false, regra5x2: false };
  return { cat, jornadaDia: 8, extraMaxDia: 2, jornadaSemana: 40, intervalo: true, regra5x2: true };
}
// Horas efetivas a partir do turno da escala: CLT/PJ tem 1h de intervalo dentro do turno quando passa
// de 6h (ex.: 10h→19h = 8h trabalhadas). Estágio/aprendiz e temporário não marcam intervalo.
export function horasTrabalhadas(durMin, tipo) {
  const r = regrasContrato(tipo);
  return (r.intervalo && durMin > 6 * 60) ? durMin - 60 : durMin;
}
const fmtH = min => { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h}h${String(m).padStart(2,'0')}` : `${h}h`; };

// Analisa todos os alertas de um colaborador em um dia
export function analisarDia(turnoAtual, turnoAnterior, turnoProximo, ausencia, diasConsecutivos, tipoContrato = '') {
  const alertas = [];

  if (ausencia) {
    return { alertas: [], status: ausencia[2] || 'Ausência', motivo: ausencia[3] || '', tipo: 'ausencia' };
  }

  if (!turnoAtual) return { alertas: [], status: null, tipo: 'livre' };

  const { entrada, saida, obs } = turnoAtual;

  if (obs === 'Folga' || obs === 'Folga/Ausente') {
    return { alertas: [], status: 'Folga', tipo: 'folga' };
  }

  if (!entrada || !saida) return { alertas: [], status: null, tipo: 'livre' };

  const durMin = duracaoTurno(entrada, saida);
  const durHoras = durMin / 60;

  // 1/2. Jornada do dia por tipo de contrato (guia de controle de jornada)
  const regras = regrasContrato(tipoContrato);
  const trabMin = horasTrabalhadas(durMin, tipoContrato);
  const excedenteMin = trabMin - regras.jornadaDia * 60;
  if (excedenteMin > TOLERANCIA_MIN) {
    if (regras.cat === 'estagio') {
      alertas.push({
        nivel: 'danger',
        codigo: 'ESTAGIO_LIMITE',
        msg: `Estágio/aprendiz: ${fmtH(trabMin)} no dia (máx. 6h, sem hora extra)`
      });
    } else if (excedenteMin > regras.extraMaxDia * 60 + TOLERANCIA_MIN) {
      alertas.push({
        nivel: 'danger',
        codigo: 'HEI',
        msg: `Hora Extra Irregular: +${fmtH(excedenteMin)} extras (máx. ${regras.extraMaxDia}h/dia)`
      });
    } else {
      alertas.push({
        nivel: 'warning',
        codigo: 'HORA_EXTRA',
        msg: `+${fmtH(excedenteMin)} extra → banco de horas (compensar em até 90 dias)`
      });
    }
  }

  // 3. Interjornada com turno anterior
  if (turnoAnterior && turnoAnterior.saida && entrada) {
    const inter = interjornada(turnoAnterior.saida, entrada, turnoAnterior.entrada);
    if (inter !== null && inter < 11 * 60) {
      const horas = (inter / 60).toFixed(1);
      alertas.push({
        nivel: 'danger',
        codigo: 'INTERJORNADA',
        msg: `Interjornada de ${horas}h (mín. 11h)`
      });
    }
  }

  // 4. Interjornada com próximo turno
  if (turnoProximo && turnoProximo.entrada && saida) {
    const inter = interjornada(saida, turnoProximo.entrada, entrada);
    if (inter !== null && inter < 11 * 60) {
      const horas = (inter / 60).toFixed(1);
      alertas.push({
        nivel: 'danger',
        codigo: 'INTERJORNADA_PROXIMO',
        msg: `Interjornada curta com próximo dia: ${horas}h`
      });
    }
  }

  // 5. 7º dia consecutivo sem folga
  if (diasConsecutivos >= 7) {
    alertas.push({
      nivel: 'danger',
      codigo: 'CONSECUTIVOS',
      msg: `${diasConsecutivos}º dia seguido sem folga (máx. 6)`
    });
  } else if (diasConsecutivos >= 6) {
    alertas.push({
      nivel: 'warning',
      codigo: 'CONSECUTIVOS_AVISO',
      msg: `6 dias seguidos — folga necessária amanhã`
    });
  }

  return {
    alertas,
    status: `${entrada}→${saida}`,
    durMin,
    durHoras,
    trabMin,
    tipo: alertas.some(a => a.nivel === 'danger') ? 'perigo' :
          alertas.some(a => a.nivel === 'warning') ? 'atencao' : 'ok'
  };
}

// Calcula dias consecutivos até uma data para um colaborador
// escalaPorDia: Map df -> linha da escala (já filtrada pra essa pessoa)
// ausenciasPessoa: ausências aprovadas já filtradas pra essa pessoa
function calcularConsecutivos(escalaPorDia, ausenciasPessoa, dataRef) {
  let consecutivos = 0;
  const d = new Date(dataRef);

  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() - 1);
    const df = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    const turno = escalaPorDia.get(df);
    const aus = ausenciasPessoa.find(a => dentroPeriodo(a[4], a[5], df));
    if (aus || !turno || turno[5] === 'Folga' || turno[5] === 'Folga/Ausente' || (!turno[3] && !turno[4])) break;
    consecutivos++;
  }
  return consecutivos;
}

// Analisa a escala completa de um período e retorna mapa de alertas por pessoa/dia
// tiposPorNome (opcional): { nome: 'CLT' | 'PJ' | 'Temporário' | 'Estágio' | 'Jovem aprendiz' } — coluna M
// da aba Equipe. Sem ele, todo mundo é tratado como CLT (mesmo comportamento pra quem já chama sem o 5º arg).
export function analisarEscala(escala, ausencias, nomes, datas, tiposPorNome = {}) {
  const resultado = {};
  const anoRef = new Date().getFullYear();
  const dfDe = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  const dataDe = df => { const [d, m] = df.split('/').map(Number); return new Date(anoRef, m - 1, d); };
  // Datas (DD/MM) da semana seg→dom que contém df
  const semanaDe = df => {
    const dt = dataDe(df), dow = dt.getDay();
    dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(dt); x.setDate(dt.getDate() + i); return dfDe(x); });
  };

  nomes.forEach(nome => {
    resultado[nome] = {};

    // Índices por pessoa — evita varrer escala/ausências inteiras a cada dia (fica lento com listas grandes)
    const escalaPorDia = new Map();
    escala.forEach(r => { if (r[2] === nome) escalaPorDia.set(r[0], r); });
    const ausenciasPessoa = ausencias.filter(a => a[1] === nome && statusAusencia(a[0]) === 'aprovado');

    datas.forEach((df, idx) => {
      const turnoAtual = escalaPorDia.get(df);
      const turnoObj = turnoAtual ? { entrada: turnoAtual[3], saida: turnoAtual[4], obs: turnoAtual[5] } : null;

      // Turno anterior (dia anterior)
      const dfAnterior = datas[idx - 1] || null;
      const turnoAntRaw = dfAnterior ? escalaPorDia.get(dfAnterior) : null;
      const turnoAnt = turnoAntRaw ? { entrada: turnoAntRaw[3], saida: turnoAntRaw[4] } : null;

      // Turno próximo (dia seguinte)
      const dfProximo = datas[idx + 1] || null;
      const turnoProxRaw = dfProximo ? escalaPorDia.get(dfProximo) : null;
      const turnoProx = turnoProxRaw ? { entrada: turnoProxRaw[3], saida: turnoProxRaw[4] } : null;

      // Ausência (aprovada, cobrindo qualquer dia do período — não só início/fim)
      const aus = ausenciasPessoa.find(a => dentroPeriodo(a[4], a[5], df));

      // Dias consecutivos
      const [dia, mes] = df.split('/').map(Number);
      const dataObj = new Date(new Date().getFullYear(), mes - 1, dia);
      const consec = calcularConsecutivos(escalaPorDia, ausenciasPessoa, dataObj);

      resultado[nome][df] = analisarDia(turnoObj, turnoAnt, turnoProx, aus, consec, tiposPorNome[nome]);
    });

    // Regras semanais (seg→dom): 5x2 (no máx. 5 dias trabalhados) e teto de horas da semana.
    // Olha a semana inteira na escala, mesmo os dias fora do período exibido.
    const tipo = tiposPorNome[nome];
    const regras = regrasContrato(tipo);
    const trabalhouNoDia = d => {
      const t = escalaPorDia.get(d);
      if (!t || !t[3] || !t[4] || t[5] === 'Folga' || t[5] === 'Folga/Ausente') return 0;
      if (ausenciasPessoa.some(a => dentroPeriodo(a[4], a[5], d))) return 0;
      return horasTrabalhadas(duracaoTurno(t[3], t[4]), tipo);
    };
    datas.forEach(df => {
      const r = resultado[nome][df];
      if (!r || !r.trabMin) return;
      const semana = semanaDe(df);
      let dias = 0, minAntes = 0;
      for (const d of semana) { if (d === df) break; const m = trabalhouNoDia(d); if (m) { dias++; minAntes += m; } }
      const ordem = dias + 1;
      const limite = regras.jornadaSemana * 60 + TOLERANCIA_MIN;
      if (regras.regra5x2 && ordem > 5) {
        r.alertas.push({ nivel: 'danger', codigo: 'FOLGAS_5X2', msg: `${ordem}º dia trabalhado na semana — 5x2 exige 2 folgas` });
      }
      if (minAntes <= limite && minAntes + r.trabMin > limite) {
        const total = semana.reduce((acc, d) => acc + trabalhouNoDia(d), 0);
        r.alertas.push(regras.cat === 'estagio'
          ? { nivel: 'danger', codigo: 'SEMANA_LIMITE', msg: `Estágio/aprendiz: semana com ${fmtH(total)} (máx. 30h)` }
          : { nivel: 'warning', codigo: 'SEMANA_LIMITE', msg: `Semana com ${fmtH(total)} (jornada ${regras.jornadaSemana}h) — excedente vai pro banco` });
      }
      r.tipo = r.alertas.some(a => a.nivel === 'danger') ? 'perigo' : r.alertas.some(a => a.nivel === 'warning') ? 'atencao' : 'ok';
    });
  });

  return resultado;
}
