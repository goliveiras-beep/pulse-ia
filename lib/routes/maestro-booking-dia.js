// lib/routes/maestro-booking-dia.js - MAESTRO / Booking / Grade do dia
// Carrossel de 1 dia por vez (hoje..D+6, com < > pra navegar) mostrando os parametros
// de cada evento (tipo/local/encoder/prime) - sem nome de quem esta de plantao, so a
// grade tecnica. Mesma logica de dias que a Home tem, mas essa tela e do Booking.
export const config = { maxDuration: 30 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { montarDiasNav } from '../booking/grade-dia.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function linhaParam(label, valor) {
  if (!valor) return '';
  return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border2)"><span style="font-size:10px;color:var(--text3);min-width:70px">${esc(label)}</span><span style="flex:1;font-size:11px;font-weight:600;text-align:right">${esc(valor)}</span></div>`;
}

function renderEvento(ev) {
  return `
    <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
      <div style="background:var(--bg3);padding:8px 12px;display:flex;align-items:center;gap:10px">
        <div style="font-size:13px;font-weight:700;color:var(--text);min-width:50px">${esc(ev.hora || '--')}${ev.horaFim ? `<br><span style="font-size:9px;font-weight:600;opacity:.6">–${esc(ev.horaFim)}</span>` : ''}</div>
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--text)">${esc(ev.nome)}</div>
      </div>
      <div style="padding:6px 12px;background:var(--bg2)">
        ${[linhaParam('Tipo', ev.tipo), linhaParam('Local', ev.local), linhaParam('Encoder', ev.encoder), linhaParam('Prime', ev.prime)].join('') || `<div style="text-align:center;padding:6px;color:var(--text3);font-size:11px">Sem parâmetros adicionais</div>`}
      </div>
    </div>`;
}

function renderDia(dia) {
  if (!dia.eventos.length) return `<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Nenhum evento</div>`;
  return dia.eventos.map(renderEvento).join('');
}

function renderPagina(diasNav) {
  return `
    <div style="text-align:right;margin-bottom:8px">
      <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block">📄 Extrair documento</a>
      <a class="btn-sm" href="/api/maestro-booking-checagem" style="display:inline-block">🔎 Checagem de pendências</a>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;gap:6px">
        <button onclick="navDiaBooking(-1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
        <div style="flex:1;text-align:center">
          ${diasNav.map((d, i) => `<div id="diaBookingLabel-${i}" style="display:${i === 0 ? 'block' : 'none'}">
            <span class="card-title">${d.icone} ${esc(d.label)}</span>
            <span class="badge blue" style="margin-left:4px">${d.eventos.length} eventos</span>
            <span style="font-size:10px;color:var(--text3);margin-left:6px">${esc(d.sublabel)}</span>
          </div>`).join('')}
        </div>
        <button onclick="navDiaBooking(1)" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div class="card-body" style="max-height:600px;overflow-y:auto">
        ${diasNav.map((d, i) => `<div id="diaBooking-${i}" style="display:${i === 0 ? 'block' : 'none'}">${renderDia(d)}</div>`).join('')}
      </div>
    </div>
    <script>
      var _diaBookingAtual = 0, _diaBookingTotal = ${diasNav.length};
      function navDiaBooking(dir) {
        var novo = (_diaBookingAtual + dir + _diaBookingTotal) % _diaBookingTotal;
        var pA = document.getElementById('diaBooking-' + _diaBookingAtual), lA = document.getElementById('diaBookingLabel-' + _diaBookingAtual);
        var pN = document.getElementById('diaBooking-' + novo), lN = document.getElementById('diaBookingLabel-' + novo);
        if (pA) pA.style.display = 'none'; if (lA) lA.style.display = 'none';
        if (pN) pN.style.display = 'block'; if (lN) lN.style.display = 'block';
        _diaBookingAtual = novo;
      }
    </script>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const diasNav = await montarDiasNav();
    return res.status(200).send(pageShell('Booking — grade do dia', renderPagina(diasNav), session));
  } catch (err) {
    console.error('maestro-booking-dia error:', err);
    return res.status(200).send(pageShell('Booking — grade do dia', `<div class="critico-banner">Falha ao carregar: ${esc(err.message)}</div>`, session));
  }
}
