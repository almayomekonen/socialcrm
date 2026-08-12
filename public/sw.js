/* eslint-disable no-restricted-globals */
/**
 * SocialCRM push service worker — P3.1. Spec §15.2, §20.7.
 *
 * HARD CONSTRAINT: only `push` and `notificationclick`.
 * - NO fetch handler
 * - NO caching
 * - NO authenticated application data
 *
 * P3.1 does not deliver pushes from the server. The handlers exist so a later
 * phase can send without revisiting this file's security shape. A push that
 * somehow arrives still only shows title/body/deepLink from the payload —
 * never contact identifiers or national IDs from the CRM.
 */

self.addEventListener('push', (event) => {
  let data = { title: 'SocialCRM', body: '', deepLink: '/' }
  try {
    if (event.data) {
      const parsed = event.data.json()
      data = {
        title: typeof parsed.title === 'string' && parsed.title ? parsed.title : data.title,
        body: typeof parsed.body === 'string' ? parsed.body : '',
        deepLink: typeof parsed.deepLink === 'string' && parsed.deepLink ? parsed.deepLink : '/',
      }
    }
  } catch {
    // Non-JSON payloads still show a generic notification rather than throwing.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { deepLink: data.deepLink },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const deepLink =
    event.notification.data && typeof event.notification.data.deepLink === 'string'
      ? event.notification.data.deepLink
      : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && typeof client.navigate === 'function') {
            return client.navigate(deepLink).then((c) => (c && 'focus' in c ? c.focus() : client.focus()))
          }
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(deepLink)
      return undefined
    }),
  )
})
