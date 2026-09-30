// lib/routes/capacidade.js — Capacidade de produção (pessoas x estrutura), por fim de semana.
// Tela permanente pro gestor: cruza a grade do Airtable (por centro de produção/tier) com quem
// está de plantão na Escala (Central, sem Externa), pra todo fim de semana futuro que já tenha
// dado cadastrado nas duas fontes. Pedido do Guilherme em 2026-09-30 — ver conversa original pro
// racional completo (tierização: SW=tier1 peso 2, PD2-PD6=tier2 peso 1, PD1 automator=tier3 peso 1).
import { sheetsRequest } from '../google-auth.js';
import { getEventosDoDia, fmtAirtable, fmtData, getBRT } from '../booking/grade-dia.js';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const MAX_FINS_DE_SEMANA = 16; // ~4 meses de teto de segurança, pra nao rodar pra sempre sem dado

// Peso de pessoal por tier (pedido explícito do Guilherme): tier1 (estúdio) precisa de 2 pessoas
// por centro ativo, tier2 (PD manual) e tier3 (PD1, automator) precisam de 1 cada.
const PESO_TIER = { 1: 2, 2: 1, 3: 1 };
const CENTROS_TIER = { 1: 2, 2: 5, 3: 1 }; // SWA+SWB / PD2..PD6 / PD1
const CAPACIDADE_ESTRUTURAL = CENTROS_TIER[1] * PESO_TIER[1] + CENTROS_TIER[2] * PESO_TIER[2] + CENTROS_TIER[3] * PESO_TIER[3]; // = 10

function tierDoLocal(local) {
  if (!local) return null;
  if (/SWA|SWB/.test(local)) return 1;
  if (/\bPD1\b/.test(local)) return 3;
  if (/\bPD[2-6]\b/.test(local)) return 2;
  return null; // Central (Sem Narração), Externa, RJ Playout etc — fora do escopo da tierização
}

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => { const p = c.trim().split('='); cookies[p.shift()] = p.join('='); });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const last = d.lastIndexOf('|'), sec = d.lastIndexOf('|', last - 1);
    const data = d.slice(0, sec), h = d.slice(sec + 1, last), ts = d.slice(last + 1);
    if (Date.now() - parseInt(ts, 10) > 7 * 24 * 3600 * 1000) return null;
    if (!assinaturaBate(h, hash(data + ts))) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    return { nome: data.split('~~')[0] };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}

function toMin(h) { if (!h) return null; const [hh, mm] = String(h).split(':').map(Number); return hh * 60 + (mm || 0); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function proximoSabado(base) {
  const d = new Date(base); d.setHours(0, 0, 0, 0);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return d;
}

// Sweep-line em grade fixa de 15min (06:00-23:59) — resolução suficiente pra esse relatório,
// bem mais simples que sweep por breakpoint exato e o codebase já prefere loops diretos a isso.
function analisarDia(eventos, escalaHoje) {
  const centrosTier = { 1: new Set(), 2: new Set(), 3: new Set() };
  const eventosPorTier = { 1: [], 2: [], 3: [] };
  let foraDoEscopo = 0;
  for (const ev of eventos) {
    const t = tierDoLocal(ev.local);
    const i = toMin(ev.hora), f = toMin(ev.horaFim);
    if (t === null) { foraDoEscopo++; continue; }
    if (i === null || f === null || f <= i) continue; // sem horário utilizável pro sweep
    eventosPorTier[t].push([i, f]);
    centrosTier[t].add(ev.local);
  }

  const equipeValida = escalaHoje.filter(r => {
    const obs = (r[5] || '').trim();
    return r[3] && r[4] && obs !== 'Folga' && obs !== 'Folga/Ausente' && obs !== 'Externa';
  }).map(r => [toMin(r[3]), toMin(r[4]), r[2]]).filter(r => r[0] !== null && r[1] !== null && r[1] > r[0]);

  let picoNecessario = 0, horaPicoNecessario = null;
  let picoDisponivel = 0, horaPicoDisponivel = null;
  let deficitMax = -Infinity, horaDeficitMax = null;

  for (let t = 6 * 60; t < 24 * 60; t += 15) {
    let necessario = 0;
    for (const tier of [1, 2, 3]) {
      const ativos = eventosPorTier[tier].filter(([i, f]) => t >= i && t < f).length;
      necessario += ativos * PESO_TIER[tier];
    }
    const disponivel = equipeValida.filter(([i, f]) => t >= i && t < f).length;
    if (necessario > picoNecessario) { picoNecessario = necessario; horaPicoNecessario = t; }
    if (disponivel > picoDisponivel) { picoDisponivel = disponivel; horaPicoDisponivel = t; }
    const deficit = necessario - disponivel;
    if (deficit > deficitMax) { deficitMax = deficit; horaDeficitMax = t; }
  }

  return {
    picoNecessario, horaPicoNecessario,
    picoDisponivel, horaPicoDisponivel,
    deficitMax: Math.max(0, deficitMax), horaDeficitMax: deficitMax > 0 ? horaDeficitMax : null,
    coberturaEstrutural: Math.round(picoDisponivel / CAPACIDADE_ESTRUTURAL * 100),
    foraDoEscopo,
    centrosAtivosPico: { 1: centrosTier[1].size, 2: centrosTier[2].size, 3: centrosTier[3].size },
  };
}

function hhmm(min) { if (min === null || min === undefined) return '—'; const h = Math.floor(min / 60), m = min % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  let escalaCompleta;
  try {
    const equipe = await getSheet('Equipe!A2:I200');
    const usuario = equipe.find(r => r[0] === session.nome);
    if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');
    escalaCompleta = await getSheet('Escala!A2:F5000');
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const hoje = getBRT(); hoje.setHours(0, 0, 0, 0);
  const finsDeSemana = [];
  let sab = proximoSabado(hoje);

  for (let w = 0; w < MAX_FINS_DE_SEMANA; w++) {
    const dom = new Date(sab); dom.setDate(sab.getDate() + 1);
    const dfSab = fmtData(sab), dfDom = fmtData(dom);

    let eventosSab = [], eventosDom = [];
    try {
      [eventosSab, eventosDom] = await Promise.all([
        getEventosDoDia(fmtAirtable(sab)),
        getEventosDoDia(fmtAirtable(dom)),
      ]);
    } catch { /* segue com listas vazias */ }

    const escalaSab = escalaCompleta.filter(r => r[0] === dfSab);
    const escalaDom = escalaCompleta.filter(r => r[0] === dfDom);

    const semDadoNenhum = eventosSab.length === 0 && eventosDom.length === 0 && escalaSab.length === 0 && escalaDom.length === 0;
    if (semDadoNenhum) break; // "todos os fins de semana que já têm dado cadastrado" - para aqui

    finsDeSemana.push({
      sab: { data: dfSab, dataFull: new Date(sab), analise: analisarDia(eventosSab, escalaSab) },
      dom: { data: dfDom, dataFull: new Date(dom), analise: analisarDia(eventosDom, escalaDom) },
    });

    sab = new Date(sab); sab.setDate(sab.getDate() + 7);
  }

  // Insights automáticos pra gestão — o pior déficit entre todos os dias analisados, e a tendência
  // simples (primeiro fim de semana da lista vs último) olhando só a cobertura estrutural no pico.
  let piorDia = null;
  for (const fds of finsDeSemana) {
    for (const [label, dia] of [['Sábado ' + fds.sab.data, fds.sab], ['Domingo ' + fds.dom.data, fds.dom]]) {
      if (!piorDia || dia.analise.deficitMax > piorDia.deficit) {
        piorDia = { label, deficit: dia.analise.deficitMax, hora: dia.analise.horaDeficitMax, necessario: dia.analise.picoNecessario, disponivel: dia.analise.picoDisponivel };
      }
    }
  }
  let tendenciaTxt = '';
  if (finsDeSemana.length >= 2) {
    const primeiro = finsDeSemana[0], ultimo = finsDeSemana[finsDeSemana.length - 1];
    const covPrimeiro = Math.min(primeiro.sab.analise.coberturaEstrutural, primeiro.dom.analise.coberturaEstrutural);
    const covUltimo = Math.min(ultimo.sab.analise.coberturaEstrutural, ultimo.dom.analise.coberturaEstrutural);
    if (covUltimo < covPrimeiro - 5) tendenciaTxt = `Cobertura estrutural caindo ao longo das semanas analisadas (${covPrimeiro}% → ${covUltimo}%) — vale checar se a equipe da Central vai encolher ou se é só variação normal de escala.`;
    else if (covUltimo > covPrimeiro + 5) tendenciaTxt = `Cobertura estrutural subindo ao longo das semanas analisadas (${covPrimeiro}% → ${covUltimo}%).`;
    else tendenciaTxt = `Cobertura estrutural estável entre o primeiro (${covPrimeiro}%) e o último (${covUltimo}%) fim de semana analisado.`;
  }

  function linhaResumo(fds) {
    const dSab = fds.sab.analise, dDom = fds.dom.analise;
    return `<tr>
      <td>${esc(fds.sab.data)} – ${esc(fds.dom.data)}</td>
      <td class="num">${dSab.picoNecessario}</td><td class="num">${dSab.picoDisponivel}</td>
      <td class="num ${dSab.deficitMax > 0 ? 'bad' : 'ok'}">${dSab.deficitMax > 0 ? '-' + dSab.deficitMax : '—'}</td>
      <td class="num">${dDom.picoNecessario}</td><td class="num">${dDom.picoDisponivel}</td>
      <td class="num ${dDom.deficitMax > 0 ? 'bad' : 'ok'}">${dDom.deficitMax > 0 ? '-' + dDom.deficitMax : '—'}</td>
    </tr>`;
  }

  function cardDia(titulo, dia) {
    const a = dia.analise;
    const pctCap = Math.min(100, a.coberturaEstrutural);
    return `<div class="daycard">
      <div class="daytitle">${esc(titulo)}</div>
      <div class="gauge-row">
        <div class="gauge-label">Equipe no pico vs. parque 100% (${CAPACIDADE_ESTRUTURAL} pessoas)</div>
        <div class="gauge-track"><div class="gauge-fill ${pctCap < 60 ? 'bad' : pctCap < 90 ? 'warn' : 'ok'}" style="width:${pctCap}%"></div></div>
        <div class="gauge-pct">${a.picoDisponivel} / ${CAPACIDADE_ESTRUTURAL} (${a.coberturaEstrutural}%)</div>
      </div>
      <div class="daymeta">
        <div><span class="mlabel">Pico necessário</span><span class="mval">${a.picoNecessario} <span class="mhint">às ${hhmm(a.horaPicoNecessario)}</span></span></div>
        <div><span class="mlabel">Equipe disponível</span><span class="mval">${a.picoDisponivel} <span class="mhint">às ${hhmm(a.horaPicoDisponivel)}</span></span></div>
        <div><span class="mlabel">Déficit no pico real</span><span class="mval ${a.deficitMax > 0 ? 'bad' : 'ok'}">${a.deficitMax > 0 ? '-' + a.deficitMax : 'sem déficit'}${a.horaDeficitMax !== null ? ` <span class="mhint">às ${hhmm(a.horaDeficitMax)}</span>` : ''}</span></div>
      </div>
      ${a.foraDoEscopo > 0 ? `<div class="foraescopo">${a.foraDoEscopo} evento(s) fora da tierização (Central Sem Narração / Externa / Playout) não entram nessa conta.</div>` : ''}
    </div>`;
  }

  const blocosSemana = finsDeSemana.map(fds => `
    <section class="weekblock">
      <h3>Sábado ${esc(fds.sab.data)} · Domingo ${esc(fds.dom.data)}</h3>
      <div class="daygrid">
        ${cardDia('Sábado ' + fds.sab.data, fds.sab)}
        ${cardDia('Domingo ' + fds.dom.data, fds.dom)}
      </div>
    </section>
  `).join('');

  const conteudo = `
  <div class="header">
    <div class="logo">P</div>
    <div><div class="ht">Pulse</div><div class="hs">Capacidade de produção</div></div>
    <div class="hr">
      <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'☀️':'🌙';})()" style="font-size:14px;padding:3px 8px">🌙</button>
      <div style="position:relative">
        <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
        <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
          <a href="/api/app" class="menu-item">🏠 Início</a>
          <a href="/api/escalas?v=semana" class="menu-item">📅 Escala</a>
          <a href="/api/dashboard" class="menu-item">📊 Dashboard</a>
          <a href="/api/capacidade" class="menu-item">📈 Capacidade</a>
          <a href="/api/repositorio" class="menu-item">📁 Central de Conhecimento</a>
        </div>
      </div>
    </div>
  </div>
  <div class="wrap">
    <div class="pagetitle">Capacidade do parque — próximos fins de semana</div>
    <p class="lead">Tier 1 (SW) pesa 2 pessoas por centro, tier 2 (PD manual) e tier 3 (PD1, automator) pesam 1 cada. Parque tierizado completo (2 SW + 5 PD manual + PD1) precisa de <b>${CAPACIDADE_ESTRUTURAL} pessoas simultâneas</b> pra rodar 100%. Só conta quem está fisicamente na Central — produção Externa fica de fora. Mostrando todos os fins de semana a partir de hoje que já têm dado cadastrado no Airtable e/ou na Escala (${finsDeSemana.length} encontrado${finsDeSemana.length === 1 ? '' : 's'}).</p>

    ${piorDia ? `<div class="insight ${piorDia.deficit > 0 ? 'bad' : 'ok'}">
      ${piorDia.deficit > 0
        ? `<b>Pior ponto encontrado:</b> ${esc(piorDia.label)}, às ${hhmm(piorDia.hora)} — precisava de ${piorDia.necessario} pessoas, havia ${piorDia.disponivel} disponíveis (déficit de ${piorDia.deficit}).`
        : `Nenhum déficit de pessoal encontrado em nenhum dos fins de semana analisados — a equipe da Central cobriu o pico necessário em todos os dias.`}
    </div>` : `<div class="insight">Nenhum fim de semana futuro com dado cadastrado ainda no Airtable/Escala.</div>`}
    ${tendenciaTxt ? `<div class="insight">${esc(tendenciaTxt)}</div>` : ''}

    ${finsDeSemana.length > 0 ? `
    <div class="tablewrap">
      <table>
        <thead><tr><th>Fim de semana</th><th colspan="3">Sábado</th><th colspan="3">Domingo</th></tr>
        <tr><th></th><th>Necessário</th><th>Disponível</th><th>Déficit</th><th>Necessário</th><th>Disponível</th><th>Déficit</th></tr></thead>
        <tbody>${finsDeSemana.map(linhaResumo).join('')}</tbody>
      </table>
    </div>` : ''}

    ${blocosSemana}
  </div>
  <style>
  :root{
    --bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;
    --text:#1a1a1a;--text2:#555;--text3:#888;--text4:#bbb;
    --header:#161920;--blue:#1d4ed8;
    --ok:#16a34a;--warn:#d97706;--bad:#dc2626;
    --ok-bg:#dcfce7;--warn-bg:#fef3c7;--bad-bg:#fee2e2;
  }
  html.dark{
    --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
    --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
    --header:#0f1117;--blue:#63b3ed;
    --ok:#68d391;--warn:#f6ad55;--bad:#fc8181;
    --ok-bg:#0d2010;--warn-bg:#2d1f00;--bad-bg:#1f1010;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
  a{text-decoration:none;color:inherit}
  .header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
  .logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
  .ht{font-size:14px;font-weight:700;color:#fff}
  .hs{font-size:11px;color:#999}
  .hr{margin-left:auto;display:flex;gap:6px;align-items:center}
  .btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer}
  .menu-item{display:block;padding:9px 14px;font-size:12px;color:var(--text);white-space:nowrap}
  .menu-item:hover{background:var(--bg3)}
  .wrap{max-width:1100px;margin:0 auto;padding:20px}
  .pagetitle{font-size:19px;font-weight:700;margin-bottom:6px}
  .lead{font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:18px;max-width:80ch}
  .insight{background:var(--bg3);border-radius:10px;padding:12px 16px;font-size:13px;margin-bottom:10px;line-height:1.5}
  .insight.bad{background:var(--bad-bg);color:var(--bad)}
  .insight.ok{background:var(--ok-bg);color:var(--ok)}
  .tablewrap{overflow-x:auto;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--card);border:1px solid var(--border);border-radius:8px}
  th,td{padding:7px 10px;border-bottom:1px solid var(--border2);text-align:left;white-space:nowrap}
  th{color:var(--text3);font-weight:600;font-size:11px;text-transform:uppercase}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  td.bad{color:var(--bad);font-weight:600}
  td.ok{color:var(--ok)}
  .weekblock{margin-bottom:26px}
  .weekblock h3{font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text2)}
  .daygrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:700px){.daygrid{grid-template-columns:1fr}}
  .daycard{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
  .daytitle{font-size:13px;font-weight:700;margin-bottom:10px}
  .gauge-row{margin-bottom:12px}
  .gauge-label{font-size:11px;color:var(--text3);margin-bottom:5px}
  .gauge-track{height:14px;background:var(--bg3);border-radius:5px;overflow:hidden}
  .gauge-fill{height:100%;border-radius:5px}
  .gauge-fill.ok{background:var(--ok)}
  .gauge-fill.warn{background:var(--warn)}
  .gauge-fill.bad{background:var(--bad)}
  .gauge-pct{font-size:11px;color:var(--text2);margin-top:4px;text-align:right}
  .daymeta{display:flex;flex-direction:column;gap:6px}
  .daymeta > div{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px}
  .mlabel{color:var(--text3)}
  .mval{font-weight:600;font-variant-numeric:tabular-nums}
  .mval.bad{color:var(--bad)}
  .mval.ok{color:var(--ok)}
  .mhint{font-size:10.5px;color:var(--text4);font-weight:400}
  .foraescopo{font-size:10.5px;color:var(--text3);margin-top:8px;border-top:1px solid var(--border2);padding-top:8px}
  </style>
  <script>
  function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
  document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
  </script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Capacidade</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#e53e3e">
</head>
<body>
${conteudo}
</body>
</html>`);
}
