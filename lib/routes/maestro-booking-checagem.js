// lib/routes/maestro-booking-checagem.js - MAESTRO / Booking / Checagem de pendências
// Ve checar_booking_manha_e_noite.md - por enquanto só o lado Airtable (a parte de
// cruzar com Gmail ainda não está integrada, falta decidir qual caixa ler). Só
// alerta, nunca grava - a tabela Booking é sincronizada e não confirmamos se
// UPDATE funciona nela.
export const config = { maxDuration: 30 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { checarPendenciasBooking, debugCamposBookingTodos } from '../booking/checagem.js';
import { testarConexaoGmail } from '../booking/gmail.js';
import { getBRT, fmtData, fmtAirtable, parseAirtableStr, DIAS_PT } from '../booking/grade-dia.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBrt(iso) {
  if (!iso) return '(sem data)';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

const ICONE_MEIO = { 'Satélite': '📡', SRT: '🌐', Fibra: '🔌', LiveU: '📶', Decoder: '🖥️', 'Vídeo': '🎞️', 'Áudio': '🔊' };

function iniciais(nome) {
  return String(nome || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

// selo redondo por caminho/parametro, no mesmo espirito do avatar de pessoa que a Home usa
function selo(meio, bg, cor) {
  const texto = meio ? (ICONE_MEIO[meio] || iniciais(meio)) : '⚠️';
  return `<div style="width:26px;height:26px;border-radius:50%;background:${bg};color:${cor};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${texto}</div>`;
}

// cores por prioridade, no mesmo padrao das variaveis de card que a Home ja usa (bc/bb/itc)
function coresPrioridade(p) {
  if (p === 'ALTA PRIORIDADE') return { bg: 'var(--red-m-bg)', border: 'var(--red-m-border)', texto: 'var(--red-m-v)' };
  if (p === 'PENDÊNCIA DE TESTE') return { bg: 'var(--amber-m-bg)', border: 'var(--amber-m-border)', texto: 'var(--amber-m-v)' };
  return { bg: 'var(--green-m-bg)', border: 'var(--green-m-border)', texto: 'var(--green-m-v)' };
}

function badgeMeio(meio, ativo) {
  const cor = ativo ? 'var(--red-m-v)' : 'var(--text3)';
  const bg = ativo ? 'var(--red-m-bg)' : 'var(--bg3)';
  const sufixo = ativo ? ' faltando' : ' ok';
  return `<span style="background:${bg};border-radius:5px;padding:2px 7px;font-size:10px;font-weight:800;color:${cor}">${ICONE_MEIO[meio] || ''} ${esc(meio)}${sufixo}</span>`;
}

// cartao de evento no estilo dos cartoes de evento da Home (barra colorida no topo com
// hora/status, corpo com uma linha por item) - so que aqui cada "pessoa" da Home virou um
// parametro/meio faltando, em vez de um nome.
function renderCartaoEvento(a) {
  const cores = coresPrioridade(a.prioridade);
  const dataHora = fmtBrt(a.inicioBrt);
  const meiosDeclarados = a.meios || [];
  const meiosComPendencia = new Set(a.pendencias.map(p => p.meio).filter(Boolean));

  return `
    <div style="border:1px solid ${cores.border};border-radius:8px;margin-bottom:10px;overflow:hidden">
      <div style="background:${cores.bg};padding:8px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:12px;font-weight:700;color:${cores.texto};min-width:78px">${esc(dataHora)}</div>
        <div style="flex:1;min-width:140px">
          <div style="font-size:12px;font-weight:700;color:var(--text);word-break:break-word">${esc(a.nome)}</div>
          <div style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">
            ${a.competicao ? esc(a.competicao) : ''}
            ${a.status ? `<span style="font-weight:600;color:var(--text2)">${esc(a.status)}</span>` : ''}
            ${meiosDeclarados.map(m => badgeMeio(m, meiosComPendencia.has(m))).join('')}
            ${meiosComPendencia.has('Decoder') ? badgeMeio('Decoder', true) : ''}
          </div>
        </div>
        <div style="font-size:10px;font-weight:700;color:${cores.texto};white-space:nowrap">${esc(a.prioridade)}</div>
      </div>
      <div style="padding:6px 12px;background:var(--bg2)">
        <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:2px">❌ O que falta preencher no Airtable</div>
        ${a.pendencias.map(p => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border2)">
            ${selo(p.meio, cores.bg, cores.texto)}
            <span style="flex:1;font-size:11px;font-weight:600">${p.meio ? esc(p.meio) : 'Meio de recepção'}</span>
            <span style="font-size:10px;color:var(--text3);text-align:right;max-width:55%">${esc(p.mensagem)}</span>
          </div>`).join('')}
        ${renderFichaTecnica(a.valoresTecnicos)}
        ${renderEvidenciaGmail(a.emailsRelacionados)}
      </div>
    </div>`;
}

// ficha tecnica: valores ja preenchidos no Airtable por meio (IP/porta do SRT, transponder
// do satelite, etc.), num formato tabela/monoespacado pra ler rapido e copiar - é o pedido
// de "visual mais prático pra ver IP e etc" em vez de só o aviso de pendência.
function renderFichaTecnica(valoresTecnicos) {
  const meios = Object.keys(valoresTecnicos || {});
  if (!meios.length) return '';
  return `
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border2)">
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">🔧 Parâmetros já preenchidos</div>
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

function renderEvidenciaGmail(emails) {
  if (!emails || !emails.length) {
    return `
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border2)">
        <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:2px">📧 E-mails que podem ter esse parâmetro</div>
        <div style="text-align:center;padding:4px 0;font-size:10px;color:var(--text4)">Nenhum encontrado nos últimos 30 dias</div>
      </div>`;
  }
  return `
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border2)">
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">📧 E-mails que podem ter esse parâmetro (${emails.length}) — arquivados automaticamente na Central de Conhecimento</div>
      ${emails.map((e) => `
        <div style="padding:4px 0;font-size:10px;color:var(--text3)">
          <div style="font-weight:600;color:var(--text2)">${esc(e.assunto || '(sem assunto)')}</div>
          <div>${esc(e.de || '')} · ${esc(e.data || '')}</div>
          ${e.arquivado ? `<div style="color:var(--green-m-v)">✅ Salvo em Central de Conhecimento → Booking</div>` : ''}
          ${e.erroArquivamento ? `<div style="color:var(--red-m-v)">⚠️ Falha ao salvar: ${esc(e.erroArquivamento)}</div>` : ''}
          ${e.pendenteDeArquivamento ? `<div style="color:var(--text4)">⏳ Ainda vai ser salvo (fica pra próxima checagem)</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderCartaoOk(e, i) {
  const cores = coresPrioridade('OK');
  const temFicha = e.valoresTecnicos && Object.keys(e.valoresTecnicos).length > 0;
  const idFicha = `ficha-ok-${i}`;
  return `
    <div style="border:1px solid ${cores.border};border-radius:8px;margin-bottom:8px;overflow:hidden">
      <div style="background:${cores.bg};padding:8px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:${temFicha ? 'pointer' : 'default'}" ${temFicha ? `onclick="var el=document.getElementById('${idFicha}');el.style.display=el.style.display==='none'?'block':'none';"` : ''}>
        <div style="font-size:12px;font-weight:700;color:${cores.texto};min-width:78px">${esc(fmtBrt(e.inicioBrt))}</div>
        <div style="flex:1;min-width:140px;font-size:12px;font-weight:700;color:var(--text);word-break:break-word">${esc(e.nome)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${(e.meios || []).map(m => badgeMeio(m, false)).join('')}</div>
        <div style="font-size:10px;font-weight:700;color:${cores.texto};white-space:nowrap">OK${temFicha ? ' 🔧' : ''}</div>
      </div>
      ${temFicha ? `<div id="${idFicha}" style="display:none;padding:6px 12px;background:var(--bg2)">${renderFichaTecnica(e.valoresTecnicos)}</div>` : ''}
    </div>`;
}

// Rotulo do cabecalho do carrossel de dia - mesma ideia da Grade do dia (lib/booking/
// grade-dia.js), so que aqui a "data corrente" e derivada do resultado da checagem (que
// pode ter vindo de modo=manha/noite OU de um dia especifico navegado).
function renderLabelDia(dataAirtable, totalEventos) {
  const d = parseAirtableStr(dataAirtable);
  const hoje = getBRT(); hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const offset = Math.round((d - hoje) / 86400000);
  const icone = offset === 0 ? '🟢' : offset === 1 ? '📅' : '🗓️';
  return `<span class="card-title">${icone} ${esc(fmtData(d))}</span>
    <span class="badge blue" style="margin-left:4px">${totalEventos} eventos</span>
    <span style="font-size:10px;color:var(--text3);margin-left:6px">${DIAS_PT[d.getDay()]}</span>`;
}

// Parte que muda ao navegar de dia (resumo + eventos) - o resto da pagina (intro, legenda,
// botoes, banner do Gmail) fica fixo e so essa parte e re-buscada via fetch, igual o
// carrossel da Grade do dia.
function renderCorpo(r) {
  const resumo = r.resumo;
  const semDivergencias = resumo.altaPrioridade === 0 && resumo.pendenciaDeTeste === 0;

  const stat = (label, valor, cor) => `
    <div style="flex:1 1 calc(50% - 6px);min-width:90px;box-sizing:border-box;text-align:center;padding:10px 6px">
      <div style="font-size:20px;font-weight:800;color:${cor || 'var(--text)'}">${valor}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px">${label}</div>
    </div>`;

  return `
    <div class="card">
      <div class="card-header"><span class="card-title">Resumo</span></div>
      <div class="card-body" style="display:flex;flex-wrap:wrap;gap:0;padding:0">
        ${stat('Eventos analisados', resumo.totalAnalisados)}
        ${stat('OK', resumo.ok, 'var(--green-m-v)')}
        ${stat('Alta prioridade', resumo.altaPrioridade, 'var(--red-m-v)')}
        ${stat('Pendência de teste', resumo.pendenciaDeTeste, 'var(--amber-m-v)')}
      </div>
    </div>
    ${r.ok.length ? `
      <div style="margin-bottom:4px;font-size:12px;font-weight:700;color:var(--text2)">Eventos OK (${r.ok.length})</div>
      ${r.ok.map(renderCartaoOk).join('')}` : ''}
    ${semDivergencias
      ? `<div class="critico-banner" style="background:var(--green-m-bg);border-color:var(--green-m-border);color:var(--green-m-v)">✅ Booking validado. Não foram encontradas divergências relevantes na janela analisada.</div>`
      : `<div style="margin:14px 0 4px;font-size:12px;font-weight:700;color:var(--text2)">Eventos com pendência</div>
        ${r.alertas.map(renderCartaoEvento).join('')}`
    }
    <div class="card">
      <div class="card-body" style="text-align:center;color:var(--text3);font-size:12px">
        O arquivamento automático de e-mail no Drive só roda pra "hoje" — nos outros dias
        (‹ ›) a tela só mostra o que falta e a lista de e-mails, sem arquivar ainda.
      </div>
    </div>`;
}

function renderResultado(r, gmailStatus) {
  const gmailBanner = gmailStatus
    ? gmailStatus.ok
      ? `<div class="critico-banner" style="background:var(--green-m-bg);border-color:var(--green-m-border);color:var(--green-m-v)">✅ Gmail conectado: ${esc(gmailStatus.emailAddress)} (${gmailStatus.totalMensagens} mensagens na caixa)</div>`
      : `<div class="critico-banner">⚠️ Gmail não conectado: ${esc(gmailStatus.erro)}</div>`
    : '';

  return `
    <div class="card">
      <div class="card-body" style="font-size:12px;color:var(--text2);line-height:1.5">
        <b>O que é esta tela:</b> avisa quando um jogo que precisa de sinal (SRT, Satélite ou Fibra)
        ainda não tem os parâmetros técnicos preenchidos no Airtable, e mostra e-mails recentes que
        podem ter esse parâmetro (arquivados sozinhos na Central de Conhecimento, em Booking).
        Não escreve nada no Airtable — só avisa. Use ‹ › abaixo pra ver o que falta nos próximos dias.
        <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;font-size:11px">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--red-m-v);margin-right:4px"></span>Alta prioridade — evento em até 24h</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--amber-m-v);margin-right:4px"></span>Pendência de teste — mais tempo até o evento</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--green-m-v);margin-right:4px"></span>OK — sem pendência</span>
        </div>
      </div>
    </div>
    ${gmailBanner}
    <div style="text-align:right;margin-bottom:8px">
      <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block">📄 Extrair documento</a>
      <a class="btn-sm" href="/api/maestro-booking-dia" style="display:inline-block">🗓️ Grade do dia</a>
      <a class="btn-sm" href="/api/maestro-booking-config" style="display:inline-block">⚙️ Configurar parâmetros</a>
      <a class="btn-sm" href="/api/maestro-booking-checagem?data=${esc(r.dataAirtable)}&testarGmail=1" style="display:inline-block">🔗 Testar conexão Gmail</a>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;gap:6px">
        <button onclick="navChecagemDia(-1)" id="checagemBtnPrev" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8249;</button>
        <div style="flex:1;min-width:0;text-align:center" id="checagemLabel">${renderLabelDia(r.dataAirtable, r.resumo.totalAnalisados)}</div>
        <input type="date" id="checagemCalendario" onchange="irParaChecagemDia(this.value)" style="border:1px solid var(--border);border-radius:5px;background:none;color:var(--text2);font-size:11px;padding:2px 4px;flex-shrink:0" title="Ir para uma data">
        <button onclick="navChecagemDia(1)" id="checagemBtnNext" style="background:none;border:1px solid var(--border);border-radius:5px;width:24px;height:24px;cursor:pointer;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#8250;</button>
      </div>
      <div class="card-body" id="checagemCorpo" style="display:block">${renderCorpo(r)}</div>
    </div>
    <script>
      var _checagemDiaAtual = '${r.dataAirtable}';
      var _checagemCache = {};
      _checagemCache[_checagemDiaAtual] = { labelHtml: document.getElementById('checagemLabel').innerHTML, corpoHtml: document.getElementById('checagemCorpo').innerHTML };
      document.getElementById('checagemCalendario').value = _checagemDiaAtual;

      function checagemSomarDias(dataStr, dias) {
        var p = dataStr.split('-').map(Number);
        var d = new Date(p[0], p[1] - 1, p[2]);
        d.setDate(d.getDate() + dias);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      async function irParaChecagemDia(novaData) {
        if (!novaData || novaData === _checagemDiaAtual) return;
        var btnPrev = document.getElementById('checagemBtnPrev'), btnNext = document.getElementById('checagemBtnNext');
        var corpo = document.getElementById('checagemCorpo'), label = document.getElementById('checagemLabel');

        if (_checagemCache[novaData]) {
          label.innerHTML = _checagemCache[novaData].labelHtml;
          corpo.innerHTML = _checagemCache[novaData].corpoHtml;
          _checagemDiaAtual = novaData;
          document.getElementById('checagemCalendario').value = novaData;
          return;
        }

        btnPrev.disabled = true; btnNext.disabled = true;
        corpo.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Carregando…</div>';
        try {
          var r = await fetch('/api/maestro-booking-checagem?formato=json&data=' + novaData);
          var d = await r.json();
          if (d.error) throw new Error(d.error);
          label.innerHTML = d.labelHtml;
          corpo.innerHTML = d.corpoHtml;
          _checagemCache[novaData] = { labelHtml: d.labelHtml, corpoHtml: d.corpoHtml };
          _checagemDiaAtual = novaData;
          document.getElementById('checagemCalendario').value = novaData;
        } catch (e) {
          corpo.innerHTML = '<div class="critico-banner">Falha ao carregar esse dia: ' + e.message + '</div>';
        } finally {
          btnPrev.disabled = false; btnNext.disabled = false;
        }
      }

      function navChecagemDia(dir) {
        irParaChecagemDia(checagemSomarDias(_checagemDiaAtual, dir));
      }
    </script>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  if (req.query.debugPgm === '1') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(await debugCamposBookingTodos());
  }

  // Navegacao por dia (carrossel, igual Grade do dia) tem prioridade sobre modo=manha/noite
  // - "hoje" no carrossel equivale ao modo=manha (proximas 24h a partir de agora), qualquer
  // outro dia (inclusive amanha) checa o dia inteiro em BRT via checarPendenciasBooking(null, data).
  const dataParam = req.query.data;
  const hojeAirtable = fmtAirtable(getBRT());
  const usaDiaEspecifico = !!dataParam && dataParam !== hojeAirtable;

  if (req.query.formato === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const resultado = usaDiaEspecifico
        ? await checarPendenciasBooking(null, dataParam, false)
        : await checarPendenciasBooking('manha');
      return res.status(200).json({ labelHtml: renderLabelDia(resultado.dataAirtable || dataParam, resultado.resumo.totalAnalisados), corpoHtml: renderCorpo(resultado) });
    } catch (err) {
      console.error('maestro-booking-checagem (json) error:', err);
      return res.status(200).json({ error: err.message });
    }
  }

  let gmailStatus = null;
  if (req.query.testarGmail === '1') {
    try {
      const status = await testarConexaoGmail();
      gmailStatus = { ok: true, ...status };
    } catch (err) {
      gmailStatus = { ok: false, erro: err.message };
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const resultado = usaDiaEspecifico
      ? await checarPendenciasBooking(null, dataParam, false)
      : await checarPendenciasBooking('manha');
    if (!resultado.dataAirtable) resultado.dataAirtable = hojeAirtable;
    return res.status(200).send(pageShell('Booking — checagem', renderResultado(resultado, gmailStatus), session));
  } catch (err) {
    console.error('maestro-booking-checagem error:', err);
    return res.status(200).send(pageShell('Booking — checagem', `<div class="critico-banner">Falha ao checar: ${esc(err.message)}</div>`, session));
  }
}
