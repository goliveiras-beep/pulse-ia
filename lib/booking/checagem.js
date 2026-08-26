// lib/booking/checagem.js
// Checagem operacional de Booking (ver checar_booking_manha_e_noite.md, adaptado
// pra tabela real do Airtable descoberta nesta sessao). SO alerta - nunca grava
// nada, porque a tabela Booking e sincronizada da Matriz LiveMode [Geral] e ainda
// nao confirmamos se UPDATE funciona nela.
//
// A parte de Gmail (cruzar com e-mail recebido) ainda NAO esta integrada - falta
// decidir qual caixa ler (ver plano unificado). Por enquanto o alerta cobre so o
// lado Airtable: evento com meio de recepcao declarado (Origem do Sinal) mas sem
// os parametros tecnicos daquele meio preenchidos.
const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblJZ3r5lAapjcCll';

// eventos que nao sao transmissao ao vivo de fato (gravacao, entrevista gravada,
// reprise) - "separar reprises/gravacoes/conteudo nao ao vivo" (regra do doc original).
const PADRAO_NAO_AO_VIVO = /^(grava[cç][aã]o|reprise)\b/i;

function temAlgum(fields, nomesCampo) {
  return nomesCampo.some((nome) => {
    const v = fields[nome];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
}

// meio (valor de "Origem do Sinal") -> campos que provam que o parametro foi preenchido
const CAMPOS_POR_MEIO = {
  'Satélite': ['Satélite', 'Transponder', 'Downlink', 'Uplink'],
  SRT: ['SRT Main', 'SRT Backup'],
  Fibra: ['Fibra', 'Bandwidth', 'Origem do Sinal (fibra)'],
  LiveU: ['Mochila LiveU'],
};

function janelaBrt(modo) {
  const agora = new Date();
  if (modo === 'noite') {
    // checagem das 23h deve olhar o dia seguinte inteiro, em BRT (UTC-3)
    const hojeBrt = new Date(agora.getTime() - 3 * 3600_000);
    const inicioAmanha = new Date(Date.UTC(hojeBrt.getUTCFullYear(), hojeBrt.getUTCMonth(), hojeBrt.getUTCDate() + 1, 3, 0, 0)); // 00:00 BRT amanha, em UTC
    const fimAmanha = new Date(inicioAmanha.getTime() + 24 * 3600_000);
    return { inicio: inicioAmanha, fim: fimAmanha };
  }
  // manha: proximas 24h a partir de agora
  return { inicio: agora, fim: new Date(agora.getTime() + 24 * 3600_000) };
}

async function buscarEventosNaJanela({ inicio, fim }) {
  const filtro = `AND({Status}!='Cancelado', IS_AFTER({Início do Evento BRT}, '${new Date(inicio.getTime() - 60_000).toISOString()}'), IS_BEFORE({Início do Evento BRT}, '${fim.toISOString()}'))`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=100&sort[0][field]=Início do Evento BRT&sort[0][direction]=asc`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY}` } });
  if (!r.ok) throw new Error(`Airtable respondeu ${r.status}: ${await r.text().catch(() => '')}`);
  const d = await r.json();
  return d.records || [];
}

function avaliarEvento(record) {
  const f = record.fields;
  const nome = f['Match ID'] || '(sem nome)';
  if (PADRAO_NAO_AO_VIVO.test(nome)) return null; // gravação/reprise - fora do escopo de booking de sinal

  const meios = f['Origem do Sinal'] || [];
  const pendencias = [];
  for (const meio of meios) {
    const campos = CAMPOS_POR_MEIO[meio];
    if (!campos) continue; // meio sem checagem definida ainda (ex.: TVU, SAT 4K, RTMP)
    if (!temAlgum(f, campos)) {
      pendencias.push({ meio, mensagem: `Nenhum parâmetro técnico preenchido (${campos.join(', ')}).` });
    }
  }

  if (!meios.length) {
    pendencias.push({ meio: null, mensagem: 'Nenhum meio de recepção definido ainda (campo "Origem do Sinal" vazio).' });
  }

  if (!pendencias.length) {
    return { nome, competicao: f['aux. Competição tarefa'] || null, inicioBrt: f['Início do Evento BRT'] || null, meios, prioridade: 'OK', pendencias: [] };
  }

  const horasParaEvento = (Date.parse(f['Início do Evento BRT']) - Date.now()) / 3_600_000;
  const prioridade = horasParaEvento <= 24 ? 'ALTA PRIORIDADE' : 'PENDÊNCIA DE TESTE';

  return {
    nome,
    competicao: f['aux. Competição tarefa'] || null,
    inicioBrt: f['Início do Evento BRT'] || null,
    status: f['Status'] || null,
    contato: f['Contato'] || null,
    meios,
    prioridade,
    pendencias,
  };
}

/**
 * Checagem operacional (só Airtable por enquanto - Gmail ainda não integrado).
 * modo: 'manha' (próximas 24h) | 'noite' (dia seguinte inteiro, BRT).
 */
export async function checarPendenciasBooking(modo = 'manha') {
  const janela = janelaBrt(modo);
  const registros = await buscarEventosNaJanela(janela);

  const avaliados = registros.map(avaliarEvento).filter(Boolean);
  const alertas = avaliados.filter((e) => e.prioridade !== 'OK');
  const ok = avaliados.filter((e) => e.prioridade === 'OK');

  return {
    modo,
    janela: { inicio: janela.inicio.toISOString(), fim: janela.fim.toISOString() },
    resumo: {
      totalAnalisados: avaliados.length,
      ok: ok.length,
      altaPrioridade: alertas.filter((a) => a.prioridade === 'ALTA PRIORIDADE').length,
      pendenciaDeTeste: alertas.filter((a) => a.prioridade === 'PENDÊNCIA DE TESTE').length,
    },
    alertas,
    ok,
  };
}
