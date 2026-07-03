// lib/solicitar-widget.js
// Botão flutuante verde "Solicitações" (férias/folga/atestado/troca) — extraído de api/app.js
// pra poder ser embutido em outras páginas autenticadas sem duplicar ~150 linhas de HTML/JS.
// O envio em si sempre vai para /api/app?action=solicitar (POST), então funciona igual não
// importa em qual página o botão está.
import { sheetsRequest } from './google-auth.js';

const TIPO_CORES_BTN = {
  'Férias': ['#dbeafe','#1d4ed8'],
  'Folga programada': ['#dcfce7','#166534'],
  'Atestado médico': ['#fee2e2','#991b1b'],
  'Folga direcionada': ['#fef3c7','#92400e'],
};
function badgeTipo(tipo) {
  const [bg, c] = TIPO_CORES_BTN[tipo] || ['#f3f4f6','#374151'];
  return `<span style="background:${bg};color:${c};border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">${tipo}</span>`;
}
function renderMinhasSolicits(minhasSolicits) {
  if (!minhasSolicits.length) return `<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px">Nenhuma solicitação registrada</div>`;
  return minhasSolicits.map(s => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border2)">
      <div style="flex:1">
        ${badgeTipo(s[2])}
        ${s[3] ? `<div style="font-size:11px;color:var(--text2);margin-top:3px">${s[3]}</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:11px;font-weight:600;color:var(--text)">${s[4]}${s[5] && s[5] !== s[4] ? ' → ' + s[5] : ''}</div>
        <div style="font-size:10px;color:var(--text3)">${s[0]}</div>
      </div>
      <button onclick="cancelarSolicit('${s[0]}')" style="background:none;border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:10px;color:var(--text3);cursor:pointer">✕</button>
    </div>`).join('');
}

export async function solicitarBtn(nome) {
  const [equipeRaw, ausRaw] = await Promise.all([
    sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:M200')}`).then(d => d.values||[]).catch(() => []),
    sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent('Ausências!A2:F500')}`).then(d => d.values||[]).catch(() => []),
  ]);
  const nomes = equipeRaw.filter(r => r[0] && (r[10]||'ativo').toLowerCase() === 'ativo').map(r => r[0]);
  const minhasSolicits = ausRaw.filter(a => a[1] === nome && a[0] !== 'CANCELADO').sort((a,b) => (b[4]||'').localeCompare(a[4]||'')).slice(0,10);
  const colegasJson = JSON.stringify(nomes.filter(n => n !== nome));

  return `
<div id="sol-btn" onclick="toggleSolicitar()" style="position:fixed;bottom:24px;left:24px;z-index:900;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#16a34a,#15803d);box-shadow:0 4px 20px rgba(22,163,74,.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;transition:transform .2s" title="Solicitações">📋</div>

<div id="sol-box" style="display:none;position:fixed;bottom:88px;left:24px;z-index:900;width:380px;max-width:calc(100vw - 48px);background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.3);max-height:90vh;flex-direction:column;overflow:hidden">
  <div style="background:var(--header);padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);flex-shrink:0">
    <span style="font-size:16px">📋</span>
    <div style="flex:1;font-size:13px;font-weight:600;color:#e2e8f0">Minhas solicitações</div>
    <button onclick="toggleSolicitar()" style="background:none;border:none;color:#718096;cursor:pointer;font-size:20px;padding:4px;line-height:1">&times;</button>
  </div>
  <div style="display:flex;gap:4px;padding:10px 14px 0;flex-shrink:0">
    <button id="sol-tab-nova" onclick="solTab('nova')" style="flex:1;border:none;border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:#16a34a;color:#fff;cursor:pointer">+ Nova</button>
    <button id="sol-tab-hist" onclick="solTab('hist')" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:none;color:var(--text2);cursor:pointer">Histórico</button>
  </div>
  <div style="overflow-y:auto;padding:12px 14px;flex:1">
    <div id="sol-form-area">
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Tipo</label>
        <select id="sol-tipo" onchange="solTipoChange()" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
          <option value="Férias">🏖️ Férias</option>
          <option value="Folga programada">☀️ Folga programada</option>
          <option value="Atestado médico">🏥 Atestado médico</option>
          <option value="Troca de horário">🔄 Troca de horário</option>
        </select>
      </div>
      <div id="sol-ferias-area">
        <div style="background:var(--blue-m-bg);border:1px solid var(--blue-m-border);border-radius:6px;padding:8px 10px;font-size:11px;color:var(--blue-m-v);margin-bottom:10px">
          📌 CLT: mín. 14 dias num período, mín. 5 dias nos demais. Máx. 3 períodos.
        </div>
        <div id="sol-periodos"></div>
        <button onclick="adicionarPeriodo()" id="sol-add-periodo" style="width:100%;border:1px dashed var(--border);border-radius:6px;padding:7px;font-size:12px;color:var(--text3);background:none;cursor:pointer;margin-bottom:10px">+ Adicionar período</button>
        <div id="sol-ferias-erro" style="display:none;color:#dc2626;font-size:11px;margin-bottom:8px"></div>
      </div>
      <div id="sol-datas-area">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Data início</label>
            <div style="display:flex;gap:6px">
              <input type="date" id="sol-inicio" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
              <select id="sol-inicio-ano" onchange="ajustarAnoData('sol-inicio',this.value)" title="Pular direto para o ano" style="width:64px;border:1px solid var(--border);border-radius:6px;padding:8px 4px;font-size:12px;background:var(--bg2);color:var(--text);outline:none"></select>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Data fim</label>
            <div style="display:flex;gap:6px">
              <input type="date" id="sol-fim" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
              <select id="sol-fim-ano" onchange="ajustarAnoData('sol-fim',this.value)" title="Pular direto para o ano" style="width:64px;border:1px solid var(--border);border-radius:6px;padding:8px 4px;font-size:12px;background:var(--bg2);color:var(--text);outline:none"></select>
            </div>
          </div>
        </div>
      </div>
      <div id="sol-atestado-area" style="display:none">
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Arquivo do atestado</label>
          <div id="sol-upload-area" style="border:2px dashed var(--border);border-radius:8px;padding:16px;text-align:center;cursor:pointer" onclick="document.getElementById('sol-arquivo').click()">
            <div style="font-size:24px;margin-bottom:4px">📎</div>
            <div style="font-size:12px;color:var(--text3)">Clique para selecionar PDF, JPG ou PNG</div>
            <div id="sol-arquivo-nome" style="font-size:11px;color:#16a34a;margin-top:4px;display:none"></div>
          </div>
          <input type="file" id="sol-arquivo" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="solArquivoSelecionado(this)">
          <div id="sol-upload-progress" style="display:none;margin-top:6px">
            <div style="background:var(--border);border-radius:4px;height:4px;overflow:hidden">
              <div id="sol-upload-bar" style="background:#16a34a;height:100%;width:0%;transition:width .3s"></div>
            </div>
            <div style="font-size:10px;color:var(--text3);margin-top:3px" id="sol-upload-status">Enviando...</div>
          </div>
        </div>
      </div>
      <div id="sol-troca-area" style="display:none">
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Colega para trocar</label>
          <select id="sol-colega" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
            <option value="">Selecione...</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Meu dia</label>
            <input type="date" id="sol-troca-meu-dia" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Dia do colega</label>
            <input type="date" id="sol-troca-colega-dia" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--bg2);color:var(--text);outline:none">
          </div>
        </div>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Observação (opcional)</label>
        <textarea id="sol-obs" rows="2" placeholder="Ex: viagem em família, CID M54..." style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;background:var(--bg2);color:var(--text);outline:none;resize:none;font-family:inherit"></textarea>
      </div>
      <button onclick="enviarSolicits()" style="width:100%;background:#16a34a;border:none;border-radius:6px;padding:10px;font-size:13px;font-weight:600;color:#fff;cursor:pointer">Enviar solicitação</button>
      <div id="sol-msg" style="display:none;margin-top:8px;text-align:center;font-size:12px;font-weight:600;padding:8px;border-radius:6px"></div>
    </div>
    <div id="sol-hist-area" style="display:none">
      ${renderMinhasSolicits(minhasSolicits)}
    </div>
  </div>
</div>
<script>
var solAberto=false;
var solColegas=${colegasJson};
var solPeriodos=1;
function gerarOpcoesAno(selectId, anosAtras, anosFrente){
  var sel=document.getElementById(selectId);
  if(!sel) return;
  var anoAtual=new Date().getFullYear();
  var html='';
  for(var y=anoAtual-(anosAtras||0); y<=anoAtual+(anosFrente===undefined?2:anosFrente); y++){
    html+='<option value="'+y+'"'+(y===anoAtual?' selected':'')+'>'+y+'</option>';
  }
  sel.innerHTML=html;
  // Adiciona listener programaticamente — evita problemas de escaping de aspas no template literal
  var inputId=selectId.replace(/-ano$/,'');
  sel.addEventListener('change',function(){ajustarAnoData(inputId,this.value);});
}
function ajustarAnoData(inputId, ano){
  var el=document.getElementById(inputId);
  if(!el) return;
  var base=el.value?new Date(el.value+'T00:00:00'):new Date();
  var mm=String(base.getMonth()+1).padStart(2,'0');
  var dd=String(base.getDate()).padStart(2,'0');
  el.value=ano+'-'+mm+'-'+dd;
  el.dispatchEvent(new Event('change'));
}
(function(){
  var sel=document.getElementById('sol-colega');
  if (sel) solColegas.forEach(function(c){var o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o);});
  adicionarPeriodoInicial();
  gerarOpcoesAno('sol-inicio-ano');
  gerarOpcoesAno('sol-fim-ano');
})();
function adicionarPeriodoInicial(){var c=document.getElementById('sol-periodos');if(!c)return;c.innerHTML='';solPeriodos=1;c.innerHTML=criarPeriodoHTML(1);atualizarBotaoAddPeriodo();gerarOpcoesAno('p1-inicio-ano');gerarOpcoesAno('p1-fim-ano');}
function criarPeriodoHTML(n){var label=n===1?'1º período (mín. 14 dias)':n===2?'2º período (mín. 5 dias)':'3º período (mín. 5 dias)';return '<div id="periodo-'+n+'" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:11px;font-weight:600;color:var(--text3)">'+label+'</span>'+(n>1?'<button onclick="removerPeriodo('+n+')" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px">✕</button>':'')+'</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label style="display:block;font-size:10px;color:var(--text3);margin-bottom:3px">Início</label><div style="display:flex;gap:4px"><input type="date" id="p'+n+'-inicio" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none"><select id="p'+n+'-inicio-ano" title="Ano" style="width:58px;border:1px solid var(--border);border-radius:5px;padding:6px 2px;font-size:11px;background:var(--bg);color:var(--text);outline:none"></select></div></div><div><label style="display:block;font-size:10px;color:var(--text3);margin-bottom:3px">Fim</label><div style="display:flex;gap:4px"><input type="date" id="p'+n+'-fim" style="flex:1;min-width:0;border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none"><select id="p'+n+'-fim-ano" title="Ano" style="width:58px;border:1px solid var(--border);border-radius:5px;padding:6px 2px;font-size:11px;background:var(--bg);color:var(--text);outline:none"></select></div></div></div><div id="p'+n+'-dias" style="font-size:10px;color:var(--text3);margin-top:5px;text-align:right"></div></div>';}
function adicionarPeriodo(){if(solPeriodos>=3)return;solPeriodos++;var c=document.getElementById('sol-periodos');var div=document.createElement('div');div.innerHTML=criarPeriodoHTML(solPeriodos);c.appendChild(div.firstChild);['inicio','fim'].forEach(function(t){var el=document.getElementById('p'+solPeriodos+'-'+t);if(el)el.addEventListener('change',function(){calcDias(solPeriodos);});});atualizarBotaoAddPeriodo();gerarOpcoesAno('p'+solPeriodos+'-inicio-ano');gerarOpcoesAno('p'+solPeriodos+'-fim-ano');}
function removerPeriodo(n){var el=document.getElementById('periodo-'+n);if(el)el.remove();solPeriodos=Math.max(1,solPeriodos-1);atualizarBotaoAddPeriodo();}
function atualizarBotaoAddPeriodo(){var btn=document.getElementById('sol-add-periodo');if(btn)btn.style.display=solPeriodos>=3?'none':'block';}
function calcDias(n){var ini=document.getElementById('p'+n+'-inicio');var fim=document.getElementById('p'+n+'-fim');var info=document.getElementById('p'+n+'-dias');if(!ini||!fim||!info)return;if(ini.value&&fim.value){var d=Math.round((new Date(fim.value)-new Date(ini.value))/(1000*60*60*24))+1;var min=n===1?14:5;info.textContent=d+' dia'+(d!==1?'s':'')+(d<min?' ⚠ mín. '+min+' dias':'');info.style.color=d<min?'#dc2626':'#16a34a';}}
setTimeout(function(){['inicio','fim'].forEach(function(t){var el=document.getElementById('p1-'+t);if(el)el.addEventListener('change',function(){calcDias(1);});});},100);
function toggleSolicitar(){solAberto=!solAberto;var box=document.getElementById('sol-box');box.style.display=solAberto?'flex':'none';document.getElementById('sol-btn').style.transform=solAberto?'scale(0.9)':'scale(1)';}
function solTab(tab){var isNova=tab==='nova';document.getElementById('sol-form-area').style.display=isNova?'block':'none';document.getElementById('sol-hist-area').style.display=isNova?'none':'block';document.getElementById('sol-tab-nova').style.cssText='flex:1;border:none;border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:'+(isNova?'#16a34a':'none')+';color:'+(isNova?'#fff':'var(--text2)')+';cursor:pointer';document.getElementById('sol-tab-hist').style.cssText='flex:1;border:'+(isNova?'1px solid var(--border)':'none')+';border-radius:6px;padding:6px;font-size:11px;font-weight:600;background:'+(isNova?'none':'#16a34a')+';color:'+(isNova?'var(--text2)':'#fff')+';cursor:pointer';}
function solTipoChange(){var tipo=document.getElementById('sol-tipo').value;var isFerias=tipo==='Férias';var isTroca=tipo==='Troca de horário';var isAtestado=tipo==='Atestado médico';document.getElementById('sol-ferias-area').style.display=isFerias?'block':'none';document.getElementById('sol-datas-area').style.display=(!isFerias&&!isTroca)?'block':'none';document.getElementById('sol-troca-area').style.display=isTroca?'block':'none';document.getElementById('sol-atestado-area').style.display=isAtestado?'block':'none';}
function validarFerias(){var periodos=[];for(var i=1;i<=solPeriodos;i++){var ini=document.getElementById('p'+i+'-inicio');var fim=document.getElementById('p'+i+'-fim');if(!ini||!fim||!document.getElementById('periodo-'+i))continue;if(!ini.value||!fim.value)return 'Preencha todas as datas dos períodos';var dias=Math.round((new Date(fim.value)-new Date(ini.value))/(1000*60*60*24))+1;if(dias<1)return 'Data fim deve ser após data início';periodos.push({inicio:ini.value,fim:fim.value,dias:dias});}if(periodos.length===0)return 'Informe pelo menos um período';var total=periodos.reduce(function(s,p){return s+p.dias;},0);var temMinimo14=periodos.some(function(p){return p.dias>=14;});var todosMin5=periodos.every(function(p){return p.dias>=5;});if(!temMinimo14)return 'Pelo menos um período deve ter mínimo 14 dias (CLT art. 134)';if(!todosMin5)return 'Nenhum período pode ter menos de 5 dias (CLT art. 134)';if(total>30)return 'Total de dias não pode exceder 30 dias';return null;}
function fmtDt(s){if(!s)return '';var p=s.split('-');return p[2]+'/'+p[1];}
function solArquivoSelecionado(input){var f=input.files[0];if(!f)return;var nome=document.getElementById('sol-arquivo-nome');nome.textContent=f.name;nome.style.display='block';document.getElementById('sol-upload-area').style.borderColor='#16a34a';}
async function uploadAtestado(file){var prog=document.getElementById('sol-upload-progress');var bar=document.getElementById('sol-upload-bar');var status=document.getElementById('sol-upload-status');prog.style.display='block';bar.style.width='30%';status.textContent='Enviando arquivo...';var fd=new FormData();fd.append('file',file);try{bar.style.width='60%';var r=await fetch('/api/upload-atestado',{method:'POST',credentials:'include',body:fd});bar.style.width='100%';var d=await r.json();if(d.ok){status.textContent='✓ Arquivo enviado!';return d.url;}else{status.textContent='Erro: '+d.error;status.style.color='#dc2626';return null;}}catch(e){status.textContent='Erro de conexão: '+e.message;status.style.color='#dc2626';return null;}}
async function enviarSolicits(){var tipo=document.getElementById('sol-tipo').value;var obs=document.getElementById('sol-obs').value;var msg=document.getElementById('sol-msg');msg.style.display='none';var body={tipo,motivo:obs};if(tipo==='Férias'){var err=validarFerias();if(err){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='⚠ '+err;return;}var periodos=[];for(var i=1;i<=solPeriodos;i++){var ini=document.getElementById('p'+i+'-inicio');var fim=document.getElementById('p'+i+'-fim');if(!ini||!fim||!document.getElementById('periodo-'+i))continue;if(ini.value&&fim.value)periodos.push({inicio:fmtDt(ini.value),fim:fmtDt(fim.value)});}body.periodos=periodos;body.dataInicio=periodos[0].inicio;body.dataFim=periodos[periodos.length-1].fim;body.motivo=(obs?obs+' | ':'')+'Períodos: '+periodos.map(function(p,i){return (i+1)+'º: '+p.inicio+' a '+p.fim;}).join(', ');}else if(tipo==='Troca de horário'){var colega=document.getElementById('sol-colega').value;var meuDia=document.getElementById('sol-troca-meu-dia').value;var colegaDia=document.getElementById('sol-troca-colega-dia').value;if(!colega||!meuDia||!colegaDia){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='⚠ Preencha colega e datas';return;}body.dataInicio=fmtDt(meuDia);body.dataFim=fmtDt(meuDia);body.motivo='Troca com '+colega+': meu dia '+fmtDt(meuDia)+' pelo dia '+fmtDt(colegaDia)+(obs?' | '+obs:'');}else{var inicio=document.getElementById('sol-inicio').value;var fim=document.getElementById('sol-fim').value;if(!inicio){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='⚠ Informe a data de início';return;}body.dataInicio=fmtDt(inicio);body.dataFim=fmtDt(fim||inicio);if(tipo==='Atestado médico'){var arquivo=document.getElementById('sol-arquivo').files[0];if(arquivo){var url=await uploadAtestado(arquivo);if(!url){return;}body.motivo=(obs?obs+' | ':'')+'Anexo: '+url;}}}try{var r=await fetch('/api/app?action=solicitar',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var d=await r.json();if(d.ok){msg.style.display='block';msg.style.background='#0d2010';msg.style.color='#68d391';msg.textContent='✓ Enviado! ID: '+d.id;setTimeout(function(){location.reload();},1800);}else{msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='Erro: '+d.error;}}catch(e){msg.style.display='block';msg.style.background='#1f1010';msg.style.color='#fc8181';msg.textContent='Erro de conexão: '+e.message;}}
async function cancelarSolicit(id){if(!confirm('Cancelar esta solicitação?'))return;var r=await fetch('/api/app?action=cancelar-solicitacao',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});var d=await r.json();if(d.ok)location.reload();else alert('Erro: '+d.error);}
</script>`;
}
