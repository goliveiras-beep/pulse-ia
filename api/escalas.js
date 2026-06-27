// api/escalas.js — Visão dia/semana/mês com alertas trabalhistas
export const config = { maxDuration: 60 };
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
function hash(s) { return createHash('sha256').update(s + process.env.PULSE_SECRET || 'pulse2026').digest('hex').slice(0,32); }

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
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}
async function appendSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,'POST',{values});
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

const CHAT_IA_ESC = '\n<div id="chat-ia-btn" onclick="toggleChat()" style="position:fixed;bottom:24px;right:24px;z-index:900;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);box-shadow:0 4px 20px rgba(99,102,241,.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;transition:transform .2s" title="Assistente IA">&#10024;</div>\n\n<div id="chat-ia-box" style="display:none;position:fixed;bottom:88px;right:24px;z-index:900;width:360px;max-width:calc(100vw - 48px);background:#1e2230;border:1px solid #3d4660;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.6);overflow:hidden;flex-direction:column">\n  <div style="background:#161920;padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #2d3748">\n    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">&#10024;</div>\n    <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#e2e8f0">Pulse IA</div><div style="font-size:10px;color:#718096">Assistente operacional</div></div>\n    <button onclick="limparChat()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:14px;padding:4px" title="Limpar">&#128465;</button>\n    <button onclick="toggleChat()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:20px;padding:4px;line-height:1">&times;</button>\n  </div>\n  <div id="chat-ia-msgs" style="height:320px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">\n    <div style="background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%">Oi! Sou o assistente do Pulse. Pode me perguntar sobre escalas, cobertura de eventos, alertas trabalhistas ou qualquer duvida da operacao. &#128075;</div>\n  </div>\n  <div style="padding:10px 12px;border-top:1px solid #2d3748;display:flex;gap:8px;align-items:flex-end">\n    <textarea id="chat-ia-input" placeholder="Pergunte sobre a operacao..." rows="1" onkeydown="chatKeyDown(event)" oninput="autoResize(this)" style="flex:1;background:#2d3140;border:1px solid #3d4660;border-radius:8px;padding:8px 10px;font-size:12px;color:#e2e8f0;outline:none;resize:none;font-family:inherit;max-height:100px;line-height:1.4"></textarea>\n    <button onclick="enviarMensagem()" id="chat-ia-send" style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);border:none;border-radius:8px;width:36px;height:36px;cursor:pointer;font-size:14px;flex-shrink:0;color:#fff">&#10148;</button>\n  </div>\n</div>\n\n<style>\n@keyframes chatpulse{0%,100%{opacity:1}50%{opacity:.3}}\n#chat-ia-btn:hover{transform:scale(1.1)!important;box-shadow:0 6px 28px rgba(99,102,241,.7)!important}\n</style>\n\n<script>\nvar chatAberto=false,chatHistorico=[],chatPagina=window.location.pathname+window.location.search;\nfunction toggleChat(){\n  chatAberto=!chatAberto;\n  var box=document.getElementById(\'chat-ia-box\');\n  box.style.display=chatAberto?\'flex\':\'none\';\n  document.getElementById(\'chat-ia-btn\').style.transform=chatAberto?\'scale(0.9)\':\'scale(1)\';\n  if(chatAberto){setTimeout(function(){document.getElementById(\'chat-ia-input\').focus();},100);var m=document.getElementById(\'chat-ia-msgs\');m.scrollTop=m.scrollHeight;}\n}\nfunction autoResize(el){el.style.height=\'auto\';el.style.height=Math.min(el.scrollHeight,100)+\'px\';}\nfunction chatKeyDown(e){if(e.key===\'Enter\'&&!e.shiftKey){e.preventDefault();enviarMensagem();}}\nfunction limparChat(){\n  chatHistorico=[];\n  document.getElementById(\'chat-ia-msgs\').innerHTML=\'<div style="background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%">Conversa limpa! Como posso ajudar? &#128075;</div>\';\n}\nfunction renderMd(txt){\n  return txt.replace(/&/g,\'&amp;\').replace(/</g,\'&lt;\').replace(/>/g,\'&gt;\')\n    .replace(/\\*\\*(.+?)\\*\\*/g,\'<strong>$1</strong>\')\n    .replace(/^#{1,3} (.+)$/gm,\'<div style="font-weight:700;margin:4px 0 2px">$1</div>\')\n    .replace(/^[|].+[|]$/gm,\'\').replace(/^[-*] (.+)$/gm,\'<div style="padding-left:10px">• $1</div>\')\n    .replace(/\\n/g,\'<br>\');\n}\nfunction addMsg(texto,tipo){\n  var msgs=document.getElementById(\'chat-ia-msgs\');\n  var div=document.createElement(\'div\');\n  if(tipo===\'user\'){div.style.cssText=\'background:#1a2744;border-radius:10px 10px 2px 10px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.5;max-width:90%;align-self:flex-end\';div.textContent=texto;}\n  else if(tipo===\'load\'){div.id=\'chat-load\';div.style.cssText=\'background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#718096;max-width:90%\';div.innerHTML=\'<span style="animation:chatpulse 1s infinite">&#10024; Pensando...</span>\';}\n  else{div.style.cssText=\'background:#242836;border-radius:10px 10px 10px 2px;padding:10px 12px;font-size:12px;color:#e2e8f0;line-height:1.6;max-width:92%\';div.innerHTML=renderMd(texto);}\n  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;\n}\nasync function enviarMensagem(){\n  var input=document.getElementById(\'chat-ia-input\');\n  var texto=input.value.trim();if(!texto)return;\n  input.value=\'\';input.style.height=\'auto\';\n  addMsg(texto,\'user\');\n  chatHistorico.push({role:\'user\',content:texto});\n  var load=addMsg(\'\',\'load\');\n  var btn=document.getElementById(\'chat-ia-send\');btn.disabled=true;btn.style.opacity=\'.5\';\n  try{\n    var r=await fetch(\'/api/chat\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({messages:chatHistorico,pagina:chatPagina})});\n    var d=await r.json();\n    load.remove();\n    var resp=d.resposta||\'Nao consegui responder agora.\';\n    addMsg(resp,\'ia\');\n    chatHistorico.push({role:\'assistant\',content:resp});\n\n    if (d.acaoRealizada && d.acaoRealizada.status === \'success\' && [\'add_shift\',\'remove_shift\',\'set_dayoff\',\'set_vacation\',\'set_medical_leave\'].includes(d.acaoRealizada.action)) {\n      setTimeout(function(){ location.reload(); }, 1200);\n    }\n  }catch(e){load.remove();addMsg(\'Erro de conexao. Tenta de novo!\',\'ia\');}\n  btn.disabled=false;btn.style.opacity=\'1\';\n}\n</script>';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');

  // POST — salvar edição de célula
  if (req.method === 'POST') {
    const equipeRaw2 = await getSheet('Equipe!A2:I50');
    const usuario2 = equipeRaw2.find(r=>r[0]===session.nome);
    if (usuario2?.[8] !== 'gestor') return res.status(403).json({error:'Acesso negado'});
    const {data, colaborador, ent, sai, tipo} = req.body||{};
    if (!data || !colaborador) return res.status(400).json({error:'Dados inválidos'});
    const escalaRaw2 = await getSheet('Escala!A2:F2000');
    const idx = escalaRaw2.findIndex(r=>r[0]===data&&r[2]===colaborador);
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
      return `<div data-nome-busca="${nome}" data-ordem="${idx}" data-perigo="${perigo}" data-atencao="${atencao}" data-df="${df}" data-nome2="${nome}" data-ent="${escRegDia?.[3]||''}" data-sai="${escRegDia?.[4]||''}" data-obs="${escRegDia?.[5]||''}" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;cursor:pointer" onclick="var e=this;abrirEditor(e,e.dataset.df,e.dataset.nome2,e.dataset.ent,e.dataset.sai,e.dataset.obs)">
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
  }
