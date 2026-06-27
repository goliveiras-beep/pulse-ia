// api/dashboard.js
// Página web do dashboard operacional do Pulse
// Acesse: https://pulse-ia-six.vercel.app/api/dashboard

export const config = { maxDuration: 30 };

import { sheetsRequest } from '../lib/google-auth.js';

const AIRTABLE_BASE = 'appwE9LmmTxynTGFY';
const AIRTABLE_TABLE = 'tblpibvwAIGBQXr0H';

async function getEscalaSemana(dataInicio, dataFim) {
  try {
    const data = await sheetsRequest(
      process.env.GOOGLE_SHEET_ID,
      '/values/Escala!A2:F500'
    );
    const rows = data.values || [];
    return rows.filter(r => r[0] >= dataInicio && r[0] <= dataFim);
  } catch (e) {
    return [];
  }
}

async function getAusencias(dataInicio, dataFim) {
  try {
    const data = await sheetsRequest(
      process.env.GOOGLE_SHEET_ID,
      '/values/Ausências!A2:I500'
    );
    const rows = data.values || [];
    return rows.filter(r => r[4] && r[4] >= dataInicio && r[4] <= dataFim);
  } catch (e) {
    return [];
  }
}

async function getEquipe() {
  try {
    const data = await sheetsRequest(
      process.env.GOOGLE_SHEET_ID,
      '/values/Equipe!A2:G50'
    );
    return data.values || [];
  } catch (e) {
    return [];
  }
}

async function getEventosAirtable(dataStr) {
  const filter = `OR(DATESTR({fldRnfbwPVzFiHMqs})='${dataStr}',DATESTR({fld8hthI7oI4MY5aP})='${dataStr}')`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=30`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    const d = await r.json();
    return (d.records || []).map(r => ({
      nome: r.fields['Match ID'] || 'Evento',
      hora: r.fields['Horário KO'] || r.fields['PGM (horário)'] || '',
      tipo: r.fields['Tipo de Conteúdo'] || '',
      nucleo: Array.isArray(r.fields['Núcleo']) ? r.fields['Núcleo'].join(', ') : (r.fields['Núcleo'] || ''),
    })).sort((a, b) => a.hora.localeCompare(b.hora));
  } catch (e) {
    return [];
  }
}

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3 * 60) - a.getTimezoneOffset()) * 60000);
}

function fmtData(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

function fmtDataAirtable(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function semanaAtual(hoje) {
  const dow = hoje.getDay();
  const seg = new Date(hoje); seg.setDate(hoje.getDate() - dow + 1);
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(seg); d.setDate(seg.getDate() + i);
    dias.push(d);
  }
  return dias;
}

export default async function handler(req, res) {
  const hoje = getBRT();
  const d1 = new Date(hoje); d1.setDate(hoje.getDate() + 1);
  const dias = semanaAtual(hoje);
  const hojeStr = fmtData(hoje);
  const d1Str = fmtData(d1);
  const d1Airtable = fmtDataAirtable(d1);
  const segStr = fmtData(dias[0]);
  const domStr = fmtData(dias[6]);

  const [escala, ausencias, equipe, eventosD1] = await Promise.all([
    getEscalaSemana(segStr, domStr),
    getAusencias(segStr, domStr),
    getEquipe(),
    getEventosAirtable(d1Airtable),
  ]);

  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }

  function renderTurno(entrada, saida, obs, isD1) {
    if (obs === 'Folga') return `<span class="badge folga">Folga</span>`;
    if (obs === 'Folga/Ausente' || (!entrada && !saida)) return `<span class="badge ausente">—</span>`;
    const cls = isD1 ? 'turno d1' : 'turno';
    return `<span class="${cls}">${entrada}→${saida}</span>`;
  }

  const trabalhando = escala.filter(r => r[0] === d1Str && r[5] !== 'Folga' && r[5] !== 'Folga/Ausente' && (r[3] || r[4]));
  const folgasD1 = escala.filter(r => r[0] === d1Str && (r[5] === 'Folga' || r[5] === 'Folga/Ausente' || (!r[3] && !r[4])));
  const ausenciasD1 = ausencias.filter(r => r[4] === d1Str);
  const cobertura = equipe.length > 0 ? Math.round(trabalhando.length / equipe.length * 100) : 0;

  const atualizado = hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

  let eventosHTML = '';
  if (eventosD1.length > 0) {
    eventosHTML = eventosD1.map(e => `
      <div class="evento-card">
        <div class="evento-hora">${e.hora || '—'}</div>
        <div class="evento-info">
          <div class="evento-nome">${e.nome} <span class="tag-copa">Copa do Mundo</span></div>
          <div class="evento-sub">${e.tipo}${e.nucleo ? ' · ' + e.nucleo : ''}</div>
        </div>
      </div>`).join('');
  } else {
    eventosHTML = `<div class="empty-eventos">Nenhum evento encontrado para ${d1Str}</div>`;
  }

  let tabelaHTML = '';
  const nomes = equipe.length > 0 ? equipe.map(r => r[0]) : [...new Set(escala.map(r => r[2]))];

  nomes.forEach(nome => {
    const cargo = equipe.find(r => r[0] === nome)?.[1] || '';
    tabelaHTML += `<tr>
      <td class="col-nome">
        <div class="nome-cell">
          <div class="av">${iniciais(nome)}</div>
          <div>
            <div class="nome-principal">${nome}</div>
            ${cargo ? `<div class="nome-cargo">${cargo}</div>` : ''}
          </div>
        </div>
      </td>`;

    dias.forEach(d => {
      const df = fmtData(d);
      const isD1 = df === d1Str;
      const isHoje = df === hojeStr;
      const reg = escala.find(r => r[0] === df && r[2] === nome);
      const ausente = ausencias.find(a => a[1] === nome && (a[4] === df || a[5] === df));
      const tdClass = isD1 ? 'td-d1' : isHoje ? 'td-hoje' : '';

      tabelaHTML += `<td class="${tdClass}">`;
      if (ausente) {
        tabelaHTML += `<span class="badge ausencia">${ausente[3] || 'Ausência'}</span>`;
      } else if (reg) {
        tabelaHTML += renderTurno(reg[3], reg[4], reg[5], isD1);
      } else {
        tabelaHTML += `<span class="sem-escala">—</span>`;
      }
      tabelaHTML += `</td>`;
    });
    tabelaHTML += `</tr>`;
  });

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pulse — Dashboard Operacional</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; }
  .header { background: #fff; border-bottom: 1px solid #e5e5e5; padding: 14px 24px; display: flex; align-items: center; gap: 12px; }
  .logo { width: 32px; height: 32px; background: #1a1a1a; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; font-weight: 700; }
  .header-title { font-size: 15px; font-weight: 600; }
  .header-sub { font-size: 12px; color: #888; margin-top: 1px; }
  .header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .atualizado { font-size: 11px; color: #aaa; }
  .btn-refresh { background: none; border: 1px solid #e5e5e5; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; color: #555; }
  .btn-refresh:hover { background: #f5f5f5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px 24px; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .metric { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 14px 16px; }
  .metric-label { font-size: 11px; color: #888; margin-bottom: 6px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
  .metric-value { font-size: 28px; font-weight: 700; color: #1a1a1a; line-height: 1; }
  .metric-sub { font-size: 11px; color: #aaa; margin-top: 4px; }
  .metric.accent { border-color: #dbeafe; background: #eff6ff; }
  .metric.accent .metric-value { color: #1d4ed8; }
  .section { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .section-header { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 8px; }
  .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  .section-badge { background: #f0f0f0; color: #666; border-radius: 4px; padding: 1px 7px; font-size: 11px; font-weight: 500; }
  .section-badge.blue { background: #dbeafe; color: #1d4ed8; }
  .eventos-wrap { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .evento-card { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #f9f9f9; border-radius: 8px; border: 1px solid #eee; }
  .evento-hora { font-size: 13px; font-weight: 700; color: #1d4ed8; min-width: 72px; }
  .evento-nome { font-size: 13px; font-weight: 600; }
  .evento-sub { font-size: 11px; color: #888; margin-top: 1px; }
  .tag-copa { background: #fef3c7; color: #92400e; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 600; margin-left: 6px; }
  .empty-eventos { padding: 16px; font-size: 13px; color: #aaa; text-align: center; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 700px; }
  th { padding: 8px 10px; text-align: center; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #888; border-bottom: 1px solid #f0f0f0; white-space: nowrap; background: #fafafa; }
  th.th-nome { text-align: left; width: 160px; }
  th.th-hoje { color: #555; background: #f5f5f5; }
  th.th-d1 { background: #eff6ff; color: #1d4ed8; border-bottom: 2px solid #3b82f6; }
  td { padding: 7px 10px; border-bottom: 1px solid #f5f5f5; text-align: center; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafafa; }
  .td-hoje { background: #fafafa; }
  .td-d1 { background: #eff6ff; }
  .col-nome { text-align: left !important; }
  .nome-cell { display: flex; align-items: center; gap: 8px; }
  .av { width: 26px; height: 26px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .nome-principal { font-size: 12px; font-weight: 600; white-space: nowrap; }
  .nome-cargo { font-size: 10px; color: #aaa; }
  .turno { font-size: 11px; color: #333; font-weight: 500; }
  .turno.d1 { color: #1d4ed8; font-weight: 700; }
  .badge { border-radius: 4px; padding: 2px 7px; font-size: 10px; font-weight: 600; }
  .folga { background: #fef3c7; color: #92400e; }
  .ausente { background: #f3f4f6; color: #9ca3af; }
  .ausencia { background: #fee2e2; color: #991b1b; }
  .sem-escala { font-size: 11px; color: #d1d5db; }
  .legenda { display: flex; gap: 16px; padding: 10px 16px; border-top: 1px solid #f0f0f0; flex-wrap: wrap; }
  .leg-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #888; }
  @media (max-width: 768px) { .metrics { grid-template-columns: repeat(2,1fr); } .container { padding: 12px; } }
</style>
</head>
<body>

<div class="header">
  <div class="logo">P</div>
  <div>
    <div class="header-title">Pulse — Dashboard operacional</div>
    <div class="header-sub">Semana ${segStr} a ${domStr} · D+1: ${DIAS_FULL[d1.getDay()]} ${d1Str}</div>
  </div>
  <div class="header-right">
    <span class="atualizado">Atualizado ${atualizado}</span>
    <button class="btn-refresh" onclick="location.reload()">↻ Atualizar</button>
  </div>
</div>

<div class="container">

  <div class="metrics">
    <div class="metric accent">
      <div class="metric-label">Trabalhando D+1</div>
      <div class="metric-value">${trabalhando.length}</div>
      <div class="metric-sub">de ${equipe.length} na equipe</div>
    </div>
    <div class="metric">
      <div class="metric-label">Folgas D+1</div>
      <div class="metric-value">${folgasD1.length}</div>
      <div class="metric-sub">${ausenciasD1.length} registradas via Pulse</div>
    </div>
    <div class="metric">
      <div class="metric-label">Eventos D+1</div>
      <div class="metric-value">${eventosD1.length}</div>
      <div class="metric-sub">${eventosD1.length > 0 ? eventosD1[0].hora + ' — primeiro evento' : 'sem eventos no Airtable'}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Cobertura D+1</div>
      <div class="metric-value">${cobertura}%</div>
      <div class="metric-sub">da equipe ativa amanhã</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-title">Eventos D+1 — ${DIAS_FULL[d1.getDay()]} ${d1Str}</span>
      <span class="section-badge blue">${eventosD1.length} evento${eventosD1.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="eventos-wrap">${eventosHTML}</div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-title">Escala semanal</span>
      <span class="section-badge">${equipe.length} colaboradores</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="th-nome">Colaborador</th>
            ${dias.map(d => {
              const df = fmtData(d);
              const isD1 = df === d1Str;
              const isHoje = df === hojeStr;
              return `<th class="${isD1 ? 'th-d1' : isHoje ? 'th-hoje' : ''}">
                ${DIAS_PT[d.getDay()]}<br>
                <span style="font-weight:400">${df}</span>
                ${isD1 ? '<br><span style="font-size:9px;color:#3b82f6">D+1</span>' : ''}
                ${isHoje ? '<br><span style="font-size:9px;color:#888">hoje</span>' : ''}
              </th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>${tabelaHTML}</tbody>
      </table>
    </div>
    <div class="legenda">
      <div class="leg-item"><span class="badge folga">Folga</span> dia de folga escalado</div>
      <div class="leg-item"><span class="badge ausencia">Ausência</span> registrado via Pulse</div>
      <div class="leg-item"><span class="badge ausente">—</span> sem escala</div>
      <div class="leg-item" style="color:#1d4ed8;font-weight:600">coluna azul = D+1</div>
    </div>
  </div>

</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(html);
}
