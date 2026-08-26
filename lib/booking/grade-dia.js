// lib/booking/grade-dia.js
// Grade de eventos (mesma base/tabela que api/app.js ja le, so leitura) navegavel dia a
// dia, mostrando os parametros do evento (tipo/local/encoder/prime) em vez de quem esta
// de plantao - e a tela que pertence ao Booking, nao a Home do Pulse.
const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';

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

  const eventos = await getEventosDoDia(fmtAirtable(d));

  return {
    dataAirtable: fmtAirtable(d),
    label: offsetDias === 0 ? '#NossoDia' : offsetDias === 1 ? '#NossoDiaAmanhã' : fmtData(d),
    sublabel: offsetDias === 0 || offsetDias === 1 ? DIAS_PT[d.getDay()] + ' · ' + fmtData(d) : DIAS_PT[d.getDay()],
    icone: offsetDias === 0 ? '🟢' : offsetDias === 1 ? '📅' : '🗓️',
    eventos,
  };
}
