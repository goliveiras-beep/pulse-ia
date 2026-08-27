// lib/routes/maestro-booking-checagem.js - MAESTRO / Booking / Checagem de pendências
// Ve checar_booking_manha_e_noite.md - por enquanto só o lado Airtable (a parte de
// cruzar com Gmail ainda não está integrada, falta decidir qual caixa ler). Só
// alerta, nunca grava - a tabela Booking é sincronizada e não confirmamos se
// UPDATE funciona nela.
export const config = { maxDuration: 30 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { checarPendenciasBooking } from '../booking/checagem.js';
import { testarConexaoGmail } from '../booking/gmail.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBrt(iso) {
  if (!iso) return '(sem data)';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

const ICONE_MEIO = { 'Satélite': '📡', SRT: '🌐', Fibra: '🔌', LiveU: '📶' };

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
      <div style="background:${cores.bg};padding:8px 12px;display:flex;align-items:center;gap:10px">
        <div style="font-size:12px;font-weight:700;color:${cores.texto};min-width:78px">${esc(dataHora)}</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(a.nome)}</div>
          <div style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">
            ${a.competicao ? esc(a.competicao) : ''}
            ${a.status ? `<span style="font-weight:600;color:var(--text2)">${esc(a.status)}</span>` : ''}
            ${meiosDeclarados.map(m => badgeMeio(m, meiosComPendencia.has(m))).join('')}
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
        ${renderEvidenciaGmail(a.emailsRelacionados)}
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

function renderCartaoOk(e) {
  const cores = coresPrioridade('OK');
  return `
    <div style="border:1px solid ${cores.border};border-radius:8px;margin-bottom:8px;overflow:hidden">
      <div style="background:${cores.bg};padding:8px 12px;display:flex;align-items:center;gap:10px">
        <div style="font-size:12px;font-weight:700;color:${cores.texto};min-width:78px">${esc(fmtBrt(e.inicioBrt))}</div>
        <div style="flex:1;font-size:12px;font-weight:700;color:var(--text)">${esc(e.nome)}</div>
        <div style="display:flex;gap:4px">${(e.meios || []).map(m => badgeMeio(m, false)).join('')}</div>
        <div style="font-size:10px;font-weight:700;color:${cores.texto}">OK</div>
      </div>
    </div>`;
}

function renderResultado(r, gmailStatus) {
  const resumo = r.resumo;
  const semDivergencias = resumo.altaPrioridade === 0 && resumo.pendenciaDeTeste === 0;

  const stat = (label, valor, cor) => `
    <div style="flex:1;min-width:110px;text-align:center;padding:10px 6px">
      <div style="font-size:20px;font-weight:800;color:${cor || 'var(--text)'}">${valor}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px">${label}</div>
    </div>`;

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
        Não escreve nada no Airtable — só avisa.
        <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;font-size:11px">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--red-m-v);margin-right:4px"></span>Alta prioridade — evento em até 24h</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--amber-m-v);margin-right:4px"></span>Pendência de teste — mais tempo até o evento</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--green-m-v);margin-right:4px"></span>OK — sem pendência</span>
        </div>
      </div>
    </div>
    ${gmailBanner}
    <div style="text-align:right;margin-bottom:8px">
      <a class="btn-sm" href="/api/maestro-booking-checagem?modo=manha" style="display:inline-block">☀️ Rodar como manhã (24h)</a>
      <a class="btn-sm" href="/api/maestro-booking-checagem?modo=noite" style="display:inline-block">🌙 Rodar como noite (dia seguinte)</a>
      <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block">📄 Extrair documento</a>
      <a class="btn-sm" href="/api/maestro-booking-dia" style="display:inline-block">🗓️ Grade do dia</a>
      <a class="btn-sm" href="/api/maestro-booking-config" style="display:inline-block">⚙️ Configurar parâmetros</a>
      <a class="btn-sm" href="/api/maestro-booking-checagem?modo=${esc(r.modo)}&testarGmail=1" style="display:inline-block">🔗 Testar conexão Gmail</a>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Resumo — modo "${esc(r.modo)}" (${r.modo === 'manha' ? 'próximas 24h' : 'dia seguinte inteiro'})</span></div>
      <div class="card-body" style="display:flex;padding:0">
        ${stat('Eventos analisados', resumo.totalAnalisados)}
        ${stat('OK', resumo.ok, 'var(--green-m-v)')}
        ${stat('Alta prioridade', resumo.altaPrioridade, 'var(--red-m-v)')}
        ${stat('Pendência de teste', resumo.pendenciaDeTeste, 'var(--amber-m-v)')}
      </div>
    </div>
    ${semDivergencias
      ? `<div class="critico-banner" style="background:var(--green-m-bg);border-color:var(--green-m-border);color:var(--green-m-v)">✅ Booking validado. Não foram encontradas divergências relevantes na janela analisada.</div>`
      : `<div style="margin-bottom:4px;font-size:12px;font-weight:700;color:var(--text2)">Eventos com pendência</div>
        ${r.alertas.map(renderCartaoEvento).join('')}`
    }
    ${r.ok.length ? `
      <div style="margin:14px 0 4px;font-size:12px;font-weight:700;color:var(--text2)">Eventos OK (${r.ok.length})</div>
      ${r.ok.map(renderCartaoOk).join('')}` : ''}
    <div class="card">
      <div class="card-body" style="text-align:center;color:var(--text3);font-size:12px">
        Ainda sem execução automática desta tela — hoje é preciso abrir manualmente (☀️/🌙 acima) pra
        checar e arquivar. O que a checagem já faz sozinha: buscar e-mail relacionado e arquivar o PDF.
      </div>
    </div>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const modo = req.query.modo === 'noite' ? 'noite' : 'manha';

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
    const resultado = await checarPendenciasBooking(modo);
    return res.status(200).send(pageShell('Booking — checagem', renderResultado(resultado, gmailStatus), session));
  } catch (err) {
    console.error('maestro-booking-checagem error:', err);
    return res.status(200).send(pageShell('Booking — checagem', `<div class="critico-banner">Falha ao checar: ${esc(err.message)}</div>`, session));
  }
}
