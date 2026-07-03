// api/banco-horas.js — Banco de horas e horas extras por tipo de contrato
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;
const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function iniciais(n) { return (n||'?').split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// Normaliza nome pra comparar Equipe x Escala sem depender de acento/caixa/forma unicode iguais
function normalizarNome(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }

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

// Normaliza datas de qualquer formato para DD/MM — resolve legado USER_ENTERED (mesma lógica de escalas.js)
function normalizarDf(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const p = s.split('-'); return p[2].slice(0,2).padStart(2,'0')+'/'+p[1].padStart(2,'0'); }
  if (/^\d{1,2}\/\d{1,2}/.test(s)) { const p = s.split('/'); return p[0].padStart(2,'0')+'/'+p[1].padStart(2,'0'); }
  if (/^\d{5,6}$/.test(s)) return s; // serial numérico — ignora
  return s;
}
async function getSheet(range) {
  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`);
    const values = d.values||[];
    // Normaliza coluna A (data) se for range de Escala
    if (range.includes('Escala')) {
      return values.map(r => r.length>0 ? [normalizarDf(r[0]||''), ...r.slice(1)] : r);
    }
    return values;
  }
  catch { return []; }
}

async function getEventosPeriodo(dataInicio, dataFim) {
  const filter = `AND(DATESTR({fldBNl8ypKaV5hFG5})>='${dataInicio}',DATESTR({fldBNl8ypKaV5hFG5})<='${dataFim}')`;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=500&sort[0][field]=Encerramento&sort[0][direction]=asc`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    const d = await r.json();
    return (d.records||[]).map(rec => ({ data: rec.fields['Encerramento']?.split('T')[0]||'' }));
  } catch { return []; }
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
// CLT e PJ — jornada padrão 8h/dia (turno de 9h com 1h de intervalo). Até 2h excedentes por dia vão para o
// banco de horas (limite do art. 59 da CLT); acima disso é hora extra 100% — regra provisória, ajustar o
// limite de LIMITE_BANCO_CLT_PJ abaixo se o acordo real da empresa usar outro valor.
const LIMITE_BANCO_CLT_PJ = 2;
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
    banco = Math.min(excedente, LIMITE_BANCO_CLT_PJ);
    extra100 = Math.max(0, excedente - LIMITE_BANCO_CLT_PJ);
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
  const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const anosSelect = [...new Set([hoje.getFullYear()-1, hoje.getFullYear(), hoje.getFullYear()+1, ano])].sort();

  const ativos = equipeRaw.filter(r => r[0] && (r[10]||'ativo').toLowerCase() === 'ativo');
  const equipe = ativos.map(r => ({ nome: r[0], cargo: r[1]||'', tipoContrato: r[12]||'' }))
    .filter(p => p.tipoContrato === 'CLT' || p.tipoContrato === 'PJ' || p.tipoContrato === 'Temporário');

  const resultado = equipe.map(p => {
    let diasTrabalhados = 0, horasTotais = 0, bancoTotal = 0, extraTotal = 0;
    const dias = [];
    for (let d = 1; d <= ultimoDia; d++) {
      const data = new Date(ano, mes, d);
      const df = fmtData(data);
      const reg = escalaRaw.find(r => r[0] === df && normalizarNome(r[2]) === normalizarNome(p.nome));
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

  // ── Análise por dia da semana: carga operacional x gente escalada ─────────
  const primeiroDiaMes = new Date(ano, mes, 1);
  const ultimoDiaMes = new Date(ano, mes, ultimoDia);
  const eventosMes = await getEventosPeriodo(fmtAirtable(primeiroDiaMes), fmtAirtable(ultimoDiaMes));

  const DIAS_PT_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const weekdayStats = DIAS_PT_FULL.map(nome => ({ nome, diasNoMes: 0, eventos: 0, pessoasDia: 0, horasTotais: 0 }));

  for (let d = 1; d <= ultimoDia; d++) {
    const data = new Date(ano, mes, d);
    const wd = data.getDay();
    const df = fmtData(data);
    const dataAT = fmtAirtable(data);
    weekdayStats[wd].diasNoMes++;
    weekdayStats[wd].eventos += eventosMes.filter(e => e.data === dataAT).length;
    const escaladosDoDia = escalaRaw.filter(r => r[0] === df && r[3] && r[4] && r[5] !== 'Folga' && equipe.some(p => normalizarNome(p.nome) === normalizarNome(r[2])));
    weekdayStats[wd].pessoasDia += escaladosDoDia.length;
    weekdayStats[wd].horasTotais += escaladosDoDia.reduce((s,r) => s + duracaoHoras(r[3], r[4]), 0);
  }

  const weekdayAnalise = weekdayStats.map(w => {
    const mediaEventos = w.diasNoMes ? w.eventos / w.diasNoMes : 0;
    const mediaPessoas = w.diasNoMes ? w.pessoasDia / w.diasNoMes : 0;
    const mediaHoras = w.diasNoMes ? w.horasTotais / w.diasNoMes : 0;
    const folgaScore = mediaPessoas / Math.max(mediaEventos, 0.25); // alto = sobra de gente p/ pouco evento = bom p/ folga
    return { ...w, mediaEventos, mediaPessoas, mediaHoras, folgaScore };
  });

  const diasComDados = weekdayAnalise.filter(w => w.diasNoMes > 0);
  const melhoresParaFolga = [...diasComDados].sort((a,b) => b.folgaScore - a.folgaScore).slice(0, 2);
  const diasSobrecarregados = [...diasComDados].sort((a,b) => a.folgaScore - b.folgaScore).slice(0, 2);
  const fluxoMaisFraco = [...diasComDados].sort((a,b) => a.mediaEventos - b.mediaEventos).slice(0, 2);
  const maiorEventos = Math.max(1, ...weekdayAnalise.map(w => w.mediaEventos));
  const maiorPessoas = Math.max(1, ...weekdayAnalise.map(w => w.mediaPessoas));

  function fmtH(h) {
    if (h === 0) return '0h';
    const inteiro = Math.floor(h);
    const min = Math.round((h - inteiro) * 60);
    return min > 0 ? `${inteiro}h${String(min).padStart(2,'0')}` : `${inteiro}h`;
  }

  const tipoCores = { 'CLT':['#dcfce7','#166534'], 'PJ':['#f3e8ff','#7c3aed'], 'Temporário':['#fef3c7','#92400e'] };
  const tipoLabels = { 'CLT':'Live Mode', 'PJ':'PJ', 'Temporário':'LET' };

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
    <div class="colab-card" data-tipo="${esc(p.tipoContrato)}" data-banco="${p.bancoTotal}" data-extra="${p.extraTotal}" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:38px;height:38px;border-radius:50%;background:${tbg};color:${tc};font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(p.nome)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(p.nome)}</div>
          <div style="font-size:10px;color:var(--text3)">${esc(p.cargo)||'—'}</div>
        </div>
        <span style="background:${tbg};color:${tc};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700">${esc(tipoLabels[p.tipoContrato] || p.tipoContrato)}</span>
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
  }).join('') : '<div style="color:var(--text3);font-size:13px;padding:20px;text-align:center">Nenhum colaborador com tipo de contrato definido (Live Mode, PJ ou LET). Defina o tipo de contrato em cada colaborador na aba Equipe.</div>';

  const diaBarHtml = weekdayAnalise.map(w => {
    const pctEventos = Math.round((w.mediaEventos / maiorEventos) * 100);
    const pctPessoas = Math.round((w.mediaPessoas / maiorPessoas) * 100);
    const ehMelhorFolga = melhoresParaFolga.some(m => m.nome === w.nome);
    const ehSobrecarregado = diasSobrecarregados.some(m => m.nome === w.nome);
    const corDestaque = ehMelhorFolga ? '#166534' : ehSobrecarregado ? '#991b1b' : 'var(--border)';
    return `
    <div style="background:var(--bg2);border:1px solid ${corDestaque};border-radius:8px;padding:10px 12px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-size:12px;font-weight:700;color:var(--text)">${w.nome}</span>
        ${ehMelhorFolga?'<span style="background:#0d2010;color:#68d391;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">🟢 fácil p/ folga</span>':''}
        ${ehSobrecarregado?'<span style="background:#1f1010;color:#fc8181;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700">🔴 evitar folga</span>':''}
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:9px;color:var(--text3);width:74px;flex-shrink:0">Eventos/dia</span>
        <div style="flex:1;background:var(--bg3);border-radius:4px;height:7px;overflow:hidden"><div style="background:#7c3aed;height:100%;width:${pctEventos}%"></div></div>
        <span style="font-size:10px;color:var(--text2);width:32px;text-align:right;flex-shrink:0">${w.mediaEventos.toFixed(1)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:9px;color:var(--text3);width:74px;flex-shrink:0">Gente escalada</span>
        <div style="flex:1;background:var(--bg3);border-radius:4px;height:7px;overflow:hidden"><div style="background:#1d4ed8;height:100%;width:${pctPessoas}%"></div></div>
        <span style="font-size:10px;color:var(--text2);width:32px;text-align:right;flex-shrink:0">${w.mediaPessoas.toFixed(1)}</span>
      </div>
    </div>`;
  }).join('');

  const insightsHtml = diasComDados.length ? `
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:18px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:4px">📈 Fluxo de trabalho por dia da semana</div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px">Compara eventos médios (roxo) com a quantidade média de gente escalada (azul) por dia da semana, neste mês. Dias com mais gente escalada do que evento têm sobra de equipe — bons candidatos pra folga. Dias com pouca gente pra muito evento são os pontos mais sensíveis da operação.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:14px">${diaBarHtml}</div>
    <div id="bh-insight-cols" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="background:#0d2010;border:1px solid #166534;border-radius:8px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:#68d391;margin-bottom:4px">🟢 Melhores dias para conceder folga</div>
        <div style="font-size:12px;color:#a7f3d0">${melhoresParaFolga.map(d=>d.nome).join(' e ')} — mais gente escalada do que demanda de eventos nesses dias.</div>
      </div>
      <div style="background:#1f1010;border:1px solid #991b1b;border-radius:8px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:#fc8181;margin-bottom:4px">🔴 Dias mais sensíveis (evitar conceder folga)</div>
        <div style="font-size:12px;color:#fca5a5">${diasSobrecarregados.map(d=>d.nome).join(' e ')} — pouca margem entre gente escalada e eventos.</div>
      </div>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--text3)">🔻 Fluxo de trabalho mais fraco (menor volume de eventos no geral): <b style="color:var(--text2)">${fluxoMaisFraco.map(d=>d.nome).join(' e ')}</b></div>
  </div>` : '';

  const filtrosHtml = `
  <div id="bh-filtros" style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <span style="font-size:11px;color:var(--text3);font-weight:600">Filtrar por tipo:</span>
    <button class="filtro-btn ativo" data-filtro="todos" data-cor="var(--text)" onclick="filtrarTipo('todos',this)" style="border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;background:var(--card);color:var(--text);cursor:pointer">Todos</button>
    <button class="filtro-btn" data-filtro="CLT" data-cor="#166534" onclick="filtrarTipo('CLT',this)" style="border:1px solid #166534;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;background:none;color:#166534;cursor:pointer">Live Mode</button>
    <button class="filtro-btn" data-filtro="PJ" data-cor="#7c3aed" onclick="filtrarTipo('PJ',this)" style="border:1px solid #7c3aed;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;background:none;color:#7c3aed;cursor:pointer">PJ</button>
    <button class="filtro-btn" data-filtro="Temporário" data-cor="#92400e" onclick="filtrarTipo('Temporário',this)" style="border:1px solid #92400e;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;background:none;color:#92400e;cursor:pointer">LET</button>
  </div>`;

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
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:var(--text);text-decoration:none;white-space:nowrap}
.menu-item:hover{background:var(--bg3)}
.bh-txt-short{display:none}
/* ── MOBILE ── */
@media(max-width:640px){
  #bh-header{padding:8px 12px!important;gap:8px!important;flex-wrap:wrap!important}
  #bh-title{font-size:12px!important;white-space:normal!important}
  #bh-sub{display:none!important}
  #bh-header-right{gap:5px!important;margin-left:0!important;width:100%!important;justify-content:flex-end!important}
  #bh-tempo-widget,#bh-relogio-widget{display:none!important}
  .bh-txt-full{display:none!important}
  .bh-txt-short{display:inline!important}
  #bh-sel-mes{max-width:90px}
  #bh-sel-ano{max-width:68px}
  #bh-metrics{grid-template-columns:1fr!important;gap:8px!important}
  #bh-filtros{flex-wrap:wrap!important;gap:6px!important}
  #bh-insight-cols{grid-template-columns:1fr!important}
}
</style>
</head>
<body>
<div id="bh-header" style="background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100">
  <div style="width:28px;height:28px;background:#e53e3e;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">P</div>
  <div style="min-width:0"><div id="bh-title" style="font-size:14px;font-weight:600;color:#fff">Pulse — Banco de horas &amp; Horas extras</div><div id="bh-sub" style="font-size:11px;color:#999;text-transform:capitalize">${nomeMes} ${ano} · baseado na escala planejada</div></div>
  <div id="bh-header-right" style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <div id="bh-tempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="bh-tempo-icone">&#9203;</span>
      <span id="bh-tempo-temp" style="font-weight:700">--&deg;C</span>
      <span id="bh-tempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div id="bh-relogio-widget" style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:#718096">BRT</span>
        <span id="bh-relogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <span id="bh-relogio-gmt" style="font-size:10px;font-weight:600;color:#4a5568;font-variant-numeric:tabular-nums"></span>
    </div>
    <a href="/api/banco-horas?offset=${offset-1}" class="btn-sm" title="Mês anterior"><span class="bh-txt-full">&#8249; mês anterior</span><span class="bh-txt-short">&#8249;</span></a>
    <select id="bh-sel-mes" onchange="irParaMes()" style="border:1px solid var(--btn-border);border-radius:5px;padding:4px 6px;font-size:11px;font-weight:600;background:var(--header);color:#e2e8f0;cursor:pointer">
      ${MESES_PT.map((m,i) => `<option value="${i}" ${i===mes?'selected':''}>${m}</option>`).join('')}
    </select>
    <select id="bh-sel-ano" onchange="irParaMes()" style="border:1px solid var(--btn-border);border-radius:5px;padding:4px 6px;font-size:11px;font-weight:600;background:var(--header);color:#e2e8f0;cursor:pointer">
      ${anosSelect.map(a => `<option value="${a}" ${a===ano?'selected':''}>${a}</option>`).join('')}
    </select>
    <a href="/api/banco-horas?offset=${offset+1}" class="btn-sm" title="Próximo mês"><span class="bh-txt-full">próximo mês &#8250;</span><span class="bh-txt-short">&#8250;</span></a>
    <a href="/api/banco-horas?offset=${offset}" class="btn-sm" style="background:#1a2744;border-color:#2a4080;color:#63b3ed"><span class="bh-txt-full">&#128202; Gerar relatório</span><span class="bh-txt-short">&#128202;</span></a>
    <button id="tt" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" class="btn-sm" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Inicio</a>
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausencias</a>
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>
  </div>
</div>
<div style="max-width:1300px;margin:0 auto;padding:18px 20px">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin-bottom:16px;font-size:11px;color:var(--text2);line-height:1.6">
    <b>Regras aplicadas</b> · <span style="color:#7c3aed;font-weight:600">LET (6x1, 6h/dia):</span> seg–sáb, até 2h excedentes vão para o banco de horas; depois disso é hora extra (100%). Domingo: sem banco — toda hora excedente é hora extra (100%).
    <span style="color:#1d4ed8;font-weight:600;margin-left:8px">Live Mode e PJ (8h/dia):</span> até ${LIMITE_BANCO_CLT_PJ}h excedentes por dia vão para o banco de horas; depois disso é hora extra (100%).
    ${totalSemTipo>0?`<div style="margin-top:4px;color:#d97706">⚠ ${totalSemTipo} colaborador${totalSemTipo>1?'es':''} ativo${totalSemTipo>1?'s':''} sem tipo de contrato definido — não entra neste relatório até ser configurado na aba Equipe.</div>`:''}
  </div>
  <div id="bh-metrics" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Colaboradores no relatório</div><div style="font-size:24px;font-weight:700" id="tot-colab">${resultado.length}</div></div>
    <div style="background:var(--card);border:1px solid #2a4080;border-radius:8px;padding:14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Banco de horas total</div><div style="font-size:24px;font-weight:700;color:#1d4ed8" id="tot-banco">${fmtH(totalGeralBanco)}</div></div>
    <div style="background:var(--card);border:1px solid #3d3010;border-radius:8px;padding:14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Hora extra 100% total</div><div style="font-size:24px;font-weight:700;color:#d97706" id="tot-extra">${fmtH(totalGeralExtra)}</div></div>
  </div>
  ${insightsHtml}
  ${filtrosHtml}
  <div class="grid" id="grid-colabs">${cardsHtml}</div>
</div>
<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
function atualizarRelogio(){
  var now=new Date();
  var p=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now);
  var bh=p.find(function(x){return x.type==='hour';}).value,bm=p.find(function(x){return x.type==='minute';}).value,bs=p.find(function(x){return x.type==='second';}).value;
  var elBrt=document.getElementById('bh-relogio-brt');if(elBrt)elBrt.textContent=bh+':'+bm+':'+bs;
  var elGmt=document.getElementById('bh-relogio-gmt');if(elGmt)elGmt.textContent=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0');
}
async function carregarTempo(){
  try{
    var loc=null;
    try{var r1=await fetch('https://ipapi.co/json/');var j1=await r1.json();if(j1.latitude)loc={lat:j1.latitude,lon:j1.longitude,city:j1.city};}catch(e){}
    if(!loc)loc={lat:-22.9068,lon:-43.1729,city:'Rio de Janeiro'};
    var wd=await(await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')).json();
    var temp=wd.current&&wd.current.temperature_2m!==undefined?Math.round(wd.current.temperature_2m):'--';
    var icons={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',99:'⛈️'};
    document.getElementById('bh-tempo-icone').textContent=icons[wd.current&&wd.current.weathercode||0]||'🌡️';
    document.getElementById('bh-tempo-temp').textContent=temp+'°C';
    document.getElementById('bh-tempo-cidade').textContent=loc.city||'';
  }catch(e){document.getElementById('bh-tempo-temp').textContent='--°C';}
}
atualizarRelogio();carregarTempo();setInterval(atualizarRelogio,1000);
var HOJE_ANO=${hoje.getFullYear()}, HOJE_MES=${hoje.getMonth()};
function irParaMes(){
  var mesSel=parseInt(document.getElementById('bh-sel-mes').value);
  var anoSel=parseInt(document.getElementById('bh-sel-ano').value);
  var offsetCalc=(anoSel-HOJE_ANO)*12+(mesSel-HOJE_MES);
  location.href='/api/banco-horas?offset='+offsetCalc;
}
function fmtHJs(h){
  if (h===0) return '0h';
  var inteiro=Math.floor(h), min=Math.round((h-inteiro)*60);
  return min>0 ? inteiro+'h'+String(min).padStart(2,'0') : inteiro+'h';
}
function filtrarTipo(tipo, btn){
  document.querySelectorAll('.filtro-btn').forEach(function(b){
    b.classList.remove('ativo');
    b.style.background = 'none';
  });
  btn.classList.add('ativo');
  btn.style.background = tipo==='todos' ? 'var(--card)' : (btn.getAttribute('data-cor')+'22');

  var cards = document.querySelectorAll('.colab-card');
  var nColab=0, somaBanco=0, somaExtra=0;
  cards.forEach(function(c){
    var match = tipo==='todos' || c.getAttribute('data-tipo')===tipo;
    c.style.display = match ? '' : 'none';
    if (match){
      nColab++;
      somaBanco += parseFloat(c.getAttribute('data-banco'))||0;
      somaExtra += parseFloat(c.getAttribute('data-extra'))||0;
    }
  });
  document.getElementById('tot-colab').textContent = nColab;
  document.getElementById('tot-banco').textContent = fmtHJs(somaBanco);
  document.getElementById('tot-extra').textContent = fmtHJs(somaExtra);
}
</script>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(html);
}
