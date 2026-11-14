// lib/central-som-page.js — página do alto-falante da central. Abrir num computador/TV/tablet da sala, clicar em "Ligar o som" UMA vez
// e deixar aberta. Busca os avisos a cada 2 s (/api/central-som/fila) e fala/toca. ATENÇÃO: o script abaixo está dentro de um template literal.
export function paginaCentralSom(k) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alto-falante da central — Pulse</title><meta name="robots" content="noindex">
<style>
html,body{margin:0;height:100%;background:#0b1020;color:#e8eefc;font-family:system-ui,Segoe UI,sans-serif}
body{display:flex;flex-direction:column;align-items:center;gap:18px;padding:28px 16px;box-sizing:border-box}
h1{margin:0;font-size:22px;font-weight:700}
#estado{font-size:15px;padding:6px 14px;border-radius:20px;background:#26324f}
#estado.ok{background:#14532d;color:#bbf7d0}#estado.ruim{background:#7f1d1d;color:#fecaca}#estado.alerta{background:#78350f;color:#fde68a}
#ligar{font-size:26px;font-weight:800;padding:22px 38px;border-radius:16px;border:0;background:#16a34a;color:#fff;cursor:pointer}
#ligar.ligado{background:#26324f;font-size:15px;font-weight:600;padding:8px 16px}
#lista{width:min(720px,100%);display:flex;flex-direction:column;gap:8px}
.item{background:#141b30;border:1px solid #26324f;border-radius:12px;padding:10px 14px;font-size:16px}
.item small{display:block;color:#94a3b8;margin-bottom:2px}.item.alarme{border-color:#ef4444}
.dica{max-width:640px;color:#94a3b8;font-size:13px;text-align:center;line-height:1.5}
</style></head><body>
<h1>Alto-falante da central</h1>
<div id="estado" class="alerta">Som desligado</div>
<button id="ligar" type="button">Ligar o som</button>
<div class="dica">Deixe esta página aberta no computador ou na TV da sala, com o volume do aparelho ligado. Os recados do Pulse e os alarmes de temperatura são falados aqui.</div>
<div id="lista"></div>
<script>
var K = ${JSON.stringify(String(k))};
var ultimo = null, fila = [], tocando = false, ligado = false, falhas = 0, ctx = null, vozes = [];
var elEstado = document.getElementById('estado'), elLista = document.getElementById('lista'), elLigar = document.getElementById('ligar');
function estado(txt, cls){ elEstado.textContent = txt; elEstado.className = cls || ''; }
function agoraTxt(){ var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function carregarVozes(){ try { vozes = speechSynthesis.getVoices().filter(function(v){ return /^pt/i.test(v.lang); }); } catch (e) { vozes = []; } }
carregarVozes(); try { speechSynthesis.onvoiceschanged = carregarVozes; } catch (e) {}
function melhorVoz(){
  var pref = ['Francisca', 'Maria', 'Google', 'Luciana', 'Camila'];
  for (var i = 0; i < pref.length; i++) for (var j = 0; j < vozes.length; j++) if (vozes[j].name.indexOf(pref[i]) >= 0 && /BR/i.test(vozes[j].lang)) return vozes[j];
  for (var m = 0; m < vozes.length; m++) if (/BR/i.test(vozes[m].lang)) return vozes[m];
  return vozes[0] || null;
}
function tom(freq, ini, dur, vol){
  var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + ini); g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + ini + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ini + dur);
  o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + ini); o.stop(ctx.currentTime + ini + dur + 0.05);
}
function aviso(tipo){
  if (tipo === 'alarme') { for (var i = 0; i < 4; i++) { tom(880, i * 0.5, 0.22, 0.5); tom(660, i * 0.5 + 0.25, 0.22, 0.5); } return 2200; }
  tom(660, 0, 0.18, 0.35); tom(880, 0.22, 0.28, 0.35); return 800;
}
function falar(texto, fim){
  var feito = false; function acabou(){ if (feito) return; feito = true; fim(); }
  try {
    var u = new SpeechSynthesisUtterance(texto); u.lang = 'pt-BR'; u.rate = 0.95; var v = melhorVoz(); if (v) u.voice = v;
    u.onend = acabou; u.onerror = acabou; speechSynthesis.speak(u);
    setTimeout(acabou, 45000);
  } catch (e) { acabou(); }
}
function registrar(it){
  var d = document.createElement('div'); d.className = 'item' + (it.tipo === 'alarme' ? ' alarme' : '');
  var s = document.createElement('small'); s.textContent = agoraTxt() + (it.de ? ' · ' + it.de : '') + (it.tipo === 'alarme' ? ' · ALARME' : it.tipo === 'audio' ? ' · áudio' : '');
  var t = document.createElement('div'); t.textContent = it.tipo === 'audio' ? 'Recado em áudio' : it.texto;
  d.appendChild(s); d.appendChild(t); elLista.insertBefore(d, elLista.firstChild); while (elLista.children.length > 8) elLista.removeChild(elLista.lastChild);
}
function tocar(it, fim){
  if (it.tipo === 'audio') {
    var a = new Audio(it.url); var ok = false; function f(){ if (ok) return; ok = true; fim(); }
    a.onended = f; a.onerror = f; var p = a.play(); if (p && p.catch) p.catch(f); setTimeout(f, 90000); return;
  }
  var ms = aviso(it.tipo); setTimeout(function(){ falar(it.texto, fim); }, ms);
}
function proximo(){
  if (!ligado || tocando || !fila.length) return;
  tocando = true; var it = fila.shift(); registrar(it);
  tocar(it, function(){ tocando = false; setTimeout(proximo, 400); });
}
function buscar(){
  var q = '/api/central-som/fila?k=' + encodeURIComponent(K) + '&desde=' + (ultimo == null ? 'agora' : ultimo);
  fetch(q, { cache: 'no-store' }).then(function(r){ if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function(d){
    falhas = 0;
    if (ultimo == null) ultimo = d.ultimo || 0;
    else (d.itens || []).forEach(function(i){ if (i.id > ultimo) { ultimo = i.id; fila.push(i); } });
    estado(ligado ? 'Conectado · som ligado' : 'Som desligado — clique em "Ligar o som"', ligado ? 'ok' : 'alerta');
    proximo();
  }).catch(function(){ falhas++; if (falhas >= 3) estado('Sem conexão com o Pulse — tentando de novo', 'ruim'); });
}
var travaTela = null;
function manterTelaLigada(){ try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function(l){ travaTela = l; }).catch(function(){}); } catch (e) {} }
document.addEventListener('visibilitychange', function(){ if (!document.hidden && ligado) manterTelaLigada(); });
elLigar.addEventListener('click', function(){
  if (!ligado) {
    ligado = true; var AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); if (ctx.resume) ctx.resume();
    try { var mudo = new SpeechSynthesisUtterance(' '); mudo.volume = 0; speechSynthesis.speak(mudo); } catch (e) {}
    manterTelaLigada(); elLigar.textContent = 'Testar o som'; elLigar.className = 'ligado'; estado('Conectado · som ligado', 'ok');
    fila.push({ tipo: 'texto', texto: 'Som da central ligado.', de: 'Pulse' }); proximo();
  } else {
    fila.push({ tipo: 'texto', texto: 'Teste do alto-falante da central.', de: 'Pulse' }); proximo();
  }
});
buscar(); setInterval(buscar, 2000);
</script></body></html>`;
}
