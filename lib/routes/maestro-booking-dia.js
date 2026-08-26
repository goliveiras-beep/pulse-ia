// lib/routes/maestro-booking-dia.js - MAESTRO / Booking / Grade do dia
// Carrossel de 1 dia por vez (< > pra navegar, sem limite de quantos dias pra frente/tras)
// mostrando os parametros de cada evento (tipo/local/encoder/prime) - sem nome de quem
// esta de plantao, so a grade tecnica. Mesma logica de dia que a Home tem, mas essa tela
// e do Booking.
//
// So o dia inicial (hoje) vem pre-renderizado do servidor; navegar pra outro dia busca
// via fetch (?formato=json&data=YYYY-MM-DD) e renderiza no cliente - assim nao ha um
// numero fixo de dias pre-carregados (a versao anterior travava em hoje..D+6) e nao
// dispara 30 chamadas de uma vez pro Airtable (que tem limite de 5 req/s por base).
export const config = { maxDuration: 30 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { montarDia, parseAirtableStr, getBRT } from '../booking/grade-dia.js';

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

function renderLabel(dia) {
  return `<span class="card-title">${dia.icone} ${esc(dia.label)}</span>
    <span class="badge blue" style="margin-left:4px">${dia.eventos.length} eventos</span>
    <span style="font-size:10px;color:var(--text3);margin-left:6px">${esc(dia.sublabel)}</span>`;
}

function renderPagina(diaInicial) {
  return `
    <div style="text-align:right;margin-bottom:8px">
      <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block">📄 Extrair documento</a>
      <a class="btn-sm" href="/api/maestro-booking-checagem" style="display:inline-block">🔎 Checagem de pendências</a>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;gap:6px">
        <button onclick="navDiaBooking(-1)" id="diaBookingBtnPrev" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
        <div style="flex:1;text-align:center" id="diaBookingLabel">${renderLabel(diaInicial)}</div>
        <button onclick="navDiaBooking(1)" id="diaBookingBtnNext" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div class="card-body" style="max-height:600px;overflow-y:auto" id="diaBookingBody">${renderDia(diaInicial)}</div>
    </div>
    <script>
      var _diaBookingAtual = '${diaInicial.dataAirtable}';
      var _diaBookingCache = {}; // dataAirtable -> {label, sublabel, icone, eventosHtml, labelHtml, total}
      _diaBookingCache[_diaBookingAtual] = { labelHtml: document.getElementById('diaBookingLabel').innerHTML, bodyHtml: document.getElementById('diaBookingBody').innerHTML };

      function diaBookingSomarDias(dataStr, dias) {
        var p = dataStr.split('-').map(Number);
        var d = new Date(p[0], p[1] - 1, p[2]);
        d.setDate(d.getDate() + dias);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      async function navDiaBooking(dir) {
        var novaData = diaBookingSomarDias(_diaBookingAtual, dir);
        var btnPrev = document.getElementById('diaBookingBtnPrev'), btnNext = document.getElementById('diaBookingBtnNext');
        var body = document.getElementById('diaBookingBody'), label = document.getElementById('diaBookingLabel');

        if (_diaBookingCache[novaData]) {
          label.innerHTML = _diaBookingCache[novaData].labelHtml;
          body.innerHTML = _diaBookingCache[novaData].bodyHtml;
          _diaBookingAtual = novaData;
          return;
        }

        btnPrev.disabled = true; btnNext.disabled = true;
        body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Carregando…</div>';
        try {
          var r = await fetch('/api/maestro-booking-dia?formato=json&data=' + novaData);
          var d = await r.json();
          if (d.error) throw new Error(d.error);
          label.innerHTML = d.labelHtml;
          body.innerHTML = d.bodyHtml;
          _diaBookingCache[novaData] = { labelHtml: d.labelHtml, bodyHtml: d.bodyHtml };
          _diaBookingAtual = novaData;
        } catch (e) {
          body.innerHTML = '<div class="critico-banner">Falha ao carregar esse dia: ' + e.message + '</div>';
        } finally {
          btnPrev.disabled = false; btnNext.disabled = false;
        }
      }
    </script>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const dataParam = req.query.data;
  const data = dataParam ? parseAirtableStr(dataParam) : getBRT();

  if (req.query.formato === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const dia = await montarDia(data);
      return res.status(200).json({ labelHtml: renderLabel(dia), bodyHtml: renderDia(dia) });
    } catch (err) {
      console.error('maestro-booking-dia (json) error:', err);
      return res.status(200).json({ error: err.message });
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const dia = await montarDia(data);
    return res.status(200).send(pageShell('Booking — grade do dia', renderPagina(dia), session));
  } catch (err) {
    console.error('maestro-booking-dia error:', err);
    return res.status(200).send(pageShell('Booking — grade do dia', `<div class="critico-banner">Falha ao carregar: ${esc(err.message)}</div>`, session));
  }
}
