// lib/booking/checagem.js
// Checagem operacional de Booking (ver checar_booking_manha_e_noite.md, adaptado
// pra tabela real do Airtable descoberta nesta sessao). SO alerta - nunca grava
// nada, porque a tabela Booking e sincronizada da Matriz LiveMode [Geral] e ainda
// nao confirmamos se UPDATE funciona nela.
//
// O alerta cobre o lado Airtable (evento com meio de recepcao declarado mas sem
// os parametros tecnicos daquele meio preenchidos - lista de campos configuravel
// em /api/maestro-booking-config, ver lib/booking/config.js) cruzado com evidencia
// do Gmail (lmalveira@livemode.com, ver lib/booking/gmail.js) - so busca e-mail pra
// quem ja e alerta, pra nao gastar cota com os eventos que ja estao OK.
import { getMapaCamposPorMeio } from './config.js';
import { buscarEmailsParaEvento } from './gmail.js';
import { arquivarEmailDoEvento } from './arquivo-email.js';
import { jaArquivado, marcarArquivado } from './registro-arquivamento.js';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblJZ3r5lAapjcCll';

function temAlgum(fields, nomesCampo) {
  return nomesCampo.some((nome) => {
    const v = fields[nome];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
}

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
  // "Se Aplica Booking de Sinal?" = "Sim" e o campo oficial pra decidir se o evento
  // precisa de checagem de parametro de sinal - filtra aqui (mais eficiente) e de novo
  // em avaliarEvento (defesa contra o nome do campo nao casar exatamente na formula).
  const filtro = `AND({Status}!='Cancelado', {Se Aplica Booking de Sinal?}='Sim', IS_AFTER({Início do Evento BRT}, '${new Date(inicio.getTime() - 60_000).toISOString()}'), IS_BEFORE({Início do Evento BRT}, '${fim.toISOString()}'))`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=100&sort[0][field]=Início do Evento BRT&sort[0][direction]=asc`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY}` } });
  if (!r.ok) throw new Error(`Airtable respondeu ${r.status}: ${await r.text().catch(() => '')}`);
  const d = await r.json();
  return d.records || [];
}

function avaliarEvento(record, camposPorMeio) {
  const f = record.fields;
  const nome = f['Match ID'] || '(sem nome)';
  if (f['Se Aplica Booking de Sinal?'] !== 'Sim') return null; // "Não" ou vazio - desconsiderar

  const meios = f['Origem do Sinal'] || [];
  const pendencias = [];
  for (const meio of meios) {
    const campos = camposPorMeio[meio];
    if (!campos || !campos.length) continue; // meio sem checagem configurada (ex.: TVU, SAT 4K, RTMP)
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
  const [registros, camposPorMeio] = await Promise.all([
    buscarEventosNaJanela(janela),
    getMapaCamposPorMeio(),
  ]);

  const avaliados = registros.map((r) => avaliarEvento(r, camposPorMeio)).filter(Boolean);
  const alertas = avaliados.filter((e) => e.prioridade !== 'OK');
  const ok = avaliados.filter((e) => e.prioridade === 'OK');

  // e-mail so pra quem ja e alerta - evita gastar cota da API com os eventos ja OK.
  // Busca em paralelo (nao compartilha nada), mas o arquivamento em si roda em SERIE
  // (nao Promise.all) - senao dois alertas com e-mail pra arquivar ao mesmo tempo entram
  // numa corrida na hora de criar a pasta "Booking"/ano/mes compartilhada e cada um cria
  // a sua copia, duplicando a pasta (aconteceu de verdade - ver acharOuCriarPasta).
  await Promise.all(alertas.map(async (a) => {
    a.emailsRelacionados = await buscarEmailsParaEvento(a.nome);
  }));

  for (const a of alertas) {
    for (const email of a.emailsRelacionados) {
      if (await jaArquivado(email.id)) continue;
      try {
        const { pdfDriveId } = await arquivarEmailDoEvento({ emailId: email.id, nomeEvento: a.nome, dataEvento: a.inicioBrt });
        await marcarArquivado(email.id, pdfDriveId);
      } catch (e) {
        console.error(`arquivamento falhou pro e-mail ${email.id} (evento ${a.nome}):`, e.message);
      }
    }
  }

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
