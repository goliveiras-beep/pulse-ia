// lib/routes/maestro-booking.js - MAESTRO / Booking (extracao de parametros de sinal)
// Modulo 1 (extracao) ja funciona; Modulo 2 (gravacao no Airtable) ainda nao -
// falta AIRTABLE_PAT com escrita e confirmar a tabela tblJZ3r5lAapjcCll (ver
// pendencia registrada no commit da fundacao). Por isso esta tela SO mostra o
// resultado da extracao pra revisao visual - nao grava nada ainda.
// Sem efeito de verdade (quem a Vercel le e o config de api/maestro-bundle.js, que importa
// este arquivo) - mantido so pra bater com a convencao que os outros arquivos de lib/routes
// ja seguem. O maxDuration real esta em api/maestro-bundle.js.
export const config = { maxDuration: 60 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { extrairDocumento } from '../booking/extract.js';
import { textoDeArquivo, DocumentoEscaneadoError } from '../booking/extract-text.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function badgeConfianca(nivel) {
  if (!nivel || nivel === 'high') return '';
  const cls = nivel === 'low' ? 'badge-red' : 'badge-amber';
  return ` <span class="badge ${cls}">confiança ${esc(nivel)} — confirmar</span>`;
}

function linha(label, valor, confianca) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<div class="item-row"><div class="item-nome" style="flex:0 0 220px">${esc(label)}</div><div class="item-obs" style="flex:1;font-size:12px;color:var(--text)">${esc(valor)}${badgeConfianca(confianca)}</div></div>`;
}

function confiancaDe(mapa, caminho) {
  return mapa?.[caminho];
}

function renderCaminho(caminho, idx, confidence) {
  const c = (campo) => confiancaDe(confidence, `signalPaths.${idx}.${campo}`);
  const linhas = [
    linha('Meio', `${caminho.medium} · ${caminho.role}`),
    linha('Rótulo', caminho.label),
    linha('Origem → Destino', [caminho.origin, caminho.destination].filter(Boolean).join(' → ')),
    linha('Início / Fim (UTC)', [caminho.startUtc, caminho.endUtc].filter(Boolean).join(' — ')),
  ];

  if (caminho.satellite) {
    const s = caminho.satellite;
    linhas.push(
      linha('Satélite', s.satelliteName, c('satellite.satelliteName')),
      linha('Transponder / Canal', [s.transponder, s.channel].filter(Boolean).join(' / '), c('satellite.channel')),
      linha('Uplink', s.uplinkFreqMhz ? `${s.uplinkFreqMhz} MHz ${s.uplinkPolarization || ''}` : null, c('satellite.uplinkFreqMhz')),
      linha('Downlink', s.downlinkFreqMhz ? `${s.downlinkFreqMhz} MHz ${s.downlinkPolarization || ''}` : null, c('satellite.downlinkFreqMhz')),
      linha('Modulação / FEC', [s.modulation, s.fec].filter(Boolean).join(' / '), c('satellite.modulation')),
      linha('Symbol Rate', s.symbolRateMsps ? `${s.symbolRateMsps} Msps` : null, c('satellite.symbolRateMsps')),
    );
  }
  if (caminho.ip) {
    const ip = caminho.ip;
    linhas.push(
      linha('Protocolo / Modo', [ip.protocol, ip.mode].filter(Boolean).join(' / '), c('ip.protocol')),
      linha('URL / Host:Porta', ip.url || (ip.host ? `${ip.host}:${ip.port ?? ''}` : null), c('ip.url')),
      linha('Latência mínima', ip.minLatencyMs ? `${ip.minLatencyMs} ms` : null, c('ip.minLatencyMs')),
      linha('Recurso', ip.resourceName, c('ip.resourceName')),
      linha('Whitelist CIDR', (ip.whitelistCidrs || []).join(', ') || null),
    );
  }
  if (caminho.fiber) {
    const f = caminho.fiber;
    linhas.push(
      linha('Fibra', f.serviceDescription, c('fiber.serviceDescription')),
      linha('Banda', f.bandwidthMbps ? `${f.bandwidthMbps} Mbps` : null),
      linha('Duração do sinal', f.durationMinutes ? `${f.durationMinutes} min` : null),
    );
  }
  if (caminho.video) {
    const v = caminho.video;
    linhas.push(linha('Vídeo', [v.standard, v.codec, v.chromaSubsampling].filter(Boolean).join(' · ')));
  }
  if (caminho.encryption) {
    linhas.push(linha('Criptografia', `${caminho.encryption.type}${caminho.encryption.key ? ' — ' + caminho.encryption.key : ''}`, c('encryption.key')));
  }
  if (caminho.audio?.length) {
    linhas.push(linha('Áudio', caminho.audio.map(a => `${String(a.channel).padStart(2, '0')}:${a.label}`).join('  ')));
  }

  return `
    <div class="card">
      <div class="card-header"><span class="card-title">Caminho ${idx + 1} — ${esc(caminho.medium)} (${esc(caminho.role)})</span></div>
      <div class="card-body" style="padding:0">${linhas.filter(Boolean).join('')}</div>
    </div>`;
}

function renderResultado(resultado, nomeArquivo) {
  const { event, confidence, warnings } = resultado;
  const c = (campo) => confiancaDe(confidence, campo);

  const avisosHtml = warnings.length
    ? `<div class="critico-banner" style="background:var(--amber-m-bg);border-color:var(--amber-m-border);color:var(--amber-m-v)">
        ⚠️ ${warnings.length} aviso(s) da extração
        <ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>`
    : '';

  const pendentes = Object.entries(confidence).filter(([, v]) => v === 'medium' || v === 'low');

  return `
    <div class="card">
      <div class="card-header"><span class="card-title">📄 ${esc(nomeArquivo)}</span></div>
      <div class="card-body" style="padding:0">
        ${linha('Fornecedor', `${event.sourceRef.provider} · ${event.sourceRef.referenceType} · ${event.sourceRef.referenceNumber ?? '(sem referência)'}`, c('sourceRef.referenceNumber'))}
        ${event.sourceRef.version ? linha('Versão / Amendment', [event.sourceRef.version, event.sourceRef.amendment].filter(v => v != null).join(' / amd ')) : ''}
        ${event.sourceRef.secondaryRefs?.length ? linha('Referências secundárias', event.sourceRef.secondaryRefs.join(', ')) : ''}
        ${linha('Evento', event.eventName, c('eventName'))}
        ${linha('Competição / Rodada', [event.competition, event.round].filter(Boolean).join(' — '), c('competition'))}
        ${linha('Times', [event.homeTeam, event.awayTeam].filter(Boolean).join(' × '), c('homeTeam'))}
        ${linha('Local', event.venue)}
        ${linha('Início (UTC)', event.transmissionStartUtc, c('transmissionStartUtc'))}
        ${linha('Fim (UTC)', event.transmissionEndUtc, c('transmissionEndUtc'))}
        ${linha('Kickoff (UTC)', event.kickoffUtc, c('kickoffUtc'))}
        ${linha('Data do jogo (BRT)', event.matchDateBrt)}
      </div>
    </div>
    ${event.signalPaths.map((p, i) => renderCaminho(p, i, confidence)).join('')}
    ${avisosHtml}
    ${pendentes.length ? `<div class="critico-banner">🔎 ${pendentes.length} campo(s) com confiança média/baixa — confirme antes de considerar gravado.</div>` : ''}
    <div class="card">
      <div class="card-body" style="text-align:center;color:var(--text3);font-size:12px">
        Gravação no Airtable ainda não está disponível nesta tela — falta configurar o token de escrita e confirmar a tabela de destino.
        Por enquanto, use os dados acima só pra conferência visual.
      </div>
    </div>
    <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block;margin-top:8px">← Extrair outro documento</a>`;
}

function formularioUpload(erro) {
  return `
    <div class="card">
      <div class="card-header"><span class="card-title">📄 Booking — extração de parâmetros de sinal</span></div>
      <div class="card-body">
        <p style="font-size:12px;color:var(--text3);margin-bottom:12px">
          Envie o documento do fornecedor (PDF, DOCX, EML ou TXT) com os parâmetros de sinal — o modelo extrai
          os dados automaticamente e mostra pra revisão. Ainda não grava no Airtable.
        </p>
        <p style="font-size:12px;margin-bottom:12px">
          <a href="/api/maestro-booking-dia">🗓️ Grade do dia (parâmetros por evento)</a>
          ·
          <a href="/api/maestro-booking-checagem">🔎 Ver checagem de pendências (eventos com parâmetro faltando)</a>
          ·
          <a href="/api/maestro-booking-config">⚙️ Configurar quais parâmetros contam por meio</a>
        </p>
        ${erro ? `<div class="critico-banner" style="margin-bottom:12px">${esc(erro)}</div>` : ''}
        <form method="POST" action="/api/maestro-booking" enctype="multipart/form-data">
          <div class="form-row">
            <input type="file" name="documento" accept=".pdf,.docx,.eml,.txt" required style="flex:1">
            <button class="btn-primary" type="submit">Extrair</button>
          </div>
        </form>
      </div>
    </div>`;
}

function parseMultipart(body, boundary) {
  const sep = Buffer.from(`\r\n--${boundary}`);
  let fileBuffer = null, fileName = null, mimeType = 'application/octet-stream';
  let pos = body.indexOf(Buffer.from(`--${boundary}`));
  while (pos !== -1) {
    const next = body.indexOf(sep, pos + 1);
    const part = body.slice(pos + boundary.length + 4, next === -1 ? body.length : next);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString();
      const data = part.slice(headerEnd + 4);
      if (headers.includes('filename=')) {
        const nameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) fileName = nameMatch[1];
        const typeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
        if (typeMatch) mimeType = typeMatch[1].trim();
        fileBuffer = data.slice(-2).toString() === '\r\n' ? data.slice(0, -2) : data;
      }
    }
    pos = next;
  }
  return { fileBuffer, fileName, mimeType };
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(pageShell('Booking', formularioUpload(), session));
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido' });

  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new Error('Envie multipart/form-data com o campo "documento".');
    }
    const boundary = contentType.split('boundary=')[1]?.split(';')[0]?.trim();
    if (!boundary) throw new Error('Boundary não encontrado no upload.');

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const { fileBuffer, fileName, mimeType } = parseMultipart(body, boundary);

    if (!fileBuffer || fileBuffer.length < 10) throw new Error('Arquivo não encontrado no upload.');
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurado no projeto.');

    const texto = await textoDeArquivo({ buffer: fileBuffer, fileName, mimeType });
    const resultado = await extrairDocumento(texto, { nomeArquivo: fileName });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(pageShell('Booking — revisão', renderResultado(resultado, fileName), session));
  } catch (err) {
    const msg = err instanceof DocumentoEscaneadoError
      ? err.message
      : `Falha na extração: ${err.message}`;
    console.error('maestro-booking error:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(pageShell('Booking', formularioUpload(msg), session));
  }
}
