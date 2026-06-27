// api/escalas.js — Visão dia/semana/mês com alertas trabalhistas
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { analisarEscala, duracaoTurno } from '../lib/escalas-engine.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function hash(s) { return createHash('sha256').update(s + (process.env.PULSE_SECRET||'pulse2026')).digest('hex').slice(0,32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c => { const [k,...v]=c.trim().split('='); cookies[k.trim()]=v.join('='); });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [nome, h, ts] = decoded.split('|');
    if (Date.now() - parseInt(ts) > 7*24*3600*1000) return null;
    if (h !== hash(nome + ts)) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}

const NIVEL_COR = {
  danger:  { bg: '#fef2f2', border: '#fca5a5', txt: '#991b1b', dot: '#dc2626' },
  warning: { bg: '#fffbeb', border: '#fcd34d', txt: '#92400e', dot: '#f59e0b' },
  ok:      { bg: '#f0fdf4', border: '#86efac', txt: '#166534', dot: '#22c55e' },
  folga:   { bg: '#eff6ff', border: '#93c5fd', txt: '#1d4ed8', dot: '#3b82f6' },
  ausencia:{ bg: '#fdf4ff', border: '#d8b4fe', txt: '#6b21a8', dot: '#a855f7' },
  livre:   { bg: '#f9fafb', border: '#e5e7eb', txt: '#9ca3af', dot: '#d1d5db' },
};

function alertaBadge(alerta) {
  const c = NIVEL_COR[alerta.nivel] || NIVEL_COR.warning;
  return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:4px;padding:2px 6px;font-size:9px;color:${c.txt};font-weight:600;margin-top:2px;line-height:1.3">${alerta.msg}</div>`;
}

function celulaAnalise(analise, turno, compacto=false) {
  if (!analise) return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:6px;text-align:center;color:#d1d5db;font-size:11px">—</div>`;

  const { tipo, status, alertas, durHoras } = analise;
  const c = NIVEL_COR[tipo] || NIVEL_COR.livre;
  const temAlerta = alertas && alertas.length > 0;
  const dot = temAlerta ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c.dot};margin-left:4px;vertical-align:middle"></span>` : '';

  if (compacto) {
    return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:6px;padding:5px 6px;min-height:52px">
      <div style="font-size:10px;font-weight:700;color:${c.txt}">${status||'—'}${dot}</div>
      ${durHoras ? `<div style="font-size:9px;color:${c.txt};opacity:.8">${durHoras.toFixed(1)}h</div>` : ''}
      ${temAlerta&&!compacto ? alertas.map(a=>alertaBadge(a)).join('') : ''}
      ${temAlerta ? `<div style="font-size:8px;color:${c.dot};font-weight:700;margin-top:2px">${alertas.length} alerta${alertas.length>1?'s':''}</div>` : ''}
    </div>`;
  }

  return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:7px;padding:8px 10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${temAlerta?4:0}px">
      <span style="font-size:12px;font-weight:700;color:${c.txt}">${status||'—'}</span>
      ${durHoras ? `<span style="font-size:10px;color:${c.txt};opacity:.8">${durHoras.toFixed(1)}h</span>` : ''}
    </div>
    ${alertas ? alertas.map(a=>alertaBadge(a)).join('') : ''}
  </div>`;
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [equipeRaw, escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:I50'),
    getSheet('Escala!A2:F500'),
    getSheet('Ausências!A2:I500'),
  ]);

  const usuario = equipeRaw.find(r => r[0] === session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  const visao = req.query.v || 'semana'; // dia | semana | mes
  const hoje = getBRT();
  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DIAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Nav: semana ou mês offset
  const offset = parseInt(req.query.offset || '0');

  let datas = [], titulo = '', subtitulo = '';

  if (visao === 'dia') {
    const dia = new Date(hoje); dia.setDate(hoje.getDate() + offset);
    datas = [fmtData(dia)];
    titulo = `${DIAS_FULL[dia.getDay()]}, ${dia.getDate()} de ${MESES[dia.getMonth()]}`;
    subtitulo = 'Visão do dia';
  } else if (visao === 'semana') {
    const dow = hoje.getDay();
    const seg = new Date(hoje); seg.setDate(hoje.getDate() - dow + 1 + offset * 7);
    for (let i = 0; i < 7; i++) { const d = new Date(seg); d.setDate(seg.getDate()+i); datas.push(fmtData(d)); }
    titulo = `Semana ${datas[0]} — ${datas[6]}`;
    subtitulo = offset === 0 ? 'Semana atual' : offset > 0 ? `+${offset} semana${offset>1?'s':''}` : `${Math.abs(offset)} semana${Math.abs(offset)>1?'s':''} atrás`;
  } else {
    const mes = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
    const ultimo = new Date(mes.getFullYear(), mes.getMonth()+1, 0);
    for (let d = new Date(mes); d <= ultimo; d.setDate(d.getDate()+1)) datas.push(fmtData(new Date(d)));
    titulo = `${MESES[mes.getMonth()]} ${mes.getFullYear()}`;
    subtitulo = 'Visão do mês';
  }

  const nomes = equipeRaw.map(r => r[0]);
  const analise = analisarEscala(escalaRaw, ausenciasRaw, nomes, datas);

  // Conta alertas por pessoa e total
  const resumoPessoa = {};
  let totalPerigo = 0, totalAtencao = 0;
  nomes.forEach(nome => {
    let perigo = 0, atencao = 0;
    datas.forEach(df => {
      const a = analise[nome]?.[df];
      if (a?.tipo === 'perigo') perigo++;
      else if (a?.tipo === 'atencao') atencao++;
    });
    resumoPessoa[nome] = { perigo, atencao };
    totalPerigo += perigo; totalAtencao += atencao;
  });

  const atualizado = hoje.toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

  function navBtn(label, novOffset, ativo=false) {
    return `<a href="/api/escalas?v=${visao}&offset=${novOffset}" style="background:${ativo?'#1a1a1a':'none'};color:${ativo?'#fff':'#555'};border:1px solid ${ativo?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:4px 12px;font-size:12px;text-decoration:none;font-weight:${ativo?600:400}">${label}</a>`;
  }

  // Legenda
  const legendaHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:10px 0;font-size:11px">
    ${Object.entries({perigo:['#fef2f2','#fca5a5','#991b1b','Alerta crítico'],atencao:['#fffbeb','#fcd34d','#92400e','Atenção'],ok:['#f0fdf4','#86efac','#166534','OK'],folga:['#eff6ff','#93c5fd','#1d4ed8','Folga'],ausencia:['#fdf4ff','#d8b4fe','#6b21a8','Ausência']}).map(([k,[bg,bd,tc,label]])=>`
    <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:${bg};border:1px solid ${bd}"></div><span style="color:#666">${label}</span></div>`).join('')}
  </div>`;

  // Visão DIA
  let conteudoGrid = '';
  if (visao === 'dia') {
    const df = datas[0];
    conteudoGrid = nomes.map(nome => {
      const a = analise[nome]?.[df];
      const turno = escalaRaw.find(r => r[0]===df&&r[2]===nome);
      const cargo = equipeRaw.find(r=>r[0]===nome)?.[1]||'';
      const { perigo, atencao } = resumoPessoa[nome];
      return `<div style="background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
          <div style="flex:1"><div style="font-size:13px;font-weight:600">${nome}</div><div style="font-size:10px;color:#888">${cargo||'Operações'}</div></div>
          ${perigo>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">${perigo} ⚠</span>`:''}
          ${atencao>0?`<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">${atencao} ⚡</span>`:''}
        </div>
        ${celulaAnalise(a, turno)}
      </div>`;
    }).join('');
    conteudoGrid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${conteudoGrid}</div>`;
  }

  // Visão SEMANA
  else if (visao === 'semana') {
    const cabecalho = `<tr>
      <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.04em;background:#fafafa;border-bottom:1px solid #f0f0f0;white-space:nowrap;width:140px">Colaborador</th>
      ${datas.map(df=>{
        const [d,m]=df.split('/');
        const dataObj=new Date(new Date().getFullYear(),parseInt(m)-1,parseInt(d));
        const isHoje=df===fmtData(hoje);
        const temAlerta=nomes.some(n=>['perigo','atencao'].includes(analise[n]?.[df]?.tipo));
        return `<th style="padding:6px 4px;text-align:center;font-size:10px;font-weight:600;color:${isHoje?'#1d4ed8':'#888'};text-transform:uppercase;letter-spacing:.04em;background:${isHoje?'#eff6ff':'#fafafa'};border-bottom:${isHoje?'2px solid #3b82f6':'1px solid #f0f0f0'};white-space:nowrap;min-width:90px">
          ${DIAS_PT[dataObj.getDay()]}<br><span style="font-weight:400">${df}</span>
          ${temAlerta?'<br><span style="font-size:8px;color:#f59e0b">⚠ alertas</span>':''}
        </th>`;
      }).join('')}
    </tr>`;

    const linhas = nomes.map(nome => {
      const cargo = equipeRaw.find(r=>r[0]===nome)?.[1]||'';
      const {perigo,atencao}=resumoPessoa[nome];
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:24px;height:24px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
            <div>
              <div style="font-size:11px;font-weight:600;white-space:nowrap">${nome.split(' ')[0]}</div>
              <div style="display:flex;gap:3px;margin-top:1px">
                ${perigo>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:0 4px;font-size:9px;font-weight:700">${perigo}⚠</span>`:''}
                ${atencao>0?`<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:0 4px;font-size:9px;font-weight:700">${atencao}⚡</span>`:''}
              </div>
            </div>
          </div>
        </td>
        ${datas.map(df=>{
          const a=analise[nome]?.[df];
          const isHoje=df===fmtData(hoje);
          return `<td style="padding:4px;border-bottom:1px solid #f5f5f5;background:${isHoje?'#eff6ff':''}">${celulaAnalise(a,null,true)}</td>`;
        }).join('')}
      </tr>`;
    }).join('');

    conteudoGrid = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${cabecalho}${linhas}</table></div>`;
  }

  // Visão MÊS — grid de dias do mês
  else {
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
    const diasSemana = primeiroDia.getDay(); // 0=dom
    const totalDias = new Date(primeiroDia.getFullYear(), primeiroDia.getMonth()+1, 0).getDate();

    // Por colaborador — accordion
    conteudoGrid = nomes.map(nome => {
      const {perigo,atencao}=resumoPessoa[nome];
      const cargo=equipeRaw.find(r=>r[0]===nome)?.[1]||'';

      // Mini calendário
      let cal = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:8px">`;
      ['D','S','T','Q','Q','S','S'].forEach(d => {
        cal += `<div style="text-align:center;font-size:9px;font-weight:600;color:#aaa;padding:2px 0">${d}</div>`;
      });
      // Células vazias antes do primeiro dia
      for (let i=0;i<diasSemana;i++) cal+=`<div></div>`;

      for (let d=1;d<=totalDias;d++) {
        const dataObj=new Date(primeiroDia.getFullYear(),primeiroDia.getMonth(),d);
        const df=fmtData(dataObj);
        const a=analise[nome]?.[df];
        const isHoje=df===fmtData(hoje);
        const c=NIVEL_COR[a?.tipo||'livre'];
        const temAlerta=a?.alertas?.length>0;
        cal+=`<div title="${a?.alertas?.map(x=>x.msg).join('\n')||''}" style="background:${c.bg};border:1px solid ${isHoje?'#3b82f6':c.border};border-radius:4px;padding:3px 2px;text-align:center;cursor:default${isHoje?';box-shadow:0 0 0 1px #3b82f6':''}">
          <div style="font-size:9px;font-weight:${isHoje?700:500};color:${c.txt}">${d}</div>
          ${a?.status&&a.tipo!=='livre'?`<div style="font-size:7px;color:${c.txt};line-height:1.1;overflow:hidden;white-space:nowrap;max-width:100%">${a.status.length>8?a.status.substring(0,8):a.status}</div>`:''}
          ${temAlerta?`<div style="width:5px;height:5px;border-radius:50%;background:${c.dot};margin:1px auto 0"></div>`:''}
        </div>`;
      }
      cal+=`</div>`;

      return `<div style="background:#fff;border:1px solid ${perigo>0?'#fca5a5':atencao>0?'#fcd34d':'#e5e5e5'};border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
          <div style="flex:1"><div style="font-size:12px;font-weight:600">${nome}</div><div style="font-size:10px;color:#888">${cargo||'Operações'}</div></div>
          <div style="display:flex;gap:4px">
            ${perigo>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">${perigo} crítico${perigo>1?'s':''}</span>`:''}
            ${atencao>0?`<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">${atencao} atenção</span>`:''}
            ${perigo===0&&atencao===0?`<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">OK</span>`:''}
          </div>
        </div>
        ${cal}
      </div>`;
    }).join('');

    conteudoGrid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">${conteudoGrid}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Escala ${visao}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a}
a{text-decoration:none}
</style>
</head><body>

<div style="background:#1a1a1a;padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100">
  <a href="/api/escalas?v=semana" style="width:28px;height:28px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;font-size:12px;font-weight:700;flex-shrink:0">P</a>
  <div>
    <div style="font-size:14px;font-weight:600;color:#fff">Pulse — Escala ${visao === 'dia' ? 'do dia' : visao === 'semana' ? 'semanal' : 'mensal'}</div>
    <div style="font-size:11px;color:#666">${titulo} · ${subtitulo}</div>
  </div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <span style="font-size:11px;color:#555">${atualizado}</span>
    <a href="/api/app" style="background:none;border:1px solid #444;border-radius:5px;padding:4px 10px;font-size:11px;color:#ccc">← Voltar</a>
  </div>
</div>

<div style="max-width:1200px;margin:0 auto;padding:16px 20px">

  <!-- Métricas -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Período</div>
      <div style="font-size:18px;font-weight:700">${datas.length} dia${datas.length>1?'s':''}</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">${nomes.length} colaboradores</div>
    </div>
    <div style="background:${totalPerigo>0?'#fef2f2':'#fff'};border:1px solid ${totalPerigo>0?'#fca5a5':'#e5e5e5'};border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Alertas críticos</div>
      <div style="font-size:24px;font-weight:700;color:${totalPerigo>0?'#dc2626':'#1a1a1a'}">${totalPerigo}</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">interjornada, consecutivos, jornada longa</div>
    </div>
    <div style="background:${totalAtencao>0?'#fffbeb':'#fff'};border:1px solid ${totalAtencao>0?'#fcd34d':'#e5e5e5'};border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Atenções</div>
      <div style="font-size:24px;font-weight:700;color:${totalAtencao>0?'#d97706':'#1a1a1a'}">${totalAtencao}</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">descanso obrigatório, 6º dia</div>
    </div>
    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Saúde da escala</div>
      <div style="font-size:24px;font-weight:700;color:${totalPerigo>0?'#dc2626':totalAtencao>0?'#d97706':'#16a34a'}">${totalPerigo>0?'Crítica':totalAtencao>0?'Atenção':'OK'}</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">${totalPerigo+totalAtencao} ocorrência${totalPerigo+totalAtencao!==1?'s':''} no período</div>
    </div>
  </div>

  <!-- Navegação visão + período -->
  <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div style="display:flex;gap:4px">
      <a href="/api/escalas?v=dia&offset=0" style="background:${visao==='dia'?'#1a1a1a':'none'};color:${visao==='dia'?'#fff':'#555'};border:1px solid ${visao==='dia'?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:5px 14px;font-size:12px;font-weight:${visao==='dia'?600:400}">Dia</a>
      <a href="/api/escalas?v=semana&offset=0" style="background:${visao==='semana'?'#1a1a1a':'none'};color:${visao==='semana'?'#fff':'#555'};border:1px solid ${visao==='semana'?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:5px 14px;font-size:12px;font-weight:${visao==='semana'?600:400}">Semana</a>
      <a href="/api/escalas?v=mes&offset=0" style="background:${visao==='mes'?'#1a1a1a':'none'};color:${visao==='mes'?'#fff':'#555'};border:1px solid ${visao==='mes'?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:5px 14px;font-size:12px;font-weight:${visao==='mes'?600:400}">Mês</a>
    </div>
    <div style="width:1px;height:20px;background:#e5e5e5"></div>
    <a href="/api/escalas?v=${visao}&offset=${offset-1}" style="border:1px solid #e5e5e5;border-radius:6px;padding:5px 12px;font-size:12px;color:#555">← Anterior</a>
    <a href="/api/escalas?v=${visao}&offset=0" style="border:1px solid #e5e5e5;border-radius:6px;padding:5px 12px;font-size:12px;color:#555${offset===0?';background:#f5f5f5':''}">Atual</a>
    <a href="/api/escalas?v=${visao}&offset=${offset+1}" style="border:1px solid #e5e5e5;border-radius:6px;padding:5px 12px;font-size:12px;color:#555">Próximo →</a>
    <div style="margin-left:auto;font-size:11px;color:#888;font-weight:600">${titulo}</div>
  </div>

  ${legendaHTML}

  <!-- Grid principal -->
  <div style="margin-top:10px">${conteudoGrid}</div>

  <!-- Rodapé regras -->
  <div style="margin-top:20px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px">
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#888;margin-bottom:8px">Regras aplicadas</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:#666">
      <span>⚠ Interjornada mínima: 11h</span>
      <span>⚠ Jornada máxima: 10h</span>
      <span>⚡ Acima de 8h: 1h descanso obrigatório</span>
      <span>⚠ 7º dia consecutivo sem folga</span>
      <span>⚡ 6º dia: aviso preventivo</span>
    </div>
  </div>
</div>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
}
