// api/dashboard.js
export const config = { maxDuration: 30 };

import { sheetsRequest } from '../lib/google-auth.js';

const AIRTABLE_BASE = 'appwE9LmmTxynTGFY';
const AIRTABLE_TABLE = 'tblpibvwAIGBQXr0H';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3 * 60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
function fmtAirtable(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }

// Converte "14:00" → minutos desde meia-noite (suporte a virada: 23:59 = 1439, mas turnos noturnos são tratados)
function toMin(h) {
  if (!h) return null;
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + (mm || 0);
}

// Verifica se colaborador está de plantão durante o horário do evento
// Lida com turnos que viram a madrugada (ex: 23:59 → 08:00)
function estaDeServico(entrada, saida, horaEvento) {
  if (!entrada || !saida || !horaEvento) return false;
  const ini = toMin(entrada);
  const fim = toMin(saida);
  const ev = toMin(horaEvento);
  if (fim === null || ini === null || ev === null) return false;
  if (fim > ini) {
    // Turno normal (ex: 08:00 → 16:00)
    return ev >= ini && ev <= fim;
  } else {
    // Turno noturno que vira meia-noite (ex: 23:59 → 08:00)
    return ev >= ini || ev <= fim;
  }
}

// Verifica se colaborador entra ou sai DURANTE o evento (±60 min)
function statusDuranteEvento(entrada, saida, horaEvento) {
  if (!entrada || !saida || !horaEvento) return null;
  const ev = toMin(horaEvento);
  const ini = toMin(entrada);
  const fim = toMin(saida);
  if (Math.abs(ini - ev) <= 60) return 'entrando';
  if (Math.abs(fim - ev) <= 60) return 'saindo';
  return null;
}

async function getSheet(range) {
  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch { return []; }
}

async function getEventos(dataStr) {
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
    })).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  } catch { return []; }
}

export default async function handler(req, res) {
  const hoje = getBRT();
  const d1 = new Date(hoje); d1.setDate(hoje.getDate() + 1);
  const hojeStr = fmtData(hoje);
  const d1Str = fmtData(d1);

  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  // Semana atual
  const dow = hoje.getDay();
  const seg = new Date(hoje); seg.setDate(hoje.getDate() - dow + 1);
  const dias = Array.from({length:7}, (_, i) => { const d = new Date(seg); d.setDate(seg.getDate()+i); return d; });
  const segStr = fmtData(dias[0]);
  const domStr = fmtData(dias[6]);

  const [escalaRaw, ausenciasRaw, equipeRaw, eventosD1] = await Promise.all([
    getSheet('Escala!A2:F500'),
    getSheet('Ausências!A2:I500'),
    getSheet('Equipe!A2:G50'),
    getEventos(fmtAirtable(d1)),
  ]);

  const escala = escalaRaw.filter(r => r[0] >= segStr && r[0] <= domStr);
  const ausencias = ausenciasRaw.filter(r => r[4] >= segStr && r[4] <= domStr);
  const equipe = equipeRaw;

  // Escala do D+1
  const escalaD1 = escala.filter(r => r[0] === d1Str);

  // Para cada evento, cruzar com escala
  const eventosCruzados = eventosD1.map(ev => {
    const disponiveis = [];
    const atenção = [];
    const ausentes = [];

    escalaD1.forEach(r => {
      const nome = r[2], entrada = r[3], saida = r[4], obs = r[5];
      const ausente = ausencias.find(a => a[1] === nome && (a[4] === d1Str || a[5] === d1Str));

      if (ausente || obs === 'Folga' || obs === 'Folga/Ausente' || (!entrada && !saida)) {
        ausentes.push({ nome, motivo: ausente ? ausente[3] : 'Folga' });
        return;
      }

      const ativo = estaDeServico(entrada, saida, ev.hora);
      const status = statusDuranteEvento(entrada, saida, ev.hora);

      if (ativo) {
        if (status) {
          atenção.push({ nome, entrada, saida, status });
        } else {
          disponiveis.push({ nome, entrada, saida });
        }
      }
    });

    return { ...ev, disponiveis, atenção, ausentes, semCobertura: disponiveis.length === 0 && atenção.length === 0 };
  });

  const semCobertura = eventosCruzados.filter(e => e.semCobertura).length;
  const comAtencao = eventosCruzados.filter(e => e.atenção.length > 0).length;

  const atualizado = hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

  // Gera HTML dos cards de eventos
  function badgeStatus(s) {
    if (s === 'entrando') return `<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px">entrando</span>`;
    if (s === 'saindo') return `<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px">saindo</span>`;
    return '';
  }

  function avatarHTML(nome, cor='#dbeafe', txt='#1d4ed8') {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${cor};color:${txt};font-size:8px;font-weight:700;flex-shrink:0">${iniciais(nome)}</span>`;
  }

  const eventosHTML = eventosCruzados.length === 0
    ? `<div style="padding:20px;text-align:center;color:#aaa;font-size:13px">Nenhum evento encontrado para ${d1Str}</div>`
    : eventosCruzados.map(ev => {
      const alertCor = ev.semCobertura ? '#fee2e2' : ev.atenção.length > 0 ? '#fef3c7' : '#f0fdf4';
      const alertBorder = ev.semCobertura ? '#fca5a5' : ev.atenção.length > 0 ? '#fcd34d' : '#86efac';
      const alertIcon = ev.semCobertura ? '⚠️' : ev.atenção.length > 0 ? '⚡' : '✓';
      const alertTxt = ev.semCobertura ? 'Sem cobertura' : ev.atenção.length > 0 ? 'Atenção — troca de turno' : 'Cobertura OK';
      const alertTxtCor = ev.semCobertura ? '#991b1b' : ev.atenção.length > 0 ? '#92400e' : '#166534';

      const disponiveisHTML = ev.disponiveis.map(p =>
        `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f5f5f5">
          ${avatarHTML(p.nome)}
          <span style="font-size:12px;font-weight:600;flex:1">${p.nome}</span>
          <span style="font-size:11px;color:#555">${p.entrada}→${p.saida}</span>
        </div>`
      ).join('');

      const atencaoHTML = ev.atenção.map(p =>
        `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #fef9c3">
          ${avatarHTML(p.nome, '#fef3c7', '#92400e')}
          <span style="font-size:12px;font-weight:600;flex:1">${p.nome}</span>
          <span style="font-size:11px;color:#555">${p.entrada}→${p.saida}</span>
          ${badgeStatus(p.status)}
        </div>`
      ).join('');

      const ausentesHTML = ev.ausentes.length > 0
        ? `<div style="margin-top:10px">
            <div style="font-size:10px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Folgas/ausentes</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${ev.ausentes.map(p => `<span style="background:#f3f4f6;color:#9ca3af;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:500">${p.nome.split(' ')[0]} <span style="opacity:.6">${p.motivo}</span></span>`).join('')}
            </div>
          </div>`
        : '';

      return `
      <div style="background:#fff;border:1px solid ${alertBorder};border-radius:10px;overflow:hidden;margin-bottom:12px">
        <div style="padding:10px 14px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:10px">
          <div style="font-size:14px;font-weight:700;color:#1d4ed8;min-width:52px">${ev.hora||'—'}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">${ev.nome} <span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">Copa</span></div>
            <div style="font-size:11px;color:#888">${ev.tipo}${ev.nucleo?' · '+ev.nucleo:''}</div>
          </div>
          <div style="background:${alertCor};border:1px solid ${alertBorder};border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:${alertTxtCor}">${alertIcon} ${alertTxt}</div>
        </div>
        <div style="padding:10px 14px">
          ${ev.disponiveis.length > 0 ? `
            <div style="font-size:10px;color:#166534;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">De plantão (${ev.disponiveis.length})</div>
            ${disponiveisHTML}` : ''}
          ${ev.atenção.length > 0 ? `
            <div style="font-size:10px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin:${ev.disponiveis.length>0?'10px':0} 0 4px">Troca de turno (${ev.atenção.length})</div>
            ${atencaoHTML}` : ''}
          ${ev.semCobertura ? `<div style="text-align:center;padding:10px;color:#991b1b;font-size:12px;font-weight:600">Nenhum colaborador escalado neste horário</div>` : ''}
          ${ausentesHTML}
        </div>
      </div>`;
    }).join('');

  // Tabela semanal
  let tabelaHTML = '';
  const nomes = equipe.length > 0 ? equipe.map(r => r[0]) : [...new Set(escala.map(r => r[2]))];

  nomes.forEach(nome => {
    const cargo = equipe.find(r => r[0] === nome)?.[1] || '';
    tabelaHTML += `<tr><td class="col-nome">
      <div class="nome-cell">
        <div class="av">${iniciais(nome)}</div>
        <div><div class="nome-principal">${nome}</div>${cargo?`<div class="nome-cargo">${cargo}</div>`:''}</div>
      </div></td>`;

    dias.forEach(d => {
      const df = fmtData(d);
      const isD1 = df === d1Str, isHoje = df === hojeStr;
      const reg = escala.find(r => r[0] === df && r[2] === nome);
      const ausente = ausencias.find(a => a[1] === nome && (a[4] === df || a[5] === df));
      tabelaHTML += `<td class="${isD1?'td-d1':isHoje?'td-hoje':''}">`;
      if (ausente) tabelaHTML += `<span class="badge ausencia">${ausente[3]||'Ausência'}</span>`;
      else if (reg) {
        const {3: ent, 4: sai, 5: obs} = reg;
        if (obs === 'Folga') tabelaHTML += `<span class="badge folga">Folga</span>`;
        else if (obs === 'Folga/Ausente' || (!ent && !sai)) tabelaHTML += `<span class="sem-escala">—</span>`;
        else tabelaHTML += `<span class="${isD1?'turno d1':'turno'}">${ent}→${sai}</span>`;
      } else tabelaHTML += `<span class="sem-escala">—</span>`;
      tabelaHTML += `</td>`;
    });
    tabelaHTML += `</tr>`;
  });

  const trabalhando = escalaD1.filter(r => r[5]!=='Folga'&&r[5]!=='Folga/Ausente'&&(r[3]||r[4])).length;
  const folgasD1cnt = escalaD1.filter(r => r[5]==='Folga'||r[5]==='Folga/Ausente'||(!r[3]&&!r[4])).length;
  const cobertura = equipe.length > 0 ? Math.round(trabalhando/equipe.length*100) : 0;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a}
.header{background:#fff;border-bottom:1px solid #e5e5e5;padding:14px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.logo{width:32px;height:32px;background:#1a1a1a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700}
.header-title{font-size:15px;font-weight:600}
.header-sub{font-size:12px;color:#888;margin-top:1px}
.header-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.atualizado{font-size:11px;color:#aaa}
.btn-refresh{background:none;border:1px solid #e5e5e5;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;color:#555}
.btn-refresh:hover{background:#f0f0f0}
.container{max-width:1100px;margin:0 auto;padding:20px 24px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.metric{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px}
.metric-label{font-size:11px;color:#888;margin-bottom:6px;font-weight:500;text-transform:uppercase;letter-spacing:.04em}
.metric-value{font-size:28px;font-weight:700;color:#1a1a1a;line-height:1}
.metric-sub{font-size:11px;color:#aaa;margin-top:4px}
.metric.blue{border-color:#dbeafe;background:#eff6ff}.metric.blue .metric-value{color:#1d4ed8}
.metric.red{border-color:#fca5a5;background:#fef2f2}.metric.red .metric-value{color:#dc2626}
.metric.amber{border-color:#fcd34d;background:#fffbeb}.metric.amber .metric-value{color:#d97706}
.layout{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.section{background:#fff;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden}
.section-header{padding:12px 16px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:8px}
.section-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#555}
.section-badge{background:#f0f0f0;color:#666;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:500}
.section-badge.blue{background:#dbeafe;color:#1d4ed8}
.section-badge.red{background:#fee2e2;color:#991b1b}
.section-badge.amber{background:#fef3c7;color:#92400e}
.section-content{padding:12px 16px}
.full-width{grid-column:1/-1}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12px;min-width:650px}
th{padding:8px 10px;text-align:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#888;border-bottom:1px solid #f0f0f0;white-space:nowrap;background:#fafafa}
th.th-nome{text-align:left;width:150px}
th.th-hoje{color:#555;background:#f5f5f5}
th.th-d1{background:#eff6ff;color:#1d4ed8;border-bottom:2px solid #3b82f6}
td{padding:6px 10px;border-bottom:1px solid #f5f5f5;text-align:center;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafafa}
.td-hoje{background:#fafafa}.td-d1{background:#eff6ff}
.col-nome{text-align:left!important}
.nome-cell{display:flex;align-items:center;gap:7px}
.av{width:24px;height:24px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.nome-principal{font-size:12px;font-weight:600;white-space:nowrap}
.nome-cargo{font-size:10px;color:#aaa}
.turno{font-size:11px;color:#333;font-weight:500}
.turno.d1{color:#1d4ed8;font-weight:700}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600}
.folga{background:#fef3c7;color:#92400e}
.ausencia{background:#fee2e2;color:#991b1b}
.sem-escala{font-size:11px;color:#d1d5db}
.legenda{display:flex;gap:12px;padding:10px 16px;border-top:1px solid #f0f0f0;flex-wrap:wrap}
.leg-item{display:flex;align-items:center;gap:5px;font-size:11px;color:#888}
@media(max-width:768px){.metrics{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.container{padding:12px}}
</style>
</head>
<body>
<div class="header">
  <div class="logo">P</div>
  <div>
    <div class="header-title">Pulse — Dashboard operacional</div>
    <div class="header-sub">Semana ${segStr}–${domStr} · D+1: ${DIAS_FULL[d1.getDay()]} ${d1Str}</div>
  </div>
  <div class="header-right">
    <span class="atualizado">Atualizado ${atualizado}</span>
    <button class="btn-refresh" onclick="location.reload()">↻ Atualizar</button>
  </div>
</div>

<div class="container">
  <div class="metrics">
    <div class="metric blue">
      <div class="metric-label">Trabalhando D+1</div>
      <div class="metric-value">${trabalhando}</div>
      <div class="metric-sub">de ${equipe.length} na equipe · ${cobertura}% cobertura</div>
    </div>
    <div class="metric ${folgasD1cnt > 2 ? 'amber' : ''}">
      <div class="metric-label">Folgas D+1</div>
      <div class="metric-value">${folgasD1cnt}</div>
      <div class="metric-sub">${ausencias.filter(a=>a[4]===d1Str).length} registradas via Pulse</div>
    </div>
    <div class="metric ${semCobertura > 0 ? 'red' : ''}">
      <div class="metric-label">Eventos sem cobertura</div>
      <div class="metric-value">${semCobertura}</div>
      <div class="metric-sub">de ${eventosD1.length} evento${eventosD1.length!==1?'s':''} no D+1</div>
    </div>
    <div class="metric ${comAtencao > 0 ? 'amber' : ''}">
      <div class="metric-label">Trocas de turno</div>
      <div class="metric-value">${comAtencao}</div>
      <div class="metric-sub">eventos com ${comAtencao > 0 ? 'entrada/saída durante' : 'cobertura completa'}</div>
    </div>
  </div>

  <div class="layout">
    <div class="section">
      <div class="section-header">
        <span class="section-title">Eventos D+1 × Escala</span>
        <span class="section-badge ${semCobertura>0?'red':comAtencao>0?'amber':'blue'}">${eventosD1.length} eventos</span>
      </div>
      <div class="section-content" style="max-height:600px;overflow-y:auto">${eventosHTML}</div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title">Plantão D+1 — ${d1Str}</span>
        <span class="section-badge blue">${trabalhando} ativos</span>
      </div>
      <div class="section-content">
        ${escalaD1.filter(r=>r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Folga/Ausente').sort((a,b)=>a[3].localeCompare(b[3])).map(r=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5">
          <div style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;flex-shrink:0">${iniciais(r[2])}</div>
          <div style="flex:1;font-size:12px;font-weight:600">${r[2]}</div>
          <div style="font-size:12px;color:#1d4ed8;font-weight:600">${r[3]}→${r[4]}</div>
        </div>`).join('')}
        ${escalaD1.filter(r=>!r[3]||r[5]==='Folga'||r[5]==='Folga/Ausente').map(r=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5;opacity:.5">
          <div style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#f3f4f6;color:#9ca3af;font-size:9px;font-weight:700;flex-shrink:0">${iniciais(r[2])}</div>
          <div style="flex:1;font-size:12px;font-weight:600;color:#9ca3af">${r[2]}</div>
          <span style="background:#f3f4f6;color:#9ca3af;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">${r[5]||'—'}</span>
        </div>`).join('')}
      </div>
    </div>

    <div class="section full-width">
      <div class="section-header">
        <span class="section-title">Escala semanal</span>
        <span class="section-badge">${equipe.length} colaboradores</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="th-nome">Colaborador</th>
            ${dias.map(d => {
              const df = fmtData(d), isD1 = df===d1Str, isHoje = df===hojeStr;
              return `<th class="${isD1?'th-d1':isHoje?'th-hoje':''}">${DIAS_PT[d.getDay()]}<br><span style="font-weight:400">${df}</span>${isD1?'<br><span style="font-size:9px;color:#3b82f6">D+1</span>':''}${isHoje?'<br><span style="font-size:9px;color:#888">hoje</span>':''}</th>`;
            }).join('')}
          </tr></thead>
          <tbody>${tabelaHTML}</tbody>
        </table>
      </div>
      <div class="legenda">
        <div class="leg-item"><span class="badge folga">Folga</span>folga escalada</div>
        <div class="leg-item"><span class="badge ausencia">Ausência</span>via Pulse</div>
        <div class="leg-item"><span class="sem-escala">—</span>sem escala</div>
        <div class="leg-item" style="color:#1d4ed8;font-weight:600">coluna azul = D+1</div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(html);
}
