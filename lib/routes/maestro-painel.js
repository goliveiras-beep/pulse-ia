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
        <div id="det_${slug(s.item)}" style="display:none;padding:2px 14px 10px 14px"></div>`).join('')
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
<style>
.detalhe-tabela{width:100%;border-collapse:collapse;font-size:11px}
.detalhe-tabela td{padding:3px 8px;border-bottom:1px solid var(--border2)}
.detalhe-tabela td:first-child{color:var(--text3);white-space:nowrap}
.detalhe-secao{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);padding:8px 8px 2px}
.detalhe-atualizado{font-size:10px;color:var(--text3);padding:6px 8px 0}
</style>
<script>
var detalheTimers = {};

function fmtBool(v) { return v === true ? 'Sim' : v === false ? 'Não' : '—'; }
function fmtNum(v, suf) { return (v === null || v === undefined) ? '—' : (v + (suf || '')); }
function linha(label, valor) { return '<tr><td>' + label + '</td><td>' + valor + '</td></tr>'; }

function montarTabelaDetalhe(d) {
  var html = '';
  html += '<div class="detalhe-secao">Vídeo</div><table class="detalhe-tabela">';
  html += linha('Codec', d.videoCodec || '—');
  html += linha('Resolução', d.videoResolucao || '—');
  html += linha('FPS', d.videoFps ? d.videoFps.toFixed(2) : '—');
  html += linha('Bitrate', d.videoBitrateBps ? (d.videoBitrateBps / 1e6).toFixed(2) + ' Mbps' : '—');
  html += '</table>';

  if (d.entrada) {
    html += '<div class="detalhe-secao">Entrada</div><table class="detalhe-tabela">';
    html += linha('Tipo', (d.entrada.tipo || '—').toUpperCase());
    html += linha('Bitrate', fmtNum(d.entrada.bitrateKbps, ' kbps'));
    html += '</table>';
  }

  if (d.satelite && d.entrada && d.entrada.tipo === 'sat') {
    var s = d.satelite;
    html += '<div class="detalhe-secao">Satélite</div><table class="detalhe-tabela">';
    html += linha('Travado (locked)', fmtBool(s.travado));
    html += linha('C/N', fmtNum(s.cnDb, ' dB'));
    html += linha('Margem C/N', fmtNum(s.cnMargemDb, ' dB'));
    html += linha('BER', s.berE8 !== null ? (s.berE8 + 'e-8') : '—');
    html += linha('Potência', fmtNum(s.potenciaDbm, ' dBm'));
    html += linha('Frequência', s.frequenciaKHz ? (s.frequenciaKHz / 1000).toFixed(3) + ' MHz' : '—');
    html += linha('Taxa de símbolos', s.taxaSimbolos ? (s.taxaSimbolos / 1000).toFixed(0) + ' Msps' : '—');
    html += linha('Modulação', s.modulacao || '—');
    html += linha('FEC', s.fec || '—');
    html += linha('Modo', s.modo || '—');
    html += linha('Roll-off', s.rollOff || '—');
    html += linha('Pilots', fmtBool(s.pilots));
    html += '</table>';
  }

  html += '<div class="detalhe-secao">Rede</div><table class="detalhe-tabela">';
  html += linha('Interface', d.redeNome || '—');
  html += linha('Endereço', d.redeEndereco || '—');
  html += linha('Gateway', d.redeGateway || '—');
  html += '</table>';

  html += '<div class="detalhe-secao">Software</div><table class="detalhe-tabela">';
  html += linha('Versão', d.versaoSoftware || '—');
  html += '</table>';

  return html;
}

async function carregarDetalhe(item, elId) {
  const el = document.getElementById(elId);
  try {
    const r = await fetch('/api/maestro-detalhe?item=' + encodeURIComponent(item));
    const d = await r.json();
    if (!d.encontrado) { el.innerHTML = '<div class="empty">Sem leitura detalhada ainda para este item.</div>'; return; }
    el.innerHTML = montarTabelaDetalhe(d.detalhe) + '<div class="detalhe-atualizado">Atualizado ' + new Date(d.timestamp).toLocaleTimeString('pt-BR') + ' · atualiza sozinho a cada 30s</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty">Erro ao buscar detalhes.</div>';
  }
}

async function verDetalhe(item, elId) {
  const el = document.getElementById(elId);
  if (el.style.display === 'block') {
    el.style.display = 'none';
    if (detalheTimers[elId]) { clearInterval(detalheTimers[elId]); delete detalheTimers[elId]; }
    return;
  }
  el.style.display = 'block';
  el.innerHTML = 'Carregando...';
  await carregarDetalhe(item, elId);
  detalheTimers[elId] = setInterval(function () { carregarDetalhe(item, elId); }, 30000);
}
</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(pageShell('Painel', corpo + script, { nome: session.nome }));
}
