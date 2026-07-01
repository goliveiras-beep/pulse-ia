// api/escalas.js — Visão dia/semana/mês com alertas trabalhistas
export const config = { maxDuration: 60 };
import { sheetsRequest } from '../lib/google-auth.js';
import { analisarEscala, duracaoTurno } from '../lib/escalas-engine.js';
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function iniciais(n) { return n.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }

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
  } catch {
    return null;
  }
}

// Normaliza datas de qualquer formato para DD/MM — resolve legado USER_ENTERED
function normalizarDf(raw) {
  if(!raw) return '';
  const s = String(raw).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) { const p=s.split('-'); return p[2].slice(0,2).padStart(2,'0')+'/'+p[1].padStart(2,'0'); }
  if(/^\d{1,2}\/\d{1,2}/.test(s)) { const p=s.split('/'); return p[0].padStart(2,'0')+'/'+p[1].padStart(2,'0'); }
  if(/^\d{5,6}$/.test(s)) return s; // serial numérico — ignora
  return s;
}

async function getSheet(range) {
  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(range)}`);
    const values = d.values||[];
    // Normaliza coluna A (data) se for range de Escala
    if(range.includes('Escala')) {
      return values.map(r => r.length>0 ? [normalizarDf(r[0]||''), ...r.slice(1)] : r);
    }
    return values;
  }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}
async function appendSheet(range, values) {
  // Não codifica o range para evitar que A:F vire A%3AF (quebra a API de append)
  // RAW = datas ficam como texto puro, não convertidas para serial
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${range}:append?valueInputOption=RAW`,'POST',{values});
}

const NIVEL_COR = {
  danger:  { bg: 'var(--red-m-bg)',   border: 'var(--red-m-border)',   txt: 'var(--red-m-v)',   dot: '#fc8181' },
  perigo:  { bg: 'var(--red-m-bg)',   border: 'var(--red-m-border)',   txt: 'var(--red-m-v)',   dot: '#fc8181' },
  warning: { bg: 'var(--amber-m-bg)', border: 'var(--amber-m-border)', txt: 'var(--amber-m-v)', dot: '#f6ad55' },
  atencao: { bg: 'var(--amber-m-bg)', border: 'var(--amber-m-border)', txt: 'var(--amber-m-v)', dot: '#f6ad55' },
  ok:      { bg: 'var(--badge-green-bg)', border: 'var(--badge-green-c)', txt: 'var(--badge-green-c)', dot: '#68d391' },
  folga:   { bg: 'var(--today-bg)',   border: 'var(--today-border)',   txt: 'var(--today-c)',   dot: '#63b3ed' },
  ausencia:{ bg: '#1a0d2e',           border: '#6b21a8',               txt: '#c084fc',          dot: '#a855f7' },
  livre:   { bg: 'var(--card)',       border: 'var(--border)',         txt: 'var(--text3)',     dot: 'var(--border)' },
};

function alertaBadge(alerta) {
  const c = NIVEL_COR[alerta.nivel] || NIVEL_COR.warning;
  return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:4px;padding:2px 6px;font-size:9px;color:${c.txt};font-weight:600;margin-top:2px;line-height:1.3">${alerta.msg}</div>`;
}

function celulaAnalise(analise, turno, compacto=false) {
  if (!analise) return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:6px;text-align:center;color:#d1d5db;font-size:11px">--</div>`;
  const { tipo, status, alertas, durHoras } = analise;
  const c = NIVEL_COR[tipo] || NIVEL_COR.livre;
  const temAlerta = alertas && alertas.length > 0;
  const dot = temAlerta ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c.dot};margin-left:4px;vertical-align:middle"></span>` : '';
  if (compacto) {
    return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:6px;padding:5px 6px;min-height:52px">
      <div style="font-size:10px;font-weight:700;color:${c.txt}">${status||'--'}${dot}</div>
      ${durHoras ? `<div style="font-size:9px;color:${c.txt};opacity:.8">${durHoras.toFixed(1)}h</div>` : ''}
      ${temAlerta ? `<div style="font-size:8px;color:${c.dot};font-weight:700;margin-top:2px">${alertas.length} alerta${alertas.length>1?'s':''}</div>` : ''}
    </div>`;
  }
  return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:7px;padding:8px 10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${temAlerta?4:0}px">
      <span style="font-size:12px;font-weight:700;color:${c.txt}">${status||'--'}</span>
      ${durHoras ? `<span style="font-size:10px;color:${c.txt};opacity:.8">${durHoras.toFixed(1)}h</span>` : ''}
    </div>
    ${alertas ? alertas.map(a=>alertaBadge(a)).join('') : ''}
  </div>`;
}

const CHAT_IA_ESC = '\n<div id="chat-ia-btn" onclick="toggleChat()" style="position:fixed;bottom:24px;right:24px;z-index:900;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);box-shadow:0 4px 20px rgba(99,102,241,.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;transition:transform .2s" title="Assistente IA">&#10024;</div>\n\n<div id="chat-ia-box" style="display:none;position:fixed;bottom:88px;right:24px;z-index:900;width:360px;max-width:calc(100vw - 48px);background:#1e2230;border:1px solid #3d4660;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.6);overflow:hidden;flex-direction:column">\n  <div style="background:#161920;padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #2d3748">\n    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">&#10024;</div>\n    <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#e2e8f0">Pulse IA</div><div style="font-size:10px;color:#718096">Assistente operacional</div></div>\n    <button onclick="limparChat()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:14px;padding:4px" title="Limpar">&#128465;</button>\n    <button onclick="toggleChat()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:20px;padding:4px;line-height:1">&times;</button>\n  </div>\n  <div id="chat-ia-msgs" style="height:320px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">\n    <div style="background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%">Oi! Sou o assistente do Pulse. Pode me perguntar sobre escalas, cobertura de eventos, alertas trabalhistas ou qualquer duvida da operacao. &#128075;</div>\n  </div>\n  <div style="padding:10px 12px;border-top:1px solid #2d3748;display:flex;gap:8px;align-items:flex-end">\n    <textarea id="chat-ia-input" placeholder="Pergunte sobre a operacao..." rows="1" onkeydown="chatKeyDown(event)" oninput="autoResize(this)" style="flex:1;background:#2d3140;border:1px solid #3d4660;border-radius:8px;padding:8px 10px;font-size:12px;color:#e2e8f0;outline:none;resize:none;font-family:inherit;max-height:100px;line-height:1.4"></textarea>\n    <button onclick="enviarMensagem()" id="chat-ia-send" style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);border:none;border-radius:8px;width:36px;height:36px;cursor:pointer;font-size:14px;flex-shrink:0;color:#fff">&#10148;</button>\n  </div>\n</div>\n\n<style>\n@keyframes chatpulse{0%,100%{opacity:1}50%{opacity:.3}}\n#chat-ia-btn:hover{transform:scale(1.1)!important;box-shadow:0 6px 28px rgba(99,102,241,.7)!important}\n</style>\n\n<script>\nvar chatAberto=false,chatHistorico=[],chatPagina=window.location.pathname+window.location.search;\nfunction toggleChat(){\n  chatAberto=!chatAberto;\n  var box=document.getElementById(\'chat-ia-box\');\n  box.style.display=chatAberto?\'flex\':\'none\';\n  document.getElementById(\'chat-ia-btn\').style.transform=chatAberto?\'scale(0.9)\':\'scale(1)\';\n  if(chatAberto){setTimeout(function(){document.getElementById(\'chat-ia-input\').focus();},100);var m=document.getElementById(\'chat-ia-msgs\');m.scrollTop=m.scrollHeight;}\n}\nfunction autoResize(el){el.style.height=\'auto\';el.style.height=Math.min(el.scrollHeight,100)+\'px\';}\nfunction chatKeyDown(e){if(e.key===\'Enter\'&&!e.shiftKey){e.preventDefault();enviarMensagem();}}\nfunction limparChat(){\n  chatHistorico=[];\n  document.getElementById(\'chat-ia-msgs\').innerHTML=\'<div style="background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%">Conversa limpa! Como posso ajudar? &#128075;</div>\';\n}\nfunction renderMd(txt){\n  return txt.replace(/&/g,\'&amp;\').replace(/</g,\'&lt;\').replace(/>/g,\'&gt;\')\n    .replace(/\\*\\*(.+?)\\*\\*/g,\'<strong>$1</strong>\')\n    .replace(/^#{1,3} (.+)$/gm,\'<div style="font-weight:700;margin:4px 0 2px">$1</div>\')\n    .replace(/^[|].+[|]$/gm,\'\').replace(/^[-*] (.+)$/gm,\'<div style="padding-left:10px">• $1</div>\')\n    .replace(/\\n/g,\'<br>\');\n}\nfunction addMsg(texto,tipo){\n  var msgs=document.getElementById(\'chat-ia-msgs\');\n  var div=document.createElement(\'div\');\n  if(tipo===\'user\'){div.style.cssText=\'background:#1a2744;border-radius:10px 10px 2px 10px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%;align-self:flex-end\';div.textContent=texto;}\n  else if(tipo===\'load\'){div.id=\'chat-load\';div.style.cssText=\'background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#718096;max-width:90%\';div.innerHTML=\'<span style="animation:chatpulse 1s infinite">&#10024; Pensando...</span>\';}\n  else{div.style.cssText=\'background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.6;max-width:92%\';div.innerHTML=renderMd(texto);}\n  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;\n}\nasync function enviarMensagem(){\n  var input=document.getElementById(\'chat-ia-input\');\n  var texto=input.value.trim();if(!texto)return;\n  input.value=\'\';input.style.height=\'auto\';\n  addMsg(texto,\'user\');\n  chatHistorico.push({role:\'user\',content:texto});\n  var load=addMsg(\'\',\'load\');\n  var btn=document.getElementById(\'chat-ia-send\');btn.disabled=true;btn.style.opacity=\'.5\';\n  try{\n    var r=await fetch(\'/api/chat\',{method:\'POST\',credentials:\'include\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({messages:chatHistorico,pagina:chatPagina})});\n    var d=await r.json();\n    load.remove();\n    var resp=d.resposta||\'Nao consegui responder agora.\';\n    addMsg(resp,\'ia\');\n    chatHistorico.push({role:\'assistant\',content:resp});\n\n    if (d.acaoRealizada && d.acaoRealizada.status === \'success\' && [\'add_shift\',\'remove_shift\',\'swap_employee\',\'update_shift\',\'set_dayoff\',\'set_vacation\',\'set_medical_leave\'].includes(d.acaoRealizada.action)) {\n      setTimeout(function(){ location.reload(); }, 1200);\n    }\n  }catch(e){load.remove();addMsg(\'Erro de conexao. Tenta de novo!\',\'ia\');}\n  btn.disabled=false;btn.style.opacity=\'1\';\n}\n</script>';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  if (req.method === 'GET' && req.query.debug === '1') {
    const raw = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/Escala!A2:F2000`);
    const rows = (raw.values||[]).slice(0,20);
    const total = (raw.values||[]).length;
    const julho = (raw.values||[]).filter(r=>String(r[0]).includes('07'));
    return res.status(200).json({ total, primeiras20: rows, linhasJulho: julho.slice(0,20) });
  }

  if (req.method === 'POST' && req.body?.action === 'quick-generate') {
    // Gerar escala dos próximos 14 dias
    try {
      const equipeRaw2 = await getSheet('Equipe!A2:I50');
      const usuario2 = equipeRaw2.find(r=>r[0]===session.nome);
      if (usuario2?.[8] !== 'gestor') return res.status(403).json({error:'Acesso negado'});

      const escalaAtual = await getSheet('Escala!A2:F2000');
      const escalaNorm = escalaAtual.map(r=>[normalizarDf(r[0]||''),r[1]||'',r[2]||'',r[3]||'',r[4]||'',r[5]||'']);
      // existingQ: preserva dados manuais, permite sobrescrever "Gerado IA" com novo dado
      const existingQ = new Set(
        escalaAtual
          .filter(r => {
            if(!r[0]||!r[2]) return false;
            if(!r[3]&&!r[4]&&r[5]!=='Folga') return false; // linha vazia
            if(r[5]==='Gerado IA') return false; // pode ser regerado
            return true; // manual = preservar
          })
          .map(r => normalizarDf(r[0])+'|'+r[2])
      );
      const ativos = equipeRaw2.filter(r=>r[0]&&r[8]!=='pendente');
      const revQ = [...escalaNorm].reverse();
      const turnosQ = {};
      ativos.forEach(p=>{
        const regsP = escalaNorm.filter(r=>r[2]===p[0]&&r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Férias').slice(-30);
        if(!regsP.length){ const last=revQ.find(r=>r[2]===p[0]&&r[3]&&r[4]); turnosQ[p[0]]=last?{ent:last[3],sai:last[4]}:null; return; }
        const freq={};
        regsP.forEach(r=>{const k=r[3]+'|'+r[4];freq[k]=(freq[k]||0)+1;});
        const best=Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0].split('|');
        turnosQ[p[0]]={ent:best[0],sai:best[1]};
      });
      const hoje2=new Date(new Date().toLocaleString('en',{timeZone:'America/Sao_Paulo'}));
      const fmtD=d=>String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');
      const diasGerar = Math.min(30, Math.max(1, parseInt(req.body?.dias)||14));
      const linhas=[];
      for(let i=1;i<=diasGerar;i++){
        const d=new Date(hoje2); d.setDate(hoje2.getDate()+i);
        const df=fmtD(d);
        ativos.forEach(p=>{
          const t=turnosQ[p[0]];
          if(!t) return;
          if(existingQ.has(df+'|'+p[0])) return;
          linhas.push([df,'',p[0],t.ent,t.sai,'Gerado IA']);
        });
      }
      // Para cada linha a gerar: atualizar se já existe "Gerado IA", senão appendar
      const linhasNovas = [];
      for(const linha of linhas) {
        const df = linha[0], nome = linha[2];
        // Procura linha existente com "Gerado IA" para esta data/pessoa
        const idxExist = escalaAtual.findIndex(r => normalizarDf(r[0])===df && r[2]===nome && r[5]==='Gerado IA');
        if(idxExist >= 0) {
          // Atualiza a linha existente com os novos horários
          await setSheet(`Escala!A${idxExist+2}:F${idxExist+2}`, [linha]);
        } else {
          linhasNovas.push(linha);
        }
      }
      if(linhasNovas.length > 0) await appendSheet('Escala!A:F', linhasNovas);
      return res.status(200).json({ok:true, gravadas:linhas.length, atualizadas:linhas.length-linhasNovas.length, novas:linhasNovas.length});
    } catch(e) {
      return res.status(500).json({error:e.message});
    }
  }

  if (req.method === 'POST') {
    const equipeRaw2 = await getSheet('Equipe!A2:I50');
    const usuario2 = equipeRaw2.find(r=>r[0]===session.nome);
    if (usuario2?.[8] !== 'gestor') return res.status(403).json({error:'Acesso negado'});
    const {data, colaborador, ent, sai, tipo} = req.body||{};
    if (!data || !colaborador) return res.status(400).json({error:'Dados inválidos'});
    const escalaRaw2 = await getSheet('Escala!A2:F2000');
    const idx = escalaRaw2.findIndex(r=>r[0]===data&&r[2]===colaborador);

    // Excluir: limpa os campos D, E, F deixando a linha em branco
    if (tipo === 'excluir') {
      if (idx >= 0) {
        await setSheet(`Escala!A${idx+2}:F${idx+2}`, [['','','','','','']]);
      }
      return res.status(200).json({ok:true});
    }

    const obs = tipo==='folga'?'Folga':tipo==='dispensa'?'Dispensa Médica':tipo==='ferias'?'Férias':'';
    const entVal = (tipo==='folga'||tipo==='ausencia')?'':( ent||'');
    const saiVal = (tipo==='folga'||tipo==='ausencia')?'':( sai||'');
    if (idx >= 0) {
      await setSheet(`Escala!D${idx+2}:F${idx+2}`, [[entVal, saiVal, obs]]);
    } else {
      await appendSheet('Escala!A:F', [[data,'',colaborador,entVal,saiVal,obs]]);
    }
    return res.status(200).json({ok:true});
  }

  const [equipeRaw, escalaRaw, ausenciasRaw] = await Promise.all([
    getSheet('Equipe!A2:I50'),
    getSheet('Escala!A2:F2000'),
    getSheet('Ausencias!A2:I500'),
  ]);

  const usuario = equipeRaw.find(r => r[0] === session.nome);
  if (usuario?.[8] !== 'gestor') return res.redirect(302, '/api/app');

  const visao = req.query.v || 'semana';
  const hoje = getBRT();
  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
  const DIAS_FULL = ['Domingo','Segunda','Terca','Quarta','Quinta','Sexta','Sabado'];
  const MESES = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const offset = parseInt(req.query.offset || '0');
  let datas = [], titulo = '', subtitulo = '';

  if (visao === 'dia') {
    const dia = new Date(hoje); dia.setDate(hoje.getDate() + offset);
    datas = [fmtData(dia)];
    titulo = `${DIAS_FULL[dia.getDay()]}, ${dia.getDate()} de ${MESES[dia.getMonth()]}`;
    subtitulo = 'Visao do dia';
  } else if (visao === 'semana') {
    const dow = hoje.getDay();
    const seg = new Date(hoje); seg.setDate(hoje.getDate() - dow + 1 + offset * 7);
    for (let i = 0; i < 7; i++) { const d = new Date(seg); d.setDate(seg.getDate()+i); datas.push(fmtData(d)); }
    titulo = `Semana ${datas[0]} -- ${datas[6]}`;
    subtitulo = offset === 0 ? 'Semana atual' : offset > 0 ? `+${offset} semana` : `${Math.abs(offset)} semana(s) atras`;
  } else {
    const mes = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
    const ultimo = new Date(mes.getFullYear(), mes.getMonth()+1, 0);
    for (let d = new Date(mes); d <= ultimo; d.setDate(d.getDate()+1)) datas.push(fmtData(new Date(d)));
    titulo = `${MESES[mes.getMonth()]} ${mes.getFullYear()}`;
    subtitulo = 'Visao do mes';
  }

  const nomes = equipeRaw.map(r => r[0]);
  const analise = analisarEscala(escalaRaw, ausenciasRaw, nomes, datas);

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

  const legendaHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 0;font-size:11px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#fef2f2;border:1px solid #fca5a5"></div><span style="color:#666">Alerta critico</span></div>
    <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#fffbeb;border:1px solid #fcd34d"></div><span style="color:#666">Atencao</span></div>
    <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#f0fdf4;border:1px solid #86efac"></div><span style="color:#666">OK</span></div>
    <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#eff6ff;border:1px solid #93c5fd"></div><span style="color:#666">Folga</span></div>
    <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#fdf4ff;border:1px solid #d8b4fe"></div><span style="color:#666">Ausencia</span></div>
  </div>`;

  let conteudoGrid = '';

  if (visao === 'dia') {
    conteudoGrid = nomes.map((nome,idx) => {
      const df = datas[0];
      const a = analise[nome]?.[df];
      const cargo = equipeRaw.find(r=>r[0]===nome)?.[1]||'';
      const { perigo, atencao } = resumoPessoa[nome];
      const escRegDia=escalaRaw.find(r=>r[0]===df&&r[2]===nome);
      return `<div data-nome-busca="${nome}" data-cargo="${cargo.toLowerCase()}" data-ordem="${idx}" data-perigo="${perigo}" data-atencao="${atencao}" data-df="${df}" data-nome2="${nome}" data-ent="${escRegDia?.[3]||''}" data-sai="${escRegDia?.[4]||''}" data-obs="${escRegDia?.[5]||''}" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;cursor:pointer" onclick="var e=this;abrirEditor(e,e.dataset.df,e.dataset.nome2,e.dataset.ent,e.dataset.sai,e.dataset.obs)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
          <div style="flex:1"><div style="font-size:13px;font-weight:600">${nome}</div><div style="font-size:10px;color:#888">${cargo||'Operacoes'}</div></div>
          ${perigo>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">${perigo} critico</span>`:''}
          ${atencao>0?`<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">${atencao} atencao</span>`:''}
        </div>
        ${celulaAnalise(a, null)}
      </div>`;
    }).join('');
    conteudoGrid = `<div id="grid-principal" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${conteudoGrid}</div>`;
  } else if (visao === 'semana') {
    const cabecalho = `<tr>
      <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:600;color:#888;text-transform:uppercase;background:#fafafa;border-bottom:1px solid #f0f0f0;white-space:nowrap;width:140px">Colaborador</th>
      ${datas.map(df=>{
        const [d,m]=df.split('/');
        const dataObj=new Date(new Date().getFullYear(),parseInt(m)-1,parseInt(d));
        const isHoje=df===fmtData(hoje);
        return `<th style="padding:6px 4px;text-align:center;font-size:10px;font-weight:600;color:${isHoje?'#1d4ed8':'#888'};text-transform:uppercase;background:${isHoje?'var(--today-bg)':'var(--th)'};border-bottom:${isHoje?'2px solid var(--today-border)':'1px solid var(--th-border)'};white-space:nowrap;min-width:90px">
          ${DIAS_PT[dataObj.getDay()]}<br><span style="font-weight:400">${df}</span>
        </th>`;
      }).join('')}
    </tr>`;

    const linhas = nomes.map((nome,idx) => {
      const cargo = equipeRaw.find(r=>r[0]===nome)?.[1]||'';
      const {perigo,atencao}=resumoPessoa[nome];
      return `<tr data-nome-busca="${nome}" data-cargo="${cargo.toLowerCase()}" data-ordem="${idx}" data-perigo="${perigo}" data-atencao="${atencao}">
        <td style="padding:6px 10px;border-bottom:1px solid #f5f5f5">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:24px;height:24px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
            <div>
              <div style="font-size:11px;font-weight:600;white-space:nowrap;color:var(--text)">${nome}</div>
              <div style="display:flex;gap:3px;margin-top:1px">
                ${perigo>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:3px;padding:0 4px;font-size:9px;font-weight:700">${perigo}</span>`:''}
                ${atencao>0?`<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:0 4px;font-size:9px;font-weight:700">${atencao}</span>`:''}
              </div>
            </div>
          </div>
        </td>
        ${datas.map(df=>{
          const a=analise[nome]?.[df];
          const isHoje=df===fmtData(hoje);
          const escReg=escalaRaw.find(r=>r[0]===df&&r[2]===nome);
          const _ent=(escReg?.[3]||'');const _sai=(escReg?.[4]||'');const _obs=(escReg?.[5]||'');
          return `<td style="padding:4px;border-bottom:1px solid var(--td-border);background:${isHoje?'var(--today-bg)':''};cursor:pointer" data-df="${df}" data-nome="${nome}" data-ent="${_ent}" data-sai="${_sai}" data-obs="${_obs}" onclick="var el=this;abrirEditor(el,el.dataset.df,el.dataset.nome,el.dataset.ent,el.dataset.sai,el.dataset.obs)">${celulaAnalise(a,null,true)}</td>`;
        }).join('')}
      </tr>`;
    }).join('');

    conteudoGrid = `<div style="overflow-x:auto"><table id="grid-principal" style="width:100%;border-collapse:collapse">${cabecalho}<tbody id="tbody-semana">${linhas}</tbody></table></div>`;
  } else {
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
    const diasSemana = primeiroDia.getDay();
    const totalDias = new Date(primeiroDia.getFullYear(), primeiroDia.getMonth()+1, 0).getDate();

    conteudoGrid = nomes.map((nome,idx) => {
      const {perigo,atencao}=resumoPessoa[nome];
      const cargo=equipeRaw.find(r=>r[0]===nome)?.[1]||'';
      let cal = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:8px">`;
      ['D','S','T','Q','Q','S','S'].forEach(d => { cal += `<div style="text-align:center;font-size:9px;font-weight:600;color:#aaa;padding:2px 0">${d}</div>`; });
      for (let i=0;i<diasSemana;i++) cal+=`<div></div>`;
      for (let d=1;d<=totalDias;d++) {
        const dataObj=new Date(primeiroDia.getFullYear(),primeiroDia.getMonth(),d);
        const df=fmtData(dataObj);
        const a=analise[nome]?.[df];
        const isHoje=df===fmtData(hoje);
        const c=NIVEL_COR[a?.tipo||'livre']||NIVEL_COR.livre;
        const temAlerta=a?.alertas?.length>0;
        const escRegMes=escalaRaw.find(r=>r[0]===df&&r[2]===nome);
        const _mEnt=escRegMes?.[3]||'';const _mSai=escRegMes?.[4]||'';const _mObs=(escRegMes?.[5]||'').replace(/['"]/g,'');
        cal+=`<div style="background:${c.bg};border:1px solid ${isHoje?'var(--today-border)':c.border};border-radius:4px;padding:3px 2px;text-align:center;cursor:pointer" data-df="${df}" data-nome="${nome}" data-ent="${_mEnt}" data-sai="${_mSai}" data-obs="${_mObs}" onclick="var e=this;abrirEditor(e,e.dataset.df,e.dataset.nome,e.dataset.ent,e.dataset.sai,e.dataset.obs)">
          <div style="font-size:9px;font-weight:${isHoje?700:500};color:${c.txt}">${d}</div>
          ${a?.status&&a.tipo!=='livre'?`<div style="font-size:7px;color:${c.txt};overflow:hidden;white-space:nowrap">${a.status.length>8?a.status.substring(0,8):a.status}</div>`:''}
          ${temAlerta?`<div style="width:5px;height:5px;border-radius:50%;background:${c.dot};margin:1px auto 0"></div>`:''}
        </div>`;
      }
      cal+=`</div>`;
      return `<div data-nome-busca="${nome}" data-cargo="${cargo.toLowerCase()}" data-ordem="${idx}" data-perigo="${perigo}" data-atencao="${atencao}" style="background:var(--card);border:1px solid ${perigo>0?'var(--red-m-border)':atencao>0?'var(--amber-m-border)':'var(--border)'};border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${iniciais(nome)}</div>
          <div style="flex:1"><div style="font-size:12px;font-weight:600">${nome}</div><div style="font-size:10px;color:#888">${cargo||'Operacoes'}</div></div>
          <div style="display:flex;gap:4px">
            ${perigo>0?`<span style="background:#fee2e2;color:#991b1b;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">${perigo} critico</span>`:''}
            ${atencao>0?`<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">${atencao} atencao</span>`:''}
            ${perigo===0&&atencao===0?`<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">OK</span>`:''}
          </div>
        </div>
        ${cal}
      </div>`;
    }).join('');
    conteudoGrid = `<div id="grid-principal" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">${conteudoGrid}</div>`;
  }

  // Lista de cargos únicos para o dropdown de filtro
  const cargosUnicos = [...new Set(nomes.map(n => equipeRaw.find(r=>r[0]===n)?.[1]||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Escala</title>
<style>
:root{--bg:#f5f5f5;--bg2:#fff;--bg3:#fafafa;--border:#e5e5e5;--border2:#f0f0f0;--text:#1a1a1a;--text2:#555;--text3:#888;--text4:#aaa;--header:#1a1a1a;--card:#fff;--input:#fff;--th:#fafafa;--th-border:#f0f0f0;--td-border:#f5f5f5;--btn-border:#444;--btn-c:#ccc;--blue-m-bg:#eff6ff;--blue-m-border:#dbeafe;--blue-m-v:#1d4ed8;--red-m-bg:#fef2f2;--red-m-border:#fca5a5;--red-m-v:#dc2626;--amber-m-bg:#fffbeb;--amber-m-border:#fcd34d;--amber-m-v:#d97706;--badge-green-bg:#dcfce7;--badge-green-c:#166534;--badge-red-bg:#fee2e2;--badge-red-c:#991b1b;--badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;--today-bg:#eff6ff;--today-border:#3b82f6;--today-c:#1d4ed8;}
html.dark{--bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--border:#2d3748;--border2:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;--header:#161920;--card:#242836;--input:#2d3140;--th:#1e2230;--th-border:#2d3748;--td-border:#252a38;--btn-border:#3d4660;--btn-c:#a0aec0;--blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;--red-m-bg:#1f1010;--red-m-border:#3d2020;--red-m-v:#fc8181;--amber-m-bg:#1f1a0d;--amber-m-border:#3d3010;--amber-m-v:#f6ad55;--badge-green-bg:#0d2010;--badge-green-c:#68d391;--badge-red-bg:#1f1010;--badge-red-c:#fc8181;--badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;--today-bg:#1a2744;--today-border:#2a4080;--today-c:#63b3ed;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
a{text-decoration:none}
</style>
</head><body>
<div style="background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100">
  <a href="/api/app" style="width:28px;height:28px;background:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#1a1a1a;font-size:12px;font-weight:700;flex-shrink:0;text-decoration:none">P</a>
  <div><div style="font-size:14px;font-weight:600;color:#fff">Pulse - Escala</div><div style="font-size:11px;color:#666">${titulo} &middot; ${subtitulo}</div></div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <span style="font-size:11px;color:#555">${atualizado}</span>
    <button id="btn-gerar-ia" style="background:#1a2744;border:1px solid #2a4080;border-radius:5px;padding:4px 10px;font-size:11px;color:#63b3ed;cursor:pointer" onclick="gerarEscalaIA()">&#10024; Gerar escala IA</button>
    <button id="tt" onclick="toggleTheme()" style="border:1px solid var(--btn-border);border-radius:5px;padding:3px 8px;font-size:14px;background:none;cursor:pointer">&#127769;</button>
    <a href="/api/app" style="background:none;border:1px solid var(--btn-border);border-radius:5px;padding:4px 10px;font-size:11px;color:var(--btn-c)">Home</a>
  </div>
</div>
<div style="max-width:1200px;margin:0 auto;padding:16px 20px">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Periodo</div><div style="font-size:18px;font-weight:700">${datas.length} dia${datas.length>1?'s':''}</div><div style="font-size:10px;color:#aaa;margin-top:2px">${nomes.length} colaboradores</div></div>
    <div style="background:${totalPerigo>0?'#fef2f2':'var(--card)'};border:1px solid ${totalPerigo>0?'#fca5a5':'var(--border)'};border-radius:8px;padding:12px 14px"><div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;margin-bottom:4px">Alertas criticos</div><div style="font-size:24px;font-weight:700;color:${totalPerigo>0?'#dc2626':'var(--text)'}">${totalPerigo}</div><div style="font-size:10px;color:#aaa;margin-top:2px">interjornada, consecutivos</div></div>
    <div style="background:${totalAtencao>0?'#fffbeb':'var(--card)'};border:1px solid ${totalAtencao>0?'#fcd34d':'var(--border)'};border-radius:8px;padding:12px 14px"><div style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;margin-bottom:4px">Atencoes</div><div style="font-size:24px;font-weight:700;color:${totalAtencao>0?'#d97706':'var(--text)'}">${totalAtencao}</div><div style="font-size:10px;color:#aaa;margin-top:2px">descanso, 6 dia</div></div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px"><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Saude da escala</div><div style="font-size:24px;font-weight:700;color:${totalPerigo>0?'#dc2626':totalAtencao>0?'#d97706':'#16a34a'}">${totalPerigo>0?'Critica':totalAtencao>0?'Atencao':'OK'}</div><div style="font-size:10px;color:#aaa;margin-top:2px">${totalPerigo+totalAtencao} ocorrencia(s)</div></div>
  </div>
  <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div style="display:flex;gap:4px">
      <a href="/api/escalas?v=dia&offset=0" style="background:${visao==='dia'?'#1a1a1a':'none'};color:${visao==='dia'?'#fff':'#555'};border:1px solid ${visao==='dia'?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:5px 14px;font-size:12px">Dia</a>
      <a href="/api/escalas?v=semana&offset=0" style="background:${visao==='semana'?'#1a1a1a':'none'};color:${visao==='semana'?'#fff':'#555'};border:1px solid ${visao==='semana'?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:5px 14px;font-size:12px">Semana</a>
      <a href="/api/escalas?v=mes&offset=0" style="background:${visao==='mes'?'#1a1a1a':'none'};color:${visao==='mes'?'#fff':'#555'};border:1px solid ${visao==='mes'?'#1a1a1a':'#e5e5e5'};border-radius:6px;padding:5px 14px;font-size:12px">Mes</a>
    </div>
    <div style="width:1px;height:20px;background:#e5e5e5"></div>
    <a href="/api/escalas?v=${visao}&offset=${offset-1}" style="border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--text2)">Anterior</a>
    <a href="/api/escalas?v=${visao}&offset=0" style="border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--text2)${offset===0?';background:var(--bg3)':''}">Atual</a>
    <a href="/api/escalas?v=${visao}&offset=${offset+1}" style="border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--text2)">Proximo</a>
    <div style="margin-left:auto;font-size:11px;color:#888;font-weight:600">${titulo}</div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <div style="display:flex;gap:4px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:3px">
      <button id="view-grid" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer">&#x229E;</button>
      <button id="view-list" style="background:none;color:#888;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer">&#9776;</button>
    </div>
    <div style="display:flex;gap:4px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:3px">
      <button id="sort-default" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600">Padrao</button>
      <button id="sort-alpha" style="background:none;color:#888;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600">A-Z</button>
      <button id="sort-alerta" style="background:none;color:#888;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600">Alertas</button>
    </div>
    <select id="filtro-cargo" style="border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;background:var(--card);color:var(--text);outline:none;cursor:pointer;min-width:140px">
      <option value="">▾ Todos os cargos</option>
      ${cargosUnicos.map(c=>`<option value="${c.toLowerCase()}">${c}</option>`).join('')}
    </select>
    <input id="busca" placeholder="Buscar colaborador..." style="flex:1;min-width:160px;border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:12px;outline:none;background:var(--input);color:var(--text)">
  </div>
  ${legendaHTML}
  <div style="margin-top:10px" id="container-grid">${conteudoGrid}</div>
  <div style="margin-top:20px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px">
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;color:#888;margin-bottom:8px">Regras aplicadas</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text2)">
      <span>Interjornada minima: 11h</span><span>Jornada maxima: 10h</span><span>Acima de 8h: 1h descanso</span><span>7 dia consecutivo sem folga</span><span>6 dia: aviso preventivo</span>
    </div>
  </div>
</div>
<script>
var viewAtual=localStorage.getItem('esc-view')||'grid',sortAtual=localStorage.getItem('esc-sort')||'default',visaoAtual='${visao}';
function getItens(){if(visaoAtual==='semana')return Array.from(document.querySelectorAll('#tbody-semana tr[data-nome-busca]'));return Array.from(document.querySelectorAll('#grid-principal [data-nome-busca]'));}
function aplicarFiltros(){
  var busca=document.getElementById('busca').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  var cargo=document.getElementById('filtro-cargo').value;
  var itens=getItens();
  itens.forEach(function(el){
    var nomeMatch=el.getAttribute('data-nome-busca').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(busca);
    var cargoMatch=!cargo||el.getAttribute('data-cargo').includes(cargo);
    el.style.display=(nomeMatch&&cargoMatch)?'':'none';
  });
  var visiveis=itens.filter(function(el){return el.style.display!=='none';});
  if(sortAtual==='alpha')visiveis.sort(function(a,b){return a.getAttribute('data-nome-busca').localeCompare(b.getAttribute('data-nome-busca'),'pt-BR');});
  else if(sortAtual==='alerta')visiveis.sort(function(a,b){var pa=parseInt(a.getAttribute('data-perigo')||0),pb=parseInt(b.getAttribute('data-perigo')||0),aa=parseInt(a.getAttribute('data-atencao')||0),ab=parseInt(b.getAttribute('data-atencao')||0);return(pb*10+ab)-(pa*10+aa);});
  else visiveis.sort(function(a,b){return parseInt(a.getAttribute('data-ordem'))-parseInt(b.getAttribute('data-ordem'));});
  var parent=visiveis.length>0?visiveis[0].parentNode:null;
  if(parent)visiveis.forEach(function(el){parent.appendChild(el);});
  if(visaoAtual!=='semana'){var grid=document.getElementById('grid-principal');if(grid){if(viewAtual==='grid'){grid.style.display='grid';grid.style.gridTemplateColumns=visaoAtual==='mes'?'repeat(auto-fit,minmax(280px,1fr))':'repeat(auto-fit,minmax(220px,1fr))';grid.style.gap='12px';}else{grid.style.display='flex';grid.style.flexDirection='column';grid.style.gap='6px';}}}
}
function setBtn(id){['sort-default','sort-alpha','sort-alerta','view-grid','view-list'].forEach(function(bid){var b=document.getElementById(bid);if(!b)return;if(bid===id){b.style.background='var(--text)';b.style.color='var(--bg)';}else if(bid.startsWith(id.split('-')[0])){b.style.background='none';b.style.color='var(--text3)';}});}
document.getElementById('view-grid').addEventListener('click',function(){viewAtual='grid';localStorage.setItem('esc-view','grid');setBtn('view-grid');aplicarFiltros();});
document.getElementById('view-list').addEventListener('click',function(){viewAtual='list';localStorage.setItem('esc-view','list');setBtn('view-list');aplicarFiltros();});
document.getElementById('sort-default').addEventListener('click',function(){sortAtual='default';localStorage.setItem('esc-sort','default');setBtn('sort-default');aplicarFiltros();});
document.getElementById('sort-alpha').addEventListener('click',function(){sortAtual='alpha';localStorage.setItem('esc-sort','alpha');setBtn('sort-alpha');aplicarFiltros();});
document.getElementById('sort-alerta').addEventListener('click',function(){sortAtual='alerta';localStorage.setItem('esc-sort','alerta');setBtn('sort-alerta');aplicarFiltros();});
document.getElementById('busca').addEventListener('input',function(){localStorage.setItem('esc-busca',this.value);aplicarFiltros();});
document.getElementById('filtro-cargo').addEventListener('change',function(){localStorage.setItem('esc-cargo',this.value);aplicarFiltros();});
// Restaurar filtros ao carregar a página
(function(){
  var b=localStorage.getItem('esc-busca')||'';
  var c=localStorage.getItem('esc-cargo')||'';
  if(b){document.getElementById('busca').value=b;}
  if(c){var sel=document.getElementById('filtro-cargo');if(sel)sel.value=c;}
  // Restaurar visual dos botões sort/view
  setBtn('sort-'+sortAtual);
  setBtn('view-'+viewAtual);
  aplicarFiltros();
})();
function toggleTheme(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'\u2600\uFE0F':'\uD83C\uDF19';}
</script>
<div id="editor-popup" style="display:none;position:fixed;z-index:500;background:#242836;border:1px solid #3d4660;border-radius:10px;padding:16px;min-width:240px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="font-size:11px;font-weight:600;color:#a0aec0" id="editor-titulo">Editar turno</div>
    <span style="font-size:9px;color:#4a5568;background:#1e2230;border-radius:4px;padding:2px 6px">Del = excluir rápido</span>
  </div>
  <div id="editor-tipo-btns" style="display:flex;gap:4px;margin-bottom:12px">
    <button onclick="setTipo('turno')" id="btn-tipo-turno" style="flex:1;padding:5px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #3d4660;background:#1a2744;color:#63b3ed">Turno</button>
    <button onclick="setTipo('folga')" id="btn-tipo-folga" style="flex:1;padding:5px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #3d4660;background:none;color:#a0aec0">Folga</button>
    <button onclick="setTipo('dispensa')" id="btn-tipo-dispensa" style="flex:1;padding:5px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #3d4660;background:none;color:#a0aec0">Dispensa</button>
    <button onclick="setTipo('ferias')" id="btn-tipo-ferias" style="flex:1;padding:5px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #3d4660;background:none;color:#a0aec0">Ferias</button>
  </div>
  <div id="editor-horarios">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div><div style="font-size:10px;color:#718096;margin-bottom:3px">Entrada</div><input id="editor-ent" type="text" placeholder="HH:MM" maxlength="5" style="width:100%;background:#1e2230;border:1px solid #3d4660;border-radius:5px;padding:6px 8px;font-size:15px;color:#e2e8f0;outline:none;font-family:monospace"></div>
      <div><div style="font-size:10px;color:#718096;margin-bottom:3px">Saída</div><input id="editor-sai" type="text" placeholder="HH:MM" maxlength="5" style="width:100%;background:#1e2230;border:1px solid #3d4660;border-radius:5px;padding:6px 8px;font-size:15px;color:#e2e8f0;outline:none;font-family:monospace"></div>
    </div>
  </div>
  <div style="display:flex;gap:6px;margin-top:4px">
    <button onclick="excluirTurno()" id="btn-excluir" style="background:#1f1010;border:1px solid #dc2626;border-radius:5px;padding:6px 10px;font-size:11px;color:#fc8181;cursor:pointer" title="Excluir (Del)">🗑 Excluir</button>
    <button onclick="copiarTurno()" style="background:#1e2230;border:1px solid #3d4660;border-radius:5px;padding:6px 10px;font-size:11px;color:#a0aec0;cursor:pointer">Copiar</button>
    <button onclick="fecharEditor()" style="background:none;border:1px solid #3d4660;border-radius:5px;padding:6px 10px;font-size:11px;color:#a0aec0;cursor:pointer">✕</button>
    <button onclick="salvarEdicao()" style="flex:1;background:#1d4ed8;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">Salvar</button>
  </div>
</div>
<div id="editor-overlay" onclick="fecharEditor()" style="display:none;position:fixed;inset:0;z-index:499"></div>
<div id="toast-esc" style="position:fixed;bottom:20px;right:20px;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;z-index:600;display:none;max-width:280px"></div>
<script>
var editorData={},clipboard=null;
function abrirEditor(el,data,nome,ent,sai,obs){
  editorData={el,data,nome,ent,sai,obs};
  document.getElementById('editor-titulo').textContent=nome+' · '+data;
  var tipo='turno';
  if(obs==='Folga')tipo='folga';
  else if(obs==='Dispensa Médica')tipo='dispensa';
  else if(obs==='Férias')tipo='ferias';
  setTipo(tipo);
  document.getElementById('editor-ent').value=ent||'';
  document.getElementById('editor-sai').value=sai||'';
  var rect=el.getBoundingClientRect(),popup=document.getElementById('editor-popup');
  popup.style.display='block';
  document.getElementById('editor-overlay').style.display='block';
  var top=rect.bottom+4,left=rect.left;
  if(top+260>window.innerHeight)top=Math.max(10,rect.top-270);
  if(left+260>window.innerWidth)left=Math.max(10,window.innerWidth-270);
  popup.style.top=top+'px';popup.style.left=left+'px';
  setTimeout(function(){document.getElementById('editor-ent').focus();document.getElementById('editor-ent').select();},80);
}
// Navegação Tab/Enter entre campos
document.getElementById('editor-ent').addEventListener('keydown',function(e){if(e.key==='Tab'||e.key==='Enter'){e.preventDefault();document.getElementById('editor-sai').focus();}});
document.getElementById('editor-sai').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();salvarEdicao();}});
function setTipo(tipo){editorData.tipo=tipo;['turno','folga','dispensa','ferias'].forEach(function(t){var btn=document.getElementById('btn-tipo-'+t);if(t===tipo){var bgs={turno:'#1a2744',folga:'#1f1a0d',dispensa:'#1a0d2e',ferias:'#0d2010'},clrs={turno:'#63b3ed',folga:'#f6ad55',dispensa:'#c084fc',ferias:'#68d391'},bds={turno:'#2a4080',folga:'#3d3010',dispensa:'#6b21a8',ferias:'#166534'};btn.style.background=bgs[t]||'none';btn.style.color=clrs[t]||'#a0aec0';btn.style.borderColor=bds[t]||'#3d4660';}else{btn.style.background='none';btn.style.color='#a0aec0';btn.style.borderColor='#3d4660';}});document.getElementById('editor-horarios').style.display=tipo==='turno'?'block':'none';}
function fecharEditor(){document.getElementById('editor-popup').style.display='none';document.getElementById('editor-overlay').style.display='none';}
function copiarTurno(){clipboard={ent:document.getElementById('editor-ent').value,sai:document.getElementById('editor-sai').value,tipo:editorData.tipo};toast('Turno copiado!','#166634');fecharEditor();}
async function salvarEdicao(){var ent=document.getElementById('editor-ent').value,sai=document.getElementById('editor-sai').value,tipo=editorData.tipo||'turno';if(tipo==='turno'&&(!ent||!sai)){toast('Informe entrada e saida','#dc2626');return;}var btn=document.querySelector('#editor-popup button:last-child');btn.textContent='Salvando...';btn.disabled=true;try{var r=await fetch('/api/escalas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:editorData.data,colaborador:editorData.nome,ent,sai,tipo})});var d=await r.json();if(d.ok){fecharEditor();toast('Salvo!','#166634');setTimeout(function(){location.reload();},800);}else{toast('Erro: '+d.error,'#dc2626');btn.textContent='Salvar';btn.disabled=false;}}catch(e){toast('Erro de conexao','#dc2626');btn.textContent='Salvar';btn.disabled=false;}}
function toast(msg,bg){var t=document.getElementById('toast-esc');t.textContent=msg;t.style.background=bg||'#1a1a1a';t.style.display='block';setTimeout(function(){t.style.display='none';},2500);}
async function excluirTurno(){
  var d=editorData;
  if(!d.data||!d.nome){fecharEditor();return;}
  // Se a célula está vazia (sem turno), só fechar
  if(!d.ent&&!d.sai&&!d.obs){toast('Célula já está vazia','#718096');fecharEditor();return;}
  var btn=document.getElementById('btn-excluir');
  btn.textContent='Excluindo...';btn.disabled=true;
  try{
    var r=await fetch('/api/escalas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d.data,colaborador:d.nome,ent:'',sai:'',tipo:'excluir'})});
    var res=await r.json();
    if(res.ok){fecharEditor();toast('🗑 Turno excluído','#dc2626');setTimeout(function(){location.reload();},600);}
    else{toast('Erro: '+res.error,'#dc2626');btn.textContent='🗑 Excluir';btn.disabled=false;}
  }catch(e){toast('Erro de conexão','#dc2626');btn.textContent='🗑 Excluir';btn.disabled=false;}
}
// ── Célula em foco para Ctrl+C e Ctrl+V direto ──────────────────────────────
var _celFoco = null; // {el, df, nome, ent, sai, obs}

// Tracking via mouseover nas células
document.addEventListener('mouseover', function(e) {
  var td = e.target.closest('[data-df][data-nome]') || e.target.closest('[data-df][data-nome2]');
  if(td) _celFoco = {el:td, df:td.dataset.df||td.dataset.df, nome:td.dataset.nome||td.dataset.nome2, ent:td.dataset.ent||'', sai:td.dataset.sai||'', obs:td.dataset.obs||''};
});

document.addEventListener('keydown',function(e){
  var popupAberto=document.getElementById('editor-popup').style.display!=='none';

  // Ctrl+V direto na célula (popup fechado)
  if((e.ctrlKey||e.metaKey)&&e.key==='v'&&!popupAberto&&clipboard&&_celFoco){
    e.preventDefault();
    colarDireto(_celFoco);
    return;
  }

  // Ctrl+V no popup (popup aberto) — preenche campos
  if((e.ctrlKey||e.metaKey)&&e.key==='v'&&popupAberto&&clipboard){
    e.preventDefault();
    setTipo(clipboard.tipo||'turno');
    document.getElementById('editor-ent').value=clipboard.ent||'';
    document.getElementById('editor-sai').value=clipboard.sai||'';
    document.getElementById('editor-sai').focus();
    toast('Colado: '+clipboard.ent+' → '+clipboard.sai,'#166634');
    return;
  }

  // Ctrl+C — copia célula em foco ou turno do popup
  if((e.ctrlKey||e.metaKey)&&e.key==='c') {
    if(popupAberto) { e.preventDefault(); copiarTurno(); return; }
    if(_celFoco&&_celFoco.ent) {
      e.preventDefault();
      clipboard={ent:_celFoco.ent,sai:_celFoco.sai,tipo:'turno'};
      toast('Copiado: '+_celFoco.ent+' → '+_celFoco.sai,'#166634');
      // Destaca a célula brevemente
      if(_celFoco.el){_celFoco.el.style.outline='2px solid #1d4ed8';setTimeout(function(){if(_celFoco.el)_celFoco.el.style.outline='';},600);}
    }
    return;
  }

  if(!popupAberto) return;
  var emInput=document.activeElement&&(document.activeElement.id==='editor-ent'||document.activeElement.id==='editor-sai');
  if((e.key==='Delete'||e.key==='Backspace')&&!emInput){e.preventDefault();excluirTurno();}
  if(e.key==='Escape'){fecharEditor();}
  if(e.key==='Enter'&&!emInput){e.preventDefault();salvarEdicao();}
  if(e.key==='Tab'&&document.activeElement.id==='editor-ent'){e.preventDefault();document.getElementById('editor-sai').focus();}
});

async function gerarEscalaIA(){
  var btn=document.getElementById('btn-gerar-ia');
  btn.textContent='⏳ Gerando...';btn.disabled=true;btn.style.color='#a0aec0';
  try{
    var r=await fetch('/api/escalas',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'quick-generate'})});
    var d=await r.json();
    if(d.ok){
      btn.textContent='✓ '+d.gravadas+' turnos gerados!';btn.style.background='#0d2010';btn.style.color='#68d391';btn.style.borderColor='#166534';
      toast(d.gravadas+' linhas gravadas para os próximos 14 dias','#166634');
      setTimeout(function(){location.reload();},1500);
    } else {
      btn.textContent='✨ Gerar escala IA';btn.disabled=false;btn.style.color='#63b3ed';
      toast('Erro: '+(d.error||'?'),'#dc2626');
    }
  }catch(e){
    btn.textContent='✨ Gerar escala IA';btn.disabled=false;btn.style.color='#63b3ed';
    toast('Erro de conexão: '+e.message,'#dc2626');
  }
}
  if(!clipboard||!cel.df||!cel.nome) return;
  toast('Colando...','#374151');
  try {
    var r=await fetch('/api/escalas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:cel.df,colaborador:cel.nome,ent:clipboard.ent,sai:clipboard.sai,tipo:clipboard.tipo||'turno'})});
    var d=await r.json();
    if(d.ok){toast('✓ '+cel.nome+' '+cel.df+' → '+clipboard.ent+'-'+clipboard.sai,'#166634');setTimeout(function(){location.reload();},800);}
    else toast('Erro: '+d.error,'#dc2626');
  } catch(e){toast('Erro de conexão','#dc2626');}
}
</script>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html + CHAT_IA_ESC);
}
