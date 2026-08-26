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

async function getEventosDoDia(dataAirtableStr) {
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

// 7 dias: hoje + amanha + D+2..D+6, cada um ja com os eventos buscados.
export async function montarDiasNav() {
  const hoje = getBRT();
  hoje.setHours(0, 0, 0, 0);
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    return d;
  });

  const eventosPorDia = await Promise.all(dias.map((d) => getEventosDoDia(fmtAirtable(d))));

  return dias.map((d, i) => ({
    label: i === 0 ? '#NossoDia' : i === 1 ? '#NossoDiaAmanhã' : fmtData(d),
    sublabel: i === 0 || i === 1 ? DIAS_PT[d.getDay()] + ' · ' + fmtData(d) : DIAS_PT[d.getDay()],
    icone: i === 0 ? '🟢' : i === 1 ? '📅' : '🗓️',
    eventos: eventosPorDia[i],
  }));
}
