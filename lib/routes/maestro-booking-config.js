// lib/routes/maestro-booking-config.js - MAESTRO / Booking / Configuração de parâmetros
// Tela pra marcar, por meio de recepção, quais campos do Airtable contam como "parâmetro
// preenchido" na checagem de pendências (lib/booking/checagem.js) - sem precisar programar.
export const config = { maxDuration: 30 };
import { getPulseSession } from '../maestro-session.js';
import { pageShell } from '../maestro-layout.js';
import { getMapaCamposPorMeio, salvarMapaCamposPorMeio, CAMPOS_CANDIDATOS_POR_MEIO } from '../booking/config.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function idCampo(meio, campo) {
  return `c_${meio}_${campo}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

function renderMeio(meio, candidatos, marcados) {
  return `
    <div class="card">
      <div class="card-header"><span class="card-title">${meio}</span></div>
      <div class="card-body">
        <p style="font-size:11px;color:var(--text3);margin-bottom:8px">
          Marque quais campos, se preenchidos, já contam como "parâmetro de ${esc(meio)} ok" — basta
          UM deles preenchido pro evento não entrar na checagem de pendência.
        </p>
        ${candidatos.map((campo) => `
          <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;cursor:pointer">
            <input type="checkbox" name="${idCampo(meio, campo)}" ${marcados.includes(campo) ? 'checked' : ''}>
            ${esc(campo)}
          </label>`).join('')}
      </div>
    </div>`;
}

function renderForm(mapa, banner) {
  const meios = Object.keys(CAMPOS_CANDIDATOS_POR_MEIO);
  return `
    ${banner || ''}
    <div style="text-align:right;margin-bottom:8px">
      <a class="btn-sm" href="/api/maestro-booking-checagem" style="display:inline-block">🔎 Ver checagem</a>
      <a class="btn-sm" href="/api/maestro-booking" style="display:inline-block">📄 Extrair documento</a>
    </div>
    <form method="POST" action="/api/maestro-booking-config">
      ${meios.map((meio) => renderMeio(meio, CAMPOS_CANDIDATOS_POR_MEIO[meio], mapa[meio] || [])).join('')}
      <div class="card">
        <div class="card-body" style="text-align:center">
          <button class="btn-primary" type="submit">Salvar configuração</button>
        </div>
      </div>
    </form>
    <div class="card">
      <div class="card-body" style="text-align:center;color:var(--text3);font-size:12px">
        TVU, SAT 4K e RTMP ainda não têm campo técnico mapeado no Airtable pra checar — só entram
        na lista quando alguém confirmar quais colunas usar pra eles.
      </div>
    </div>`;
}

export default async function handler(req, res) {
  const session = getPulseSession(req);
  if (!session) return res.redirect(302, '/api/app');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (req.method === 'GET') {
    try {
      const mapa = await getMapaCamposPorMeio();
      return res.status(200).send(pageShell('Booking — configuração', renderForm(mapa), session));
    } catch (err) {
      console.error('maestro-booking-config GET error:', err);
      return res.status(200).send(pageShell('Booking — configuração', `<div class="critico-banner">Falha ao carregar: ${esc(err.message)}</div>`, session));
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido' });

  try {
    const body = req.body && Object.keys(req.body).length ? req.body : await lerBodyFormUrlEncoded(req);
    const novoMapa = {};
    for (const [meio, candidatos] of Object.entries(CAMPOS_CANDIDATOS_POR_MEIO)) {
      novoMapa[meio] = candidatos.filter((campo) => body[idCampo(meio, campo)] !== undefined);
    }
    await salvarMapaCamposPorMeio(novoMapa);
    const banner = `<div class="critico-banner" style="background:var(--green-m-bg);border-color:var(--green-m-border);color:var(--green-m-v)">✅ Configuração salva.</div>`;
    return res.status(200).send(pageShell('Booking — configuração', renderForm(novoMapa, banner), session));
  } catch (err) {
    console.error('maestro-booking-config POST error:', err);
    const mapa = await getMapaCamposPorMeio().catch(() => ({}));
    return res.status(200).send(pageShell('Booking — configuração', renderForm(mapa, `<div class="critico-banner">Falha ao salvar: ${esc(err.message)}</div>`), session));
  }
}

// Vercel normalmente já faz o parse de application/x-www-form-urlencoded em req.body, mas
// esse fallback cobre o caso de vir vazio (mesmo padrão defensivo dos outros forms do Pulse).
async function lerBodyFormUrlEncoded(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  return Object.fromEntries(params.entries());
}
