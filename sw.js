self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; }
  catch { message = {body:event.data?.text() || ''}; }

  event.waitUntil(self.registration.showNotification(message.title || 'Trade Journal', {
    body:message.body || 'Your trading reminder is here.',
    tag:message.tag || 'trade-journal-reminder',
    data:{url:message.url || './'}
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
