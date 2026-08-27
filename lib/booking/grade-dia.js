// lib/booking/grade-dia.js
// Grade de eventos (mesma base/tabela que api/app.js ja le, so leitura) navegavel dia a
// dia, mostrando os parametros do evento (tipo/local/encoder/prime) em vez de quem esta
// de plantao - e a tela que pertence ao Booking, nao a Home do Pulse.
//
// Os parametros tecnicos (IP do SRT, transponder do satelite etc.) NAO estao nessa
// tabela (CDN) - vivem na tabela Booking (tblJZ3r5lAapjcCll, mesma que checagem.js usa).
// Por isso montarDia() faz uma segunda busca, so pro dia pedido, e cruza por "Match ID"
// (nome do evento) pra anexar ev.meiosBooking/ev.valoresTecnicos quando existir.
import { getMapaCamposPorMeio } from './config.js';
import { montarValoresTecnicos } from './checagem.js';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';
const AIRTABLE_TABLE_BOOKING = 'tblJZ3r5lAapjcCll';

export function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3 * 60) - a.getTimezoneOffset()) * 60000);
}
export function fmtData(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; }
export function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export const DIAS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function horaDeString(s) {
  const m = String(s || '').match(/(\d{1,2}:\d{2})$/);
  return m ? m[1] : '';
}

export async function getEventosDoDia(dataAirtableStr) {
  const filter = `AND(DATESTR({fldgNvn52DK5Yu8x9})='${dataAirtableStr}',{Status}!='Cancelado')`;
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=30&cellFormat=string&timeZone=America%2FSao_Paulo&userLocale=pt-BR`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const d = await r.json();
    return (d.records || []).map((rec) => ({
      nome: rec.fields['Match ID'] || 'Evento',
      hora: horaDeString(rec.fields['Início do Evento BRT'] || ''),
      horaFim: horaDeString(rec.fields['Encerramento'] || ''),
      tipo: rec.fields['Tipo de Conteúdo'] || '',
      local: rec.fields['Padrão de Produção'] || '',
      encoder: rec.fields['ENCODERS GERAL'] || '',
      prime: rec.fields['PRIME VIDEO'] || '',
    })).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  } catch {
    return [];
  }
}

// Busca na tabela Booking (nao na CDN) so os eventos do dia pedido que tem sinal
// declarado, monta um mapa "Match ID" -> {meios, valoresTecnicos} pra cruzar com os
// eventos da grade (que vem da CDN). Igual ao filtro/leitura de checagem.js.
async function getParametrosTecnicosDoDia(dataAirtableStr, camposPorMeio) {
  const filtro = `AND({Status}!='Cancelado', {Se Aplica Booking de Sinal?}='Sim', DATESTR({Início do Evento BRT})='${dataAirtableStr}')`;
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_BOOKING}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=50`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY}` } }
    );
    const d = await r.json();
    const mapa = {};
    for (const rec of d.records || []) {
      const f = rec.fields;
      const nome = f['Match ID'];
      if (!nome) continue;
      const meios = f['Origem do Sinal'] || [];
      mapa[nome] = { meios, valoresTecnicos: montarValoresTecnicos(f, meios, camposPorMeio) };
    }
    return mapa;
  } catch {
    return {};
  }
}

// TEMPORARIO - so pra descobrir o nome exato dos campos de Observacao/Suporte na tabela
// Booking antes de codar a leitura de verdade. Remover depois de usado uma vez.
export async function debugCamposBookingDoDia(dataAirtableStr, valores, raw) {
  const filtro = `AND({Status}!='Cancelado', DATESTR({Início do Evento BRT})='${dataAirtableStr}')`;
  const extra = raw ? '' : '&cellFormat=string&timeZone=America%2FSao_Paulo&userLocale=pt-BR';
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE_BOOKING}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=5${extra}`,
    { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY}` } }
  );
  const d = await r.json();
  if (valores) return (d.records || []).map((rec) => ({ nome: rec.fields['Match ID'], campos: rec.fields }));
  return (d.records || []).map((rec) => ({ nome: rec.fields['Match ID'], campos: Object.keys(rec.fields).sort() }));
}

// Parseia "YYYY-MM-DD" como data local (sem componente de hora), pra nao cair um dia
// pra tras/frente por fuso quando o navegador manda a data escolhida.
export function parseAirtableStr(s) {
  const [ano, mes, dia] = String(s).split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

// Monta um dia completo (label/sublabel/icone + eventos) a partir da data em si -
// usado tanto pro primeiro carregamento (hoje) quanto pra navegacao sob demanda
// (qualquer dia pra frente ou pra tras, sem limite fixo de quantos dias existem).
export async function montarDia(data) {
  const hoje = getBRT();
  hoje.setHours(0, 0, 0, 0);
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  const offsetDias = Math.round((d - hoje) / 86400000);

  const dataAirtable = fmtAirtable(d);
  const camposPorMeio = await getMapaCamposPorMeio();
  const [eventos, parametros] = await Promise.all([
    getEventosDoDia(dataAirtable),
    getParametrosTecnicosDoDia(dataAirtable, camposPorMeio),
  ]);
  for (const ev of eventos) {
    const p = parametros[ev.nome];
    if (p) { ev.meiosBooking = p.meios; ev.valoresTecnicos = p.valoresTecnicos; }
  }

  return {
    dataAirtable,
    label: fmtData(d),
    sublabel: DIAS_PT[d.getDay()],
    icone: offsetDias === 0 ? '🟢' : offsetDias === 1 ? '📅' : '🗓️',
    eventos,
  };
}
