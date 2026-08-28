// lib/maestro-layout.js
// shell de pagina do MAESTRO - tema (CSS vars + toggle dark/light) e header num
// unico lugar, em vez de duplicar por arquivo (como o resto do Pulse faz hoje).
// paleta de cores igual a do portal Pulse pra manter consistencia visual, ja que
// agora e a mesma aplicacao.
export function pageShell(titulo, corpoHtml, { nome } = {}) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAESTRO${titulo ? ' - ' + titulo : ''}</title>
<style>
:root{
  --bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;
  --text:#1a1a1a;--text2:#555;--text3:#888;--text4:#bbb;
  --header:#161920;--blue:#1d4ed8;
  --blue-m-bg:#eff6ff;--blue-m-border:#dbeafe;--blue-m-v:#1d4ed8;
  --red-m-bg:#fef2f2;--red-m-border:#fca5a5;--red-m-v:#dc2626;
  --amber-m-bg:#fffbeb;--amber-m-border:#fcd34d;--amber-m-v:#d97706;
  --green-m-bg:#f0fdf4;--green-m-border:#bbf7d0;--green-m-v:#16a34a;
  --badge-green-bg:#dcfce7;--badge-green-c:#166534;
  --badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
  --badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
}
html.dark{
  --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
  --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
  --header:#0f1117;--blue:#63b3ed;
  --blue-m-bg:#1a2744;--blue-m-border:#2a4080;--blue-m-v:#63b3ed;
  --red-m-bg:#1f1010;--red-m-border:#3d2020;--red-m-v:#fc8181;
  --amber-m-bg:#1f1a0d;--amber-m-border:#3d3010;--amber-m-v:#f6ad55;
  --green-m-bg:#0d2010;--green-m-border:#164020;--green-m-v:#68d391;
  --badge-green-bg:#0d2010;--badge-green-c:#68d391;
  --badge-red-bg:#1f1010;--badge-red-c:#fc8181;
  --badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:32px;height:32px;border-radius:8px;background:#1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.ht{font-size:14px;font-weight:700;color:#fff}
.hs{font-size:11px;color:#8a8f9c}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer;text-decoration:none;font-family:inherit}
.btn-sm:hover{border-color:#6b7280;color:#e2e8f0}
.wrap{max-width:1100px;margin:0 auto;padding:16px 20px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px}
.card-header{padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border2)}
.card-title{font-size:13px;font-weight:700}
.card-body{padding:12px}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600;display:inline-block}
.badge-green{background:var(--badge-green-bg);color:var(--badge-green-c)}
.badge-red{background:var(--badge-red-bg);color:var(--badge-red-c)}
.badge-amber{background:var(--badge-amber-bg);color:var(--badge-amber-c)}
@keyframes border-pulse-green{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4)}50%{box-shadow:0 0 0 4px rgba(34,197,94,0)}}
@keyframes border-pulse-amber{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 0 0 4px rgba(245,158,11,0)}}
.g-ev-aovivo{border-color:#22c55e!important;animation:border-pulse-green 2s ease-in-out infinite!important}
.g-ev-p30{border-color:#f59e0b!important;animation:border-pulse-amber 2s ease-in-out infinite!important}
.g-ev-p60{border-color:#fb923c!important}
.evento-header{cursor:pointer;user-select:none}
.evento-chevron{transition:transform 200ms ease;flex-shrink:0;font-size:11px;color:var(--text3)}
.evento-chevron.open{transform:rotate(180deg)}
.evento-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows 200ms ease-out}
.evento-body.open{grid-template-rows:1fr}
.evento-body>div{overflow:hidden}
.critico-banner{background:var(--red-m-bg);border:1px solid var(--red-m-border);border-radius:10px;padding:12px 16px;margin-bottom:16px;color:var(--red-m-v);font-size:13px;font-weight:600}
.critico-banner ul{margin:6px 0 0 18px;font-weight:500}
.item-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border2);font-size:12px}
.item-row:last-child{border-bottom:none}
.item-nome{font-weight:600;flex:1}
.item-obs{color:var(--text3);font-size:11px}
.form-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.form-row input,.form-row select,.form-row textarea{background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--text);font-family:inherit}
.form-row input[type=text],.form-row textarea{flex:1;min-width:160px}
.btn-primary{background:var(--blue);color:#fff;border:none;border-radius:6px;padding:9px 16px;font-size:12px;font-weight:600;cursor:pointer}
.btn-primary:hover{opacity:.9}
.empty{color:var(--text3);font-size:12px;padding:16px;text-align:center}
</style>
</head>
<body>
<div class="header">
  <div class="logo">M</div>
  <div>
    <div class="ht">MAESTRO</div>
    <div class="hs">Central Técnica · Livemode</div>
  </div>
  <div class="hr">
    <div id="mtempo-widget" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 10px;font-size:12px;color:#e2e8f0">
      <span id="mtempo-icone">⏳</span>
      <span id="mtempo-temp" style="font-weight:700">--°C</span>
      <span id="mtempo-cidade" style="color:#718096;font-size:10px"></span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;font-weight:600;color:#718096;letter-spacing:.04em">BRT</span>
        <span id="mrelogio-brt" style="font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums"></span>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span style="font-size:8px;font-weight:600;color:#4a5568;letter-spacing:.04em">GMT</span>
        <span id="mrelogio-gmt" style="font-size:10px;font-weight:600;color:#4a5568;font-variant-numeric:tabular-nums"></span>
      </div>
    </div>
    ${nome ? `<span class="hs">${nome}</span>` : ''}
    <a class="btn-sm" href="/api/app">Voltar ao Pulse</a>
    <button class="btn-sm" onclick="toggleTheme()">🌙/☀️</button>
    <form method="POST" action="/api/app?action=logout" style="margin:0">
      <button class="btn-sm" type="submit">Sair</button>
    </form>
  </div>
</div>
<div class="wrap">
${corpoHtml}
</div>
<script>
function toggleTheme(){
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('pulse-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}
// Relogio Brasil/GMT + temperatura - mesma logica e widget que a Home do Pulse ja tem
// (ver grelogio/gtempo em api/app.js), so replicada aqui pro header do MAESTRO.
function mrelogio(){
  var now=new Date();
  var p=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(now);
  var bh=p.find(function(x){return x.type==='hour';}).value;
  var bm=p.find(function(x){return x.type==='minute';}).value;
  var bs=p.find(function(x){return x.type==='second';}).value;
  var eb=document.getElementById('mrelogio-brt'); if(eb) eb.textContent=bh+':'+bm+':'+bs;
  var eg=document.getElementById('mrelogio-gmt'); if(eg) eg.textContent=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0');
}
async function mtempo(){
  try{
    var loc=null;
    try{var r1=await fetch('https://ipapi.co/json/');var j1=await r1.json();if(j1.latitude)loc={lat:j1.latitude,lon:j1.longitude,city:j1.city};}catch(e){}
    if(!loc)loc={lat:-22.9068,lon:-43.1729,city:'Rio de Janeiro'};
    var wd=await(await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current=temperature_2m,weathercode&timezone=America%2FSao_Paulo')).json();
    var temp=wd.current&&wd.current.temperature_2m!==undefined?Math.round(wd.current.temperature_2m):'--';
    var icons={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',51:'🌦️',61:'🌧️',80:'🌦️',95:'⛈️'};
    document.getElementById('mtempo-icone').textContent=icons[wd.current&&wd.current.weathercode||0]||'🌡️';
    document.getElementById('mtempo-temp').textContent=temp+'°C';
    document.getElementById('mtempo-cidade').textContent=loc.city||'';
  }catch(e){document.getElementById('mtempo-temp').textContent='--°C';}
}
mrelogio();mtempo();setInterval(mrelogio,1000);
</script>
</body>
</html>`;
}
