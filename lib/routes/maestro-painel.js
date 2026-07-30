// lib/routes/maestro-painel.js - painel principal do MAESTRO
// visao unificada: eventos ao vivo (Airtable CDN) + status manual de telemetria
// (planilha propria do MAESTRO) + banner de itens em estado Critico + log recente
// de acoes. reaproveita a sessao do Pulse (pulse_session) - sem login proprio.
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { getEventosHoje } from '../maestro-airtable.js';
import { getSheet, latestStatusPerItem } from '../maestro-sheets.js';

function badgeStatus(status) {
  const cls = status === 'Crítico' ? 'badge-red' : status === 'Atenção' ? 'badge-amber' : 'badge-green';
  return `<span class="badge ${cls}">${status || 'OK'}</span>`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [eventos, telemetriaRows, alertasRows] = await Promise.all([
    getEventosHoje(),
    getSheet('Telemetria!A2:G'),
    getSheet('AlertasLog!A2:E'),
  ]);

  const statusAtual = latestStatusPerItem(telemetriaRows).sort((a, b) => a.item.localeCompare(b.item));
  const criticos = statusAtual.filter(s => s.status === 'Crítico');
  const alertasRecentes = alertasRows.slice(-20).reverse();

  const erro = req.query?.erro;
  const bannerErro = erro === 'falha_gravacao'
    ? `<div class="critico-banner">Não foi possível gravar o status agora — confira se a variável <code>MAESTRO_SHEET_ID</code> está configurada no projeto. Nada foi perdido, é só tentar de novo.</div>`
    : erro === 'campos_obrigatorios'
    ? `<div class="critico-banner">Preencha item e status antes de registrar.</div>`
    : '';

  const bannerCritico = criticos.length
    ? `<div class="critico-banner">⚠️ ${criticos.length} item(ns) em estado Crítico agora
        <ul>${criticos.map(c => `<li>${esc(c.item)} — ${esc(c.observacao || 'sem observação')}</li>`).join('')}</ul>
      </div>`
    : '';

  const eventosHtml = eventos.length
    ? eventos.map(e => `
        <div class="item-row">
          <div class="item-nome">${esc(e.nome)}</div>
          <div class="item-obs">${esc(e.local)}${e.encoder ? ' · ' + esc(e.encoder) : ''}</div>
          <div class="item-obs">${esc(e.hora)}${e.horaFim ? '–' + esc(e.horaFim) : ''}</div>
        </div>`).join('')
    : `<div class="empty">Nenhum evento hoje na base CDN.</div>`;

  const telemetriaHtml = statusAtual.length
    ? statusAtual.map(s => `
        <div class="item-row">
          ${badgeStatus(s.status)}
          <div class="item-nome">${esc(s.item)}</div>
          <div class="item-obs">${esc(s.categoria)}${s.observacao ? ' · ' + esc(s.observacao) : ''}</div>
          <div class="item-obs">${esc(s.reportadoPor)}</div>
        </div>`).join('')
    : `<div class="empty">Nenhum status registrado ainda.</div>`;

  const logHtml = alertasRecentes.length
    ? alertasRecentes.map(a => `
        <div class="item-row">
          <div class="item-obs">${esc(a[0]?.slice(0, 16).replace('T', ' '))}</div>
          <div class="item-nome">${esc(a[2])}</div>
          <div class="item-obs">${esc(a[3])} → ${esc(a[4])}</div>
        </div>`).join('')
    : `<div class="empty">Nenhuma ação registrada ainda.</div>`;

  const corpo = `
${bannerErro}
${bannerCritico}
<div class="card">
  <div class="card-header"><div class="card-title">Eventos hoje</div></div>
  ${eventosHtml}
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Telemetria — status atual</div></div>
  ${telemetriaHtml}
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Atualizar status</div></div>
  <div class="card-body">
    <form method="POST" action="/api/maestro-telemetria">
      <div class="form-row">
        <input type="text" name="item" placeholder="Item (ex: Encoder Studio 3)" required>
        <select name="categoria">
          <option value="Encoder">Encoder</option>
          <option value="Stream">Stream</option>
          <option value="Infra">Infra</option>
          <option value="Outro">Outro</option>
        </select>
        <select name="status" required>
          <option value="OK">OK</option>
          <option value="Atenção">Atenção</option>
          <option value="Crítico">Crítico</option>
        </select>
      </div>
      <div class="form-row">
        <input type="text" name="observacao" placeholder="Observação (opcional)">
        <input type="text" name="evento" placeholder="Evento vinculado (opcional)">
      </div>
      <button class="btn-primary" type="submit">Registrar status</button>
    </form>
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Log recente</div></div>
  ${logHtml}
</div>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(pageShell('Painel', corpo, { nome: session.nome }));
}
