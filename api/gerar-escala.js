// api/gerar-escala.js — Geração automática de escala via IA
export const config = { maxDuration: 60 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const AIRTABLE_BASE = 'appwE9LmmTxynTGFY';
const AIRTABLE_TABLE = 'tblpibvwAIGBQXr0H';
const COOKIE_NAME = 'pulse_session';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function hash(s) { return createHash('sha256').update(s + process.env.PULSE_SECRET || 'pulse2026').digest('hex').slice(0,32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const[k,...v]=c.trim().split('=');cookies[k.trim()]=v.join('=');});
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const [nome,h,ts] = d.split('|');
    if (Date.now()-parseInt(ts) > 7*24*3600*1000) return null;
    if (h !== hash(nome+ts)) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}

async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}

async function getEventosPeriodo(dataInicio, dataFim) {
  const filter = `AND(DATESTR({fldRnfbwPVzFiHMqs})>='${dataInicio}',DATESTR({fldRnfbwPVzFiHMqs})<='${dataFim}')`;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=200&sort[0][field]=fldRnfbwPVzFiHMqs&sort[0][direction]=asc`,
      {headers:{Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`}});
    const d = await r.json();
    return (d.records||[]).map(r=>({
      data: r.fields['fldRnfbwPVzFiHMqs']?.split('T')[0] || '',
      hora: r.fields['Horário KO']||r.fields['PGM (horário)']||'',
      nome: r.fields['Match ID']||'Evento',
      tipo: r.fields['Tipo de Conteúdo']||'',
    }));
  } catch { return []; }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  const [equipeRaw, escalaRaw] = await Promise.all([
    getSheet('Equipe!A2:I50'),
    getSheet('Escala!A2:F500'),
  ]);

  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  const hoje = getBRT();
  const inicio = new Date(hoje); inicio.setDate(hoje.getDate()+1);
  const fim = new Date(hoje); fim.setDate(hoje.getDate()+14);

  // GET — mostra a página de preview
  if (req.method === 'GET' || req.method !== 'POST') {

    // Busca histórico das últimas 3 semanas
    const h3semanas = new Date(hoje); h3semanas.setDate(hoje.getDate()-21);
    const h3str = fmtData(h3semanas);
    const hojeStr = fmtData(hoje);

    // Filtra escala histórica (últimas 3 semanas)
    const escalaHist = escalaRaw.filter(r => r[0] >= h3str && r[0] <= hojeStr && r[3] && r[4] && r[5] !== 'Folga');

    // Descobre turno predominante de cada pessoa
    const turnos = {};
    const ativos = equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo');
    ativos.forEach(pessoa => {
      const nome = pessoa[0];
      const registros = escalaHist.filter(r=>r[2]===nome);
      if (registros.length === 0) { turnos[nome] = null; return; }
      // Agrupa por entrada+saida e pega o mais frequente
      const freq = {};
      registros.forEach(r => {
        const k = `${r[3]}|${r[4]}`;
        freq[k] = (freq[k]||0) + 1;
      });
      const dominant = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
      const [ent, sai] = dominant[0].split('|');
      turnos[nome] = { ent, sai, freq: dominant[1], total: registros.length };
    });

    // Busca eventos dos próximos 14 dias
    const eventos = await getEventosPeriodo(fmtAirtable(inicio), fmtAirtable(fim));

    // Gera os 14 dias
    const dias = [];
    for (let i=1; i<=14; i++) {
      const d = new Date(hoje); d.setDate(hoje.getDate()+i);
      dias.push(d);
    }

    // Monta proposta: replica turno de cada pessoa para cada dia
    const proposta = [];
    dias.forEach(d => {
      const df = fmtData(d);
      const dataAT = fmtAirtable(d);
      const evsDia = eventos.filter(e => e.data === dataAT);
      ativos.forEach(pessoa => {
        const nome = pessoa[0];
        const t = turnos[nome];
        if (!t) return;
        // Verifica se já existe na planilha
        const jaExiste = escalaRaw.find(r=>r[0]===df&&r[2]===nome);
        proposta.push({
          data: df,
          dataAT,
          nome,
          ent: t.ent,
          sai: t.sai,
          obs: '',
          turnoBase: `${t.ent}--${t.sai}`,
          jaExiste: !!jaExiste,
          evsDia: evsDia.length,
        });
      });
    });

    // Chama Claude para analisar e sugerir ajustes
    const resumoTurnos = ativos.map(p => {
      const t = turnos[p[0]];
      return t ? `${p[0]}: turno ${t.ent}-${t.sai} (${t.freq}/${t.total} dias)` : `${p[0]}: sem histórico`;
    }).join('\n');

    const resumoEventos = dias.map(d => {
      const df = fmtData(d);
      const dataAT = fmtAirtable(d);
      const evsDia = eventos.filter(e => e.data === dataAT);
      const primEv = evsDia[0];
      const ultEv = evsDia[evsDia.length-1];
      return `${df}: ${evsDia.length} eventos${primEv?' | primeiro: '+primEv.hora+' '+primEv.nome:''}${ultEv&&ultEv!==primEv?' | último: '+ultEv.hora+' '+ultEv.nome:''}`;
    }).join('\n');

    let analiseIA = '';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Você é um gestor de operações de TV ao vivo. Analise os turnos da equipe e os eventos dos próximos 14 dias e dê observações CURTAS e PRÁTICAS (máx 5 bullets) sobre cobertura, riscos ou ajustes recomendados. Seja direto, em português brasileiro.

TURNOS ATUAIS DA EQUIPE:
${resumoTurnos}

EVENTOS DOS PRÓXIMOS 14 DIAS:
${resumoEventos}

Responda com bullets curtos (• ) sobre riscos de cobertura, horários críticos ou recomendações.`
          }]
        })
      });
      const d = await r.json();
      analiseIA = d.content?.[0]?.text?.trim() || '';
    } catch { analiseIA = 'Análise indisponível no momento.'; }

    // Monta HTML de preview
    const linhasTabela = dias.map(d => {
      const df = fmtData(d);
      const dataAT = fmtAirtable(d);
      const evsDia = eventos.filter(e => e.data === dataAT);
      const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      const diaSem = DIAS_PT[d.getDay()];
      const isFds = d.getDay() === 0 || d.getDay() === 6;

      const pessoasHtml = ativos.map(p => {
        const t = turnos[p[0]];
        if (!t) return `<td style="padding:4px 6px;font-size:10px;color:#718096;text-align:center">—</td>`;
        return `<td style="padding:4px 6px;font-size:10px;color:#7dd3fc;font-weight:600;text-align:center;white-space:nowrap">${t.ent}–${t.sai}</td>`;
      }).join('');

      return `<tr style="background:${isFds?'#1a1f2e':''}">
        <td style="padding:6px 10px;white-space:nowrap;border-bottom:1px solid #2d3748">
          <div style="font-size:11px;font-weight:700;color:${isFds?'#f6ad55':'#e2e8f0'}">${diaSem} ${df}</div>
          <div style="font-size:9px;color:#718096">${evsDia.length} eventos${evsDia[0]?' · '+evsDia[0].hora:''}</div>
        </td>
        ${pessoasHtml}
      </tr>`;
    }).join('');

    const cabecalho = ativos.map(p => {
      const t = turnos[p[0]];
      const primeiroNome = p[0].split(' ')[0];
      return `<th style="padding:6px 8px;font-size:9px;font-weight:600;color:#a0aec0;text-transform:uppercase;white-space:nowrap;background:#1e2230;border-bottom:1px solid #2d3748">${primeiroNome}<br><span style="color:#7dd3fc;font-weight:700">${t?t.ent+'–'+t.sai:'?'}</span></th>`;
    }).join('');

    const analiseHtml = analiseIA.split('\n').filter(l=>l.trim()).map(l =>
      `<div style="padding:4px 0;font-size:12px;color:#e2e8f0;border-bottom:1px solid #2d3748">${l}</div>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Gerar Escala</title>
<style>
:root{--bg:#f5f5f5;--card:#fff;--text:#1a1a1a;--header:#1a1a1a;--border:#e5e5e5}
html.dark{--bg:#1c1f26;--card:#242836;--text:#e2e8f0;--header:#161920;--border:#2d3748}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
</style>
</head><body>

<div style="background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100">
  <a href="/api/app" style="width:28px;height:28px;background:#2d3748;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-size:12px;font-weight:700;text-decoration:none">P</a>
  <div>
    <div style="font-size:14px;font-weight:600;color:#fff">Pulse — Gerar Escala IA</div>
    <div style="font-size:11px;color:#718096">Proposta para os próximos 14 dias · ${fmtData(inicio)} a ${fmtData(fim)}</div>
  </div>
  <div style="margin-left:auto;display:flex;gap:8px">
    <a href="/api/app" style="background:none;border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;text-decoration:none">← Home</a>
  </div>
</div>

<div style="max-width:1300px;margin:0 auto;padding:16px 20px">

  <!-- Análise IA -->
  <div style="background:#242836;border:1px solid #2d3748;border-radius:10px;padding:16px;margin-bottom:16px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#718096;margin-bottom:10px">Análise da IA ✨</div>
    ${analiseHtml}
  </div>

  <!-- Tabela de proposta -->
  <div style="background:#242836;border:1px solid #2d3748;border-radius:10px;overflow:hidden;margin-bottom:16px">
    <div style="padding:12px 16px;border-bottom:1px solid #2d3748;display:flex;align-items:center;gap:10px">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#a0aec0">Proposta de escala</span>
      <span style="background:#1a2744;color:#63b3ed;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600">${proposta.filter(p=>!p.jaExiste).length} novas entradas</span>
      ${proposta.filter(p=>p.jaExiste).length>0?`<span style="background:#2d1f00;color:#f6ad55;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600">${proposta.filter(p=>p.jaExiste).length} sobrescritas</span>`:''}
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:6px 10px;text-align:left;font-size:9px;font-weight:600;color:#718096;text-transform:uppercase;background:#1e2230;border-bottom:1px solid #2d3748;white-space:nowrap;min-width:120px">Dia / Eventos</th>
            ${cabecalho}
          </tr>
        </thead>
        <tbody>${linhasTabela}</tbody>
      </table>
    </div>
  </div>

  <!-- Botão confirmar -->
  <div style="background:#242836;border:1px solid #2d3748;border-radius:10px;padding:16px;display:flex;align-items:center;gap:16px">
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600;color:#e2e8f0">Confirmar e gravar na planilha</div>
      <div style="font-size:11px;color:#718096;margin-top:2px">Isso vai escrever ${proposta.length} linhas na aba Escala do Google Sheets. Você pode ajustar depois.</div>
    </div>
    <button onclick="confirmar()" id="btn-confirmar" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;cursor:pointer">Gravar escala ✓</button>
  </div>

</div>

<div id="toast" style="position:fixed;bottom:20px;right:20px;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;z-index:300;display:none;max-width:300px"></div>

<script>
async function confirmar(){
  const btn = document.getElementById('btn-confirmar');
  btn.textContent = 'Gravando...';
  btn.disabled = true;
  btn.style.background = '#374151';
  try {
    const r = await fetch('/api/gerar-escala', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({confirmar:true})});
    const d = await r.json();
    if(d.ok){
      btn.textContent = '✓ Gravado! Abrindo escala...';
      btn.style.background = '#166534';
      setTimeout(()=>window.location='/api/escalas?v=semana&offset=1', 1500);
    } else {
      btn.textContent = 'Gravar escala ✓';
      btn.disabled = false;
      btn.style.background = '#1d4ed8';
      toast('Erro: '+d.error, '#dc2626');
    }
  } catch(e){
    btn.textContent = 'Gravar escala ✓';
    btn.disabled = false;
    btn.style.background = '#1d4ed8';
    toast('Erro de conexão', '#dc2626');
  }
}
function toast(msg,bg){const t=document.getElementById('toast');t.textContent=msg;t.style.background=bg||'#1a1a1a';t.style.display='block';setTimeout(()=>t.style.display='none',3000);}
</script>
</body></html>`;

    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  // POST — grava na planilha
  if (req.method === 'POST') {
    try {
      const h3semanas = new Date(hoje); h3semanas.setDate(hoje.getDate()-21);
      const h3str = fmtData(h3semanas);
      const hojeStr = fmtData(hoje);
      const escalaHist = escalaRaw.filter(r=>r[0]>=h3str&&r[0]<=hojeStr&&r[3]&&r[4]&&r[5]!=='Folga');

      // Descobre turno predominante
      const ativos = equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo');
      const turnos = {};
      ativos.forEach(pessoa => {
        const nome = pessoa[0];
        const registros = escalaHist.filter(r=>r[2]===nome);
        if (!registros.length) { turnos[nome] = null; return; }
        const freq = {};
        registros.forEach(r=>{ const k=`${r[3]}|${r[4]}`; freq[k]=(freq[k]||0)+1; });
        const [ent,sai] = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0].split('|');
        turnos[nome] = { ent, sai };
      });

      // Gera linhas para os próximos 14 dias
      const novasLinhas = [];
      for (let i=1; i<=14; i++) {
        const d = new Date(hoje); d.setDate(hoje.getDate()+i);
        const df = fmtData(d);
        ativos.forEach(p => {
          const t = turnos[p[0]];
          if (!t) return;
          novasLinhas.push([df, '', p[0], t.ent, t.sai, '']);
        });
      }

      // Remove entradas futuras existentes e reescreve
      const passado = escalaRaw.filter(r => r[0] <= fmtData(hoje));
      const todas = [...passado, ...novasLinhas];

      // Escreve de volta na planilha
      await setSheet('Escala!A2:F' + (todas.length + 2), todas);

      return res.status(200).json({ ok: true, gravadas: novasLinhas.length });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
}
