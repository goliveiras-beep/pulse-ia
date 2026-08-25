// lib/routes/maestro-booking-checagem.js - MAESTRO / Booking / Checagem de pendências
// Ve checar_booking_manha_e_noite.md - por enquanto só o lado Airtable (a parte de
// cruzar com Gmail ainda não está integrada, falta decidir qual caixa ler). Só
// alerta, nunca grava - a tabela Booking é sincronizada e não confirmamos se
// UPDATE funciona nela.
export const config = { maxDuration: 30 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { checarPendenciasBooking } from '../booking/checagem.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBrt(iso) {
  if (!iso) return '(sem data)';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

function badgePrioridade(p) {
  const cls = p === 'ALTA PRIORIDADE' ? 'badge-red' : p === 'PENDÊNCIA DE TESTE' ? 'badge-amber' : 'badge-green';
  return `<span class="badge ${cls}">${esc(p)}</span>`;
}

function renderAlerta(a) {
  return `
    <div class="item-row" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="item-nome">${esc(a.nome)}</div>
        ${badgePrioridade(a.prioridade)}
      </div>
      <div class="item-obs">${esc(a.competicao || '')} · ${fmtBrt(a.inicioBrt)} · Status: ${esc(a.status || '(sem status)')}${a.contato ? ' · Contato: ' + esc(a.contato) : ''}</div>
      <ul style="margin:2px 0 0 18px;font-size:11px;color:var(--text2)">
        ${a.pendencias.map(p => `<li>${esc(p)}</li>`).join('')}
        <li style="color:var(--text3)">Evidência no Gmail: (integração ainda não configurada)</li>
      </ul>
    </div>`;
}

function renderResultado(r) {
  const resumo = r.resumo;
  const semDivergencias = resumo.altaPrioridade === 0 && resumo.pendenciaDeTeste === 0;

  return `
    <div style="text-align:right;margin-bottom:8px">
      <a class="btn-sm" href="/api/maestro-booking-checagem?modo=manha" style="display:inline-block">☀️ Rodar como manhã (24h)</a>
      <a class="btn-sm" href="/api/maestro-booking-checagem?modo=noite" style="display:inline-block">🌙 Rodar como noite (dia seguinte)</a>
      <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block">📄 Extrair documento</a>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Resumo operacional — modo "${esc(r.modo)}"</span></div>
      <div class="card-body" style="padding:0">
        ${[
          ['Eventos analisados', resumo.totalAnalisados],
          ['OK', resumo.ok],
          ['Alta prioridade', resumo.altaPrioridade],
          ['Pendência de teste', resumo.pendenciaDeTeste],
        ].map(([l, v]) => `<div class="item-row"><div class="item-nome">${l}</div><div class="item-obs">${v}</div></div>`).join('')}
      </div>
    </div>
    ${semDivergencias
      ? `<div class="critico-banner" style="background:var(--green-m-bg);border-color:var(--green-m-border);color:var(--green-m-v)">Booking validado. Não foram encontradas divergências relevantes na janela analisada.</div>`
      : `<div class="card">
          <div class="card-header"><span class="card-title">Alertas</span></div>
          <div class="card-body" style="padding:0">${r.alertas.map(renderAlerta).join('')}</div>
        </div>`
    }
    ${r.ok.length ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Eventos OK (${r.ok.length})</span></div>
        <div class="card-body" style="padding:0">
          ${r.ok.map(e => `<div class="item-row"><div class="item-nome">${esc(e.nome)}</div></div>`).join('')}
        </div>
      </div>` : ''}
    <div class="card">
      <div class="card-body" style="text-align:center;color:var(--text3);font-size:12px">
        Checagem só do lado Airtable por enquanto — a comparação com e-mails do Gmail ainda não
        está integrada (falta decidir qual caixa ler). Sem execução automática ainda: hoje é
        preciso abrir esta página manualmente.
      </div>
    </div>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const modo = req.query.modo === 'noite' ? 'noite' : 'manha';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const resultado = await checarPendenciasBooking(modo);
    return res.status(200).send(pageShell('Booking — checagem', renderResultado(resultado), session));
  } catch (err) {
    console.error('maestro-booking-checagem error:', err);
    return res.status(200).send(pageShell('Booking — checagem', `<div class="critico-banner">Falha ao checar: ${esc(err.message)}</div>`, session));
  }
}
