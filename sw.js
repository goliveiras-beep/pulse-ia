// sw.js — service worker do Pulse: recebe o push "vazio" e mostra o aviso de escala (texto buscado em /api/push?acao=pendentes).
// Fica na raiz porque o escopo de um service worker é a pasta onde ele está servido.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  e.waitUntil((async function () {
    var itens = [];
    try {
      var r = await fetch('/api/push?acao=pendentes', { credentials: 'include', cache: 'no-store' });
      if (r.ok) itens = ((await r.json()).itens) || [];
    } catch (err) { /* sem rede ou sem sessão: cai no aviso genérico abaixo */ }
    // todo push precisa mostrar alguma coisa (o iPhone cancela a inscrição de quem recebe push sem aviso)
    if (!itens.length) itens = [{ id: 'pulse-geral', titulo: 'Pulse', corpo: 'Sua escala foi atualizada. Toque para ver.', url: '/api/app' }];
    for (var i = 0; i < itens.length; i++) {
      var n = itens[i];
      await self.registration.showNotification(n.titulo || 'Pulse', {
        body: n.corpo || '', tag: n.id, icon: '/icone-play-store-512.png', badge: '/icone-play-store-512.png', data: { url: n.url || '/api/app' }
      });
    }
  })());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/api/app';
  e.waitUntil((async function () {
    var abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < abas.length; i++) { if ('focus' in abas[i]) { await abas[i].focus(); if ('navigate' in abas[i]) { try { await abas[i].navigate(url); } catch (err) { /* ignora */ } } return; } }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
