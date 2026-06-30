// api/banco-horas.js — Banco de horas e horas extras por tipo de contrato
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function iniciais(n) { return (n||'?').split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c => {
    const cookieParts = c.trim().split('=');
    const k = cookieParts.shift();
    cookies[k] = cookieParts.join('=');
  });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(data + ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}

function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }
function duracaoHoras(ent, sai) {
  const e = toMin(ent), s = toMin(sai);
  if (e===null||s===null) return 0;
  const dur = s > e ? s - e : (1440 - e) + s; // turno virando a noite
  return dur / 60;
}

// ── Regras por tipo de contrato ──────────────────────────────────────────
// Temporário (LET) — jornada 6x1, 6h/dia. Seg-Sáb: até 2h extras vão pro banco; depois disso é hora extra.
// Domingo: sem banco de horas, qualquer hora extra é paga a 100%.
// CLT e PJ — jornada padrão 8h/dia (turno de 9h com 1h de intervalo). Tudo que exceder vai pro banco de horas.
function jornadaContratada(tipo) { return tipo === 'Temporário' ? 6 : 8; }
function horasEfetivas(durBruta, tipo) {
  if (tipo === 'Temporário') return durBruta; // turno de 6h, sem intervalo
  return durBruta > 6 ? durBruta - 1 : durBruta; // CLT/PJ com 1h de intervalo em turnos maiores
}
function calcularDia(durBruta, tipo, isDomingo) {
  const trabalhadas = horasEfetivas(durBruta, tipo);
  const excedente = Math.max(0, trabalhadas - jornadaContratada(tipo));
  let banco = 0, extra100 = 0;
  if (tipo === 'Temporário') {
    if (isDomingo) { extra100 = excedente; }
    else { banco = Math.min(excedente, 2); extra100 = Math.max(0, excedente - 2); }
  } else {
    banco = excedente; // PJ e CLT: tudo vai para banco de horas
  }
  return { trabalhadas, excedente, banco, extra100 };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [equipeRaw, escalaRaw] = await Promise.all([
    getSheet('Equipe!A2:M200'),
    getSheet('Escala!A2:F2000'),
  ]);

  const usuario = equipeRaw.find(r => r[0] === session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  const hoje = getBRT();

  // Mês selecionado via ?offset=N (relativo ao mês atual)
  const offset = parseInt(req.query.offset || '0') || 0;
  const baseMes = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
  const ano = baseMes.getFullYear(), mes = baseMes.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const nomeMes = baseMes.toLocaleString('pt-BR', { month: 'long' });

  const ativos = equipeRaw.filter(r => r[0] && (r[10]||'ativo').toLowerCase() === 'ativo');
  const equipe = ativos.map(r => ({ nome: r[0], cargo: r[1]||'', tipoContrato: r[12]||'' }))
    .filter(p => p.tipoContrato === 'CLT' || p.tipoContrato === 'PJ' || p.tipoContrato === 'Temporário');

  const resultado = equipe.map(p => {
    let diasTrabalhados = 0, horasTotais = 0, bancoTotal = 0, extraTotal = 0;
    const dias = [];
    for (let d = 1; d <= ultimoDia; d++) {
      const data = new Date(ano, mes, d);
      const df = fmtData(data);
      const reg = escalaRaw.find(r => r[0] === df && r[2] === p.nome);
      if (!reg || !reg[3] || !reg[4] || reg[5] === 'Folga') continue;
      const durBruta = duracaoHoras(reg[3], reg[4]);
      if (durBruta <= 0) continue;
      const isDomingo = data.getDay() === 0;
      const calc = calcularDia(durBruta, p.tipoContrato, isDomingo);
      diasTrabalhados++;
      horasTotais += calc.trabalhadas;
      bancoTotal += calc.banco;
      extraTotal += calc.extra100;
      if (calc.banco > 0 || calc.extra100 > 0) {
        dias.push({ df, isDomingo, ...calc });
      }
    }
    return { ...p, diasTrabalhados, horasTotais, bancoTotal, extraTotal, dias };
  });

  const totalGeralBanco = resultado.reduce((s,p)=>s+p.bancoTotal,0);
  const totalGeralExtra = resultado.reduce((s,p)=>s+p.extraTotal,0);
  const totalSemTipo = ativos.length - equipe.length;

  function fmtH(h) {
    if (h === 0) return '0h';
    const inteiro = Math.floor(h);
    const min = Math.round((h - inteiro) * 60);
    return min > 0 ? `${inteiro}h${String(min).padStart(2,'0')}` : `${inteiro}h`;
  }

  const tipoCores = { 'CLT':['#dcfce7','#166534'], 'PJ':['#f3e8ff','#7c3aed'], 'Temporário':['#fef3c7','#92400e'] };

  const maiorValor = Math.max(1, ...resultado.map(p => Math.max(p.bancoTotal, p.extraTotal)));

  const cardsHtml = resultado.length ? resultado.map(p => {
    const [tbg,tc] = tipoCores[p.tipoContrato] || ['#f3f4f6','#6b7280'];
    const pctBanco = Math.round((p.bancoTotal / maiorValor) * 100);
    const pctExtra = Math.round((p.extraTotal / maiorValor) * 100);
    const diasDetalheHtml = p.dias.length ? `
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto">
        ${p.dias.map(d => `<div style="display:flex;align-items:center;gap:8px;font-size:11px">
          <span style="min-width:40px;color:var(--text3);font-weight:600">${esc(d.df)}${d.isDomingo?' <span style=\"color:#7c3aed\">(dom)</span>':''}</span>
          <span style="color:var(--text2)">${fmtH(d.trabalhadas)} trabalhadas</span>
          ${d.banco>0?`<span style="background:#1a2744;color:#63b3ed;border-radius:4px;padding:1px 6px;font-weight:600">+${fmtH(d.banco)} banco</span>`:''}
          ${d.extra100>0?`<span style="background:#2d1f00;color:#f6ad55;border-radius:4px;padding:1px 6px;font-weight:600">+${fmtH(d.extra100)} extra 100%</span>`:''}
        </div>`).join('')}
      </div>` : '';
    return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:38px;height:38px;border-radius:50%;background:${tbg};color:${tc};font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(p.nome)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(p.nome)}</div>
          <div style="font-size:10px;color:var(--text3)">${esc(p.cargo)||'—'}</div>
        </div>
        <span style="background:${tbg};color:${tc};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700">${esc(p.tipoContrato)}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:var(--bg2);border-radius:8px;padding:8px 10px">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;font-weight:600">Dias trabalhados</div>
          <div style="font-size:18px;font-weight:700;color:var(--text)">${p.diasTrabalhados}</div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:8px 10px">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;font-weight:600">Horas trabalhadas</div>
          <div style="font-size:18px;font-weight:700;color:var(--text)">${fmtH(p.horasTotais)}</div>
        </div>
      </div>
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:#63b3ed;font-weight:600">Banco de horas</span><span style="font-weight:700;color:var(--text)">${fmtH(p.bancoTotal)}</span></div>
        <div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div style="background:#1d4ed8;height:100%;width:${pctBanco}%"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:#f6ad55;font-weight:600">Hora extra 100%</span><span style="font-weight:700;color:var(--text)">${fmtH(p.extraTotal)}</span></div>
        <div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div style="background:#d97706;height:100%;width:${pctExtra}%"></div></div>
      </div>
      ${diasDetalheHtml}
    </div>`;
  }).join('') : '<div style="color:var(--text3);font-size:13px;padding:20px;text-align:center">Nenhum colaborador com tipo de contrato definido (CLT, PJ ou Temporário). Defina o tipo de contrato em cada colaborador na aba Equipe.</div>';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Banco de horas</title>
<style>
:root{--bg:#f5f5f5;--bg2:#fff;--bg3:#fafafa;--border:#e5e5e5;--text:#1a1a1a;--text2:#555;--text3:#888;--header:#1a1a1a;--card:#fff;--btn-border:#444;--btn-c:#ccc;}
html.dark{--bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--border:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--header:#161920;--card:#242836;--btn-border:#3d4660;--btn-c:#a0aec0;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.btn-sm{background:none;border:1px solid var(--btn-border);border-radius:5px;padding:4px 10px;font-size:11px;color:var(--btn-c);text-decoration:none;cursor:pointer;display:inline-flex;align-items:center}
</style>
</head>
<body>
<div style="background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100">
  <div style="width:28px;height:28px;background:#e53e3e;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">P</div>
  <div><div style="font-size:14px;font-weight:600;color:#fff">Pulse — Banco de horas &amp; Horas extras</div><div style="font-size:11px;color:#999;text-transform:capitalize">${nomeMes} ${ano} · baseado na escala planejada</div></div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <a href="/api/banco-horas?offset=${offset-1}" class="btn-sm">&#8249; mês anterior</a>
    <a href="/api/banco-horas?offset=${offset+1}" class="btn-sm">próximo mês &#8250;</a>
    <a href="/api/banco-horas?offset=${offset}" class="btn-sm" style="background:#1a2744;border-color:#2a4080;color:#63b3ed">&#128202; Gerar relatório</a>
    <button id="tt" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" class="btn-sm" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <a href="/api/equipe-view" class="btn-sm">← Equipe</a>
  </div>
</div>
<div style="max-width:1300px;margin:0 auto;padding:18px 20px">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin-bottom:16px;font-size:11px;color:var(--text2);line-height:1.6">
    <b>Regras aplicadas</b> · <span style="color:#7c3aed;font-weight:600">Temporário (LET, 6x1, 6h/dia):</span> seg–sáb, até 2h excedentes vão para o banco de horas; depois disso é hora extra (100%). Domingo: sem banco — toda hora excedente é hora extra (100%).
    <span style="color:#1d4ed8;font-weight:600;margin-left:8px">CLT e PJ (8h/dia):</span> toda hora excedente vai para o banco de horas.
    ${totalSemTipo>0?`<div style="margin-top:4px;color:#d97706">⚠ ${totalSemTipo} colaborador${totalSemTipo>1?'es':''} ativo${totalSemTipo>1?'s':''} sem tipo de contrato definido — não entra neste relatório até ser configurado na aba Equipe.</div>`:''}
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Colaboradores no relatório</div><div style="font-size:24px;font-weight:700">${resultado.length}</div></div>
    <div style="background:var(--card);border:1px solid #2a4080;border-radius:8px;padding:14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Banco de horas total</div><div style="font-size:24px;font-weight:700;color:#1d4ed8">${fmtH(totalGeralBanco)}</div></div>
    <div style="background:var(--card);border:1px solid #3d3010;border-radius:8px;padding:14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Hora extra 100% total</div><div style="font-size:24px;font-weight:700;color:#d97706">${fmtH(totalGeralExtra)}</div></div>
  </div>
  <div class="grid">${cardsHtml}</div>
</div>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(html);
}
