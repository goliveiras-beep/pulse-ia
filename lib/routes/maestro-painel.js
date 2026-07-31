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

function badgeComando(status) {
  const cls = status === 'Falhou' ? 'badge-red' : status === 'Pendente' ? 'badge-amber' : 'badge-green';
  return `<span class="badge ${cls}">${status || 'Pendente'}</span>`;
}

function slug(s) {
  return String(s || '').replace(/[^a-zA-Z0-9]/g, '_');
}

// escapa pra uso dentro de onclick="fn('VALOR')" - primeiro pro contexto de string JS
// (aspa simples/barra), depois pro contexto de atributo HTML (&, <, >, aspa dupla).
function jsAttrSafe(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [eventos, telemetriaRows, alertasRows, comandosRows] = await Promise.all([
    getEventosHoje(),
    getSheet('Telemetria!A2:G'),
    getSheet('AlertasLog!A2:E'),
    getSheet('Comandos!A2:H'),
  ]);

  const statusAtual = latestStatusPerItem(telemetriaRows).sort((a, b) => a.item.localeCompare(b.item));
  const criticos = statusAtual.filter(s => s.status === 'Crítico');
  const alertasRecentes = alertasRows.slice(-20).reverse();
  const comandosRecentes = comandosRows.slice(-20).reverse();

  const erro = req.query?.erro;
  const bannerErro = erro === 'falha_gravacao'
    ? `<div class="critico-banner">Não foi possível gravar o status agora — confira se a variável <code>MAESTRO_SHEET_ID</code> está configurada no projeto. Nada foi perdido, é só tentar de novo.</div>`
    : erro === 'campos_obrigatorios'
    ? `<div class="critico-banner">Preencha item e status antes de registrar.</div>`
    : erro === 'comando_invalido'
    ? `<div class="critico-banner">Preencha item e ação antes de enviar o comando.</div>`
    : '';

  const bannerComando = req.query?.comando === 'enfileirado'
    ? `<div class="critico-banner" style="background:var(--green-m-bg);border-color:var(--green-m-border);color:var(--green-m-v)">Comando enfileirado — o agente local executa no próximo ciclo (até ~5 min).</div>`
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
          <button class="btn-sm" type="button" onclick="verDetalhe('${jsAttrSafe(s.item)}','det_${slug(s.item)}')">Ver detalhes</button>
        </div>
        <div id="det_${slug(s.item)}" class="item-obs" style="display:none;padding:6px 14px 10px 14px;white-space:pre-wrap"></div>`).join('')
    : `<div class="empty">Nenhum status registrado ainda.</div>`;

  const logHtml = alertasRecentes.length
    ? alertasRecentes.map(a => `
        <div class="item-row">
          <div class="item-obs">${esc(a[0]?.slice(0, 16).replace('T', ' '))}</div>
          <div class="item-nome">${esc(a[2])}</div>
          <div class="item-obs">${esc(a[3])} → ${esc(a[4])}</div>
        </div>`).join('')
    : `<div class="empty">Nenhuma ação registrada ainda.</div>`;

  const comandosHtml = comandosRecentes.length
    ? comandosRecentes.map(c => `
        <div class="item-row">
          ${badgeComando(c[4])}
          <div class="item-nome">${esc(c[1])}</div>
          <div class="item-obs">${esc(c[2])}${c[3] ? ' · ' + esc(c[3]) : ''}</div>
          <div class="item-obs">${esc(c[5])}</div>
          <div class="item-obs">${esc(c[7] || '')}</div>
        </div>`).join('')
    : `<div class="empty">Nenhum comando enviado ainda.</div>`;

  const corpo = `
${bannerErro}
${bannerComando}
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
  <div class="card-header"><div class="card-title">Ações no equipamento</div></div>
  <div class="card-body">
    <p class="item-obs" style="margin-bottom:10px">Ação real no equipamento — pede confirmação e roda no próximo ciclo do agente local (até ~5 min). Fica registrada em "Comandos recentes" abaixo.</p>
    <form method="POST" action="/api/maestro-comando" onsubmit="return confirm('Confirma carregar esse preset no equipamento? Isso muda a configuração real, inclusive se estiver ao vivo.')">
      <input type="hidden" name="acao" value="carregar_preset">
      <div class="form-row">
        <input type="text" name="item" placeholder="Item (ex: DR5000 - Central)" required>
        <input type="text" name="parametro" placeholder="Índice do preset" required style="max-width:140px">
        <button class="btn-primary" type="submit">Carregar preset</button>
      </div>
    </form>
    <form method="POST" action="/api/maestro-comando" onsubmit="return confirm('Confirma trocar a entrada do decoder? Isso muda a configuração real, inclusive se estiver ao vivo.')">
      <input type="hidden" name="acao" value="trocar_entrada">
      <div class="form-row">
        <input type="text" name="item" placeholder="Item (ex: DR5000 - Central)" required>
        <select name="parametro" required>
          <option value="ip">IP</option>
          <option value="asi">ASI</option>
          <option value="sat">Satélite</option>
          <option value="ds3">DS3</option>
          <option value="zixi">Zixi</option>
          <option value="ultraIp">UltraIP</option>
          <option value="srt">SRT</option>
          <option value="rist">RIST</option>
        </select>
        <button class="btn-primary" type="submit">Trocar entrada</button>
      </div>
    </form>
  </div>
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Comandos recentes</div></div>
  ${comandosHtml}
</div>

<div class="card">
  <div class="card-header"><div class="card-title">Log recente</div></div>
  ${logHtml}
</div>`;

  const script = `
<script>
async function verDetalhe(item, elId) {
  const el = document.getElementById(elId);
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = 'Carregando...';
  try {
    const r = await fetch('/api/maestro-detalhe?item=' + encodeURIComponent(item));
    const d = await r.json();
    if (!d.encontrado) { el.textContent = 'Sem leitura detalhada ainda para este item.'; return; }
    el.textContent = JSON.stringify(d.detalhe, null, 2) + '\\n\\n(lido em ' + d.timestamp + ')';
  } catch (e) {
    el.textContent = 'Erro ao buscar detalhes.';
  }
}
</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(pageShell('Painel', corpo + script, { nome: session.nome }));
}
