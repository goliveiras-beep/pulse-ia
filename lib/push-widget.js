// lib/push-widget.js — botão "Ativar avisos" (sino) que registra o service worker e cadastra este aparelho pra receber
// os avisos de mudança de escala. Embutido por lib/solicitar-widget.js (já presente nas páginas autenticadas).
// ATENÇÃO: o texto abaixo é um template literal de servidor — sem crases, sem ${} e sem barra invertida no script.
export function pushWidget() {
  return `
<style>
#push-btn{position:fixed;bottom:84px;left:24px;z-index:900;height:40px;padding:0 14px;border-radius:20px;border:1px solid #b45309;background:#f59e0b;color:#1c1100;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(245,158,11,.4);display:none;align-items:center;gap:6px}
@media(max-width:600px){#push-btn{bottom:70px;left:16px;height:36px;font-size:12px}}
</style>
<button id="push-btn" type="button">&#128276; Ativar avisos de escala</button>
<script>
(function(){
  var btn = document.getElementById('push-btn'); if (!btn) return;
  var suporta = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  function b64(s){ var p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(b), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function guardado(){ try { return localStorage.getItem('pulse-push-ep') || ''; } catch (e) { return ''; } }
  function guardar(v){ try { localStorage.setItem('pulse-push-ep', v); } catch (e) {} }
  function enviar(acao, corpo){ return fetch('/api/push?acao=' + acao, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) }); }
  function aparelho(){ return (navigator.userAgent || '').slice(0, 100); }

  // Chegou aviso de mudança de escala com o Pulse aberto: recarrega a página sozinha, pra o turno novo aparecer sem ninguém forçar.
  // Se a pessoa está digitando/preenchendo algo, não perde o que escreveu: mostra uma faixa "Atualizar". Aba em segundo plano recarrega ao voltar.
  var pendente = false, tm = null;
  // recarrega pedindo dados direto da planilha (?fresh=1), e já tira o ?fresh=1 do endereço pra não ficar grudado
  function recarregarFresco(){ var u = new URL(location.href); u.searchParams.set('fresh', '1'); location.replace(u.toString()); }
  try { var uf = new URL(location.href); if (uf.searchParams.get('fresh')) { uf.searchParams.delete('fresh'); history.replaceState(null, '', uf.pathname + (uf.search || '') + uf.hash); } } catch (e) {}
  function ocupado(){
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && a.type !== 'button' && a.type !== 'submit' && a.value) return true;
    var box = document.getElementById('sol-box'); if (box && box.style.display && box.style.display !== 'none') return true;
    return false;
  }
  function faixa(){
    if (document.getElementById('push-faixa')) return;
    var f = document.createElement('div'); f.id = 'push-faixa';
    f.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000;background:#0f172a;color:#fff;border:1px solid #f59e0b;border-radius:12px;padding:10px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center';
    var t = document.createElement('span'); t.textContent = 'Sua escala foi atualizada.';
    var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Atualizar'; b.style.cssText = 'background:#f59e0b;color:#1c1100;border:0;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer';
    b.addEventListener('click', function(){ recarregarFresco(); });
    f.appendChild(t); f.appendChild(b); document.body.appendChild(f);
  }
  function atualizar(){
    if (document.hidden) { pendente = true; return; }
    if (ocupado()) { faixa(); return; }
    recarregarFresco();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(e){
      if (!e.data || e.data.tipo !== 'escala-mudou') return;
      clearTimeout(tm); tm = setTimeout(atualizar, 1200);   // junta vários avisos seguidos num recarregamento só
    });
    document.addEventListener('visibilitychange', function(){ if (!document.hidden && pendente) { pendente = false; atualizar(); } });
  }

  if (suporta) {
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      return navigator.serviceWorker.ready.then(function(){ return reg.pushManager.getSubscription(); });
    }).then(function(sub){
      if (sub && Notification.permission === 'granted') {
        // já inscrito: só garante que a planilha conhece este aparelho (uma vez por endereço)
        if (guardado() !== sub.endpoint) enviar('inscrever', { endpoint: sub.endpoint, aparelho: aparelho() }).then(function(r){ if (r.ok) guardar(sub.endpoint); });
        return;
      }
      if (Notification.permission === 'denied') return;
      btn.style.display = 'flex';
    }).catch(function(){ btn.style.display = 'flex'; });
  } else {
    btn.style.display = 'flex';
  }

  btn.addEventListener('click', async function(){
    if (!suporta) { alert('Neste aparelho o navegador não permite avisos. No iPhone: abra o Pulse no Safari, toque em Compartilhar > Adicionar à Tela de Início, e abra o Pulse por esse ícone.'); return; }
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Os avisos ficaram bloqueados. Libere as notificações do Pulse nas configurações do navegador e toque de novo.'); return; }
      var reg = await navigator.serviceWorker.ready;
      var kr = await fetch('/api/push?acao=chave', { credentials: 'include' }); var chave = (await kr.json()).chave;
      if (!chave) { alert('Avisos ainda não configurados no servidor.'); return; }
      var sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(chave) });
      var r = await enviar('inscrever', { endpoint: sub.endpoint, aparelho: aparelho() });
      if (!r.ok) { alert('Não consegui cadastrar este aparelho. Tente de novo.'); return; }
      guardar(sub.endpoint); btn.style.display = 'none';
      enviar('testar');
    } catch (e) { alert('Não consegui ativar os avisos neste aparelho.'); }
  });
})();
</script>`;
}
