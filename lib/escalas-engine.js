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
export function interjornada(saiAnterior, entradaAtual) {
  if (!saiAnterior || !entradaAtual) return null;
  const s = toMin(saiAnterior), e = toMin(entradaAtual);
  if (s === null || e === null) return null;
  // Se entrada > saída anterior no mesmo ciclo = turno virou meia-noite
  const diff = e >= s ? e - s : (24 * 60 - s) + e;
  return diff;
}

// Analisa todos os alertas de um colaborador em um dia
export function analisarDia(turnoAtual, turnoAnterior, turnoProximo, ausencia, diasConsecutivos) {
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

  // 1. Jornada acima de 10h
  if (durHoras > 10) {
    alertas.push({
      nivel: 'danger',
      codigo: 'JORNADA_LONGA',
      msg: `Jornada de ${durHoras.toFixed(1)}h (máx. 10h)`
    });
  }

  // 2. Descanso obrigatório (acima de 8h = 1h intervalo)
  if (durHoras > 8) {
    alertas.push({
      nivel: 'warning',
      codigo: 'DESCANSO',
      msg: `+8h trabalhadas — 1h de descanso obrigatória (jornada real: ${(durHoras - 1).toFixed(1)}h)`
    });
  }

  // 3. Interjornada com turno anterior
  if (turnoAnterior && turnoAnterior.saida && entrada) {
    const inter = interjornada(turnoAnterior.saida, entrada);
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
    const inter = interjornada(saida, turnoProximo.entrada);
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
      msg: `${diasConsecutivos}º dia consecutivo sem folga`
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
export function analisarEscala(escala, ausencias, nomes, datas) {
  const resultado = {};

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

      resultado[nome][df] = analisarDia(turnoObj, turnoAnt, turnoProx, aus, consec);
    });
  });

  return resultado;
}
