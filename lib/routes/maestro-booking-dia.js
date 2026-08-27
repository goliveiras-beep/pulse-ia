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
import { salvarObservacao } from '../booking/observacoes.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function linhaParam(label, valor) {
  if (!valor) return '';
  return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border2)"><span style="font-size:10px;color:var(--text3);min-width:70px">${esc(label)}</span><span style="flex:1;font-size:11px;font-weight:600;text-align:right">${esc(valor)}</span></div>`;
}

const ICONE_MEIO = { 'Satélite': '📡', SRT: '🌐', Fibra: '🔌', LiveU: '📶' };

// mesma ideia da ficha tecnica da tela de checagem (lib/routes/maestro-booking-checagem.js)
// - duplicada aqui em vez de compartilhada, seguindo o padrao do resto do arquivo (cada
// arquivo de rota tem seus proprios helpers de render, ver CLAUDE.md).
function renderFichaTecnica(valoresTecnicos) {
  const meios = Object.keys(valoresTecnicos || {});
  if (!meios.length) return '';
  return `
    <div style="margin-top:4px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">🔧 Parâmetros técnicos</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${meios.map((meio) => `
          <div style="background:var(--bg3);border-radius:6px;padding:6px 8px">
            <div style="font-size:10px;font-weight:800;color:var(--text2);margin-bottom:3px;display:flex;align-items:center;gap:4px">${ICONE_MEIO[meio] || ''} ${esc(meio)}</div>
            ${valoresTecnicos[meio].map(({ campo, valor }) => {
              const texto = Array.isArray(valor) ? valor.join(', ') : String(valor);
              return `
              <div style="display:flex;align-items:center;gap:6px;padding:2px 0">
                <span style="font-size:9px;color:var(--text4);min-width:90px;flex-shrink:0">${esc(campo)}</span>
                <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;color:var(--text);flex:1;word-break:break-all">${esc(texto)}</span>
                <button onclick="event.stopPropagation();navigator.clipboard.writeText(this.dataset.v).then(()=>{this.textContent='✅';setTimeout(()=>{this.textContent='📋';},1200);})" data-v="${esc(texto)}" style="border:none;background:none;cursor:pointer;font-size:11px;padding:0 4px;flex-shrink:0" title="Copiar">📋</button>
              </div>`;
            }).join('')}
          </div>`).join('')}
      </div>
    </div>`;
}

// "Suporte" = contato de quem resolve problema de sinal (campos Contato/Contato Operadora
// de Satélite no Airtable, quando existirem). "Anexo" = arquivo de verdade anexado no
// Airtable (ex.: PDF com os parametros) - a base/origem do que foi preenchido.
function renderSuporte(suporte) {
  if (!suporte || !suporte.length) return '';
  return `
    <div style="margin-top:4px;background:var(--bg3);border-radius:6px;padding:6px 8px">
      <div style="font-size:10px;font-weight:800;color:var(--text2);margin-bottom:3px">🛟 Suporte</div>
      ${suporte.map((s) => `<div style="font-size:11px;color:var(--text);white-space:pre-line">${esc(s)}</div>`).join('')}
    </div>`;
}

function renderAnexos(anexos) {
  if (!anexos || !anexos.length) return '';
  return `
    <div style="margin-top:4px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:3px">📎 Anexo (origem do preenchimento)</div>
      ${anexos.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener" style="display:block;font-size:11px;color:var(--blue);text-decoration:underline;word-break:break-all">${esc(a.nome)}</a>`).join('')}
    </div>`;
}

// Nota livre por evento - guardada na planilha do Pulse (lib/booking/observacoes.js), nao
// no Airtable (tabela sincronizada, sem como criar campo novo la). idEv identifica o
// textarea/botao dentro do dia carregado (indice local, reseta a cada navegacao de dia).
function renderObservacao(ev, idEv) {
  const texto = ev.observacao || '';
  return `
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border2)">
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:3px">📝 Observação</div>
      <textarea id="obsTxt${idEv}" data-data="${esc(ev._dataAirtable)}" data-nome="${esc(ev.nome)}" placeholder="Anotação livre sobre esse evento…" style="width:100%;min-height:44px;font-size:11px;font-family:inherit;background:var(--bg);color:var(--text);border:1px solid var(--border2);border-radius:6px;padding:6px;resize:vertical">${esc(texto)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:3px">
        <button onclick="salvarObsBookingDia(${idEv})" id="obsBtn${idEv}" style="font-size:10px;border:1px solid var(--border);border-radius:5px;padding:3px 10px;background:none;color:var(--text2);cursor:pointer">💾 Salvar</button>
      </div>
    </div>`;
}

function renderEvento(ev, idEv) {
  const temFicha = ev.valoresTecnicos && Object.keys(ev.valoresTecnicos).length > 0;
  const meiosBadge = (ev.meiosBooking || []).map(m => `<span style="background:var(--bg3);border-radius:5px;padding:2px 7px;font-size:10px;font-weight:700;color:var(--text2)">${ICONE_MEIO[m] || ''} ${esc(m)}</span>`).join(' ');
  return `
    <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
      <div style="background:var(--bg3);padding:8px 12px;display:flex;align-items:center;gap:10px">
        <div style="font-size:13px;font-weight:700;color:var(--text);min-width:50px">${esc(ev.hora || '--')}${ev.horaFim ? `<br><span style="font-size:9px;font-weight:600;opacity:.6">–${esc(ev.horaFim)}</span>` : ''}</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(ev.nome)}</div>
          ${meiosBadge ? `<div style="margin-top:2px;display:flex;gap:4px;flex-wrap:wrap">${meiosBadge}</div>` : ''}
        </div>
      </div>
      <div style="padding:6px 12px;background:var(--bg2)">
        ${[linhaParam('Tipo', ev.tipo), linhaParam('Local', ev.local), linhaParam('Encoder', ev.encoder), linhaParam('Prime', ev.prime)].join('') || (temFicha ? '' : `<div style="text-align:center;padding:6px;color:var(--text3);font-size:11px">Sem parâmetros adicionais</div>`)}
        ${temFicha ? renderFichaTecnica(ev.valoresTecnicos) : ''}
        ${renderSuporte(ev.suporte)}
        ${renderAnexos(ev.anexos)}
        ${renderObservacao(ev, idEv)}
      </div>
    </div>`;
}

function renderDia(dia) {
  if (!dia.eventos.length) return `<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Nenhum evento</div>`;
  dia.eventos.forEach((ev) => { ev._dataAirtable = dia.dataAirtable; });
  return dia.eventos.map((ev, i) => renderEvento(ev, i)).join('');
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
        <input type="date" id="diaBookingCalendario" onchange="irParaDiaBooking(this.value)" style="border:1px solid var(--border);border-radius:5px;background:none;color:var(--text2);font-size:11px;padding:2px 4px;flex-shrink:0" title="Ir para uma data">
        <button onclick="navDiaBooking(1)" id="diaBookingBtnNext" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div class="card-body" style="max-height:600px;overflow-y:auto" id="diaBookingBody">${renderDia(diaInicial)}</div>
    </div>
    <script>
      var _diaBookingAtual = '${diaInicial.dataAirtable}';
      var _diaBookingCache = {}; // dataAirtable -> {label, sublabel, icone, eventosHtml, labelHtml, total}
      _diaBookingCache[_diaBookingAtual] = { labelHtml: document.getElementById('diaBookingLabel').innerHTML, bodyHtml: document.getElementById('diaBookingBody').innerHTML };
      document.getElementById('diaBookingCalendario').value = _diaBookingAtual;

      function diaBookingSomarDias(dataStr, dias) {
        var p = dataStr.split('-').map(Number);
        var d = new Date(p[0], p[1] - 1, p[2]);
        d.setDate(d.getDate() + dias);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      async function irParaDiaBooking(novaData) {
        if (!novaData || novaData === _diaBookingAtual) return;
        var btnPrev = document.getElementById('diaBookingBtnPrev'), btnNext = document.getElementById('diaBookingBtnNext');
        var body = document.getElementById('diaBookingBody'), label = document.getElementById('diaBookingLabel');

        if (_diaBookingCache[novaData]) {
          label.innerHTML = _diaBookingCache[novaData].labelHtml;
          body.innerHTML = _diaBookingCache[novaData].bodyHtml;
          _diaBookingAtual = novaData;
          document.getElementById('diaBookingCalendario').value = novaData;
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
          document.getElementById('diaBookingCalendario').value = novaData;
        } catch (e) {
          body.innerHTML = '<div class="critico-banner">Falha ao carregar esse dia: ' + e.message + '</div>';
        } finally {
          btnPrev.disabled = false; btnNext.disabled = false;
        }
      }

      function navDiaBooking(dir) {
        irParaDiaBooking(diaBookingSomarDias(_diaBookingAtual, dir));
      }

      async function salvarObsBookingDia(idEv) {
        var txt = document.getElementById('obsTxt' + idEv);
        var btn = document.getElementById('obsBtn' + idEv);
        var original = btn.textContent;
        btn.textContent = 'Salvando…'; btn.disabled = true;
        try {
          var r = await fetch('/api/maestro-booking-dia?action=observacao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: txt.dataset.data, nome: txt.dataset.nome, texto: txt.value }),
          });
          var d = await r.json();
          if (!d.ok) throw new Error(d.error || '?');
          btn.textContent = '✅ Salvo';
        } catch (e) {
          btn.textContent = '⚠️ Erro';
        } finally {
          setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 1600);
        }
      }
    </script>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  if (req.method === 'POST' && req.query.action === 'observacao') {
    const body = req.body || {};
    if (!body.data || !body.nome) return res.status(400).json({ error: 'Campos obrigatórios' });
    try {
      await salvarObservacao(body.data, body.nome, body.texto || '', session.nome);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('maestro-booking-dia observacao ERRO:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

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
