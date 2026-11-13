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
