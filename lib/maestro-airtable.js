// lib/maestro-airtable.js
// leitura dos eventos ao vivo - base "Distribuicao de Sinais", tabela CDN. mesma
// base/tabela que o Pulse ja le em varios arquivos (app.js, dashboard.js etc) - so
// leitura, mesma AIRTABLE_API_KEY.
const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';

function horaDeString(s) {
  const m = String(s || '').match(/(\d{1,2}:\d{2})$/);
  return m ? m[1] : '';
}

function fmtAirtable(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getEventosHoje() {
  const dataStr = fmtAirtable(new Date());
  const filter = `AND(DATESTR({fldgNvn52DK5Yu8x9})='${dataStr}',{Status}!='Cancelado')`;
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=30&cellFormat=string&timeZone=America%2FSao_Paulo&userLocale=pt-BR`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const d = await r.json();
    return (d.records || [])
      .map(rec => ({
        nome: rec.fields['Match ID'] || 'Evento',
        hora: horaDeString(rec.fields['Início do Evento BRT'] || ''),
        horaFim: horaDeString(rec.fields['Encerramento'] || ''),
        local: rec.fields['Padrão de Produção'] || '',
        encoder: rec.fields['ENCODERS GERAL'] || '',
        status: rec.fields['Status'] || '',
      }))
      .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  } catch {
    return [];
  }
}
