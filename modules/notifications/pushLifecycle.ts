/**
 * Browser push subscription lifecycle — P3.1 client helper. Spec §15.2–15.3.
 *
 * Called ONLY on explicit user action (preferences later). Never on page load.
 * Does not send a notification. Does not touch AwarenessContext.
 *
 * Flow: status → permission → register /sw.js → pushManager.subscribe → POST
 * /api/notifications/push/subscribe. Reverse for unsubscribe.
 */

export type PushLifecycleStatus = {
  vapidStatus: 'configured' | 'not_configured'
  missing: string[]
  publicKey: string | null
  pushChannelEnabled: boolean
  subscriptionCount: number
  serviceWorkerUrl: string
}

export type PushLifecycleResult =
  | { ok: true; endpoint: string }
  | {
      ok: false
      reason:
        | 'unsupported'
        | 'permission-denied'
        | 'permission-dismissed'
        | 'not_configured'
        | 'notifications-disabled'
        | 'unauthorized'
        | 'subscribe-failed'
        | 'unsubscribe-failed'
      detail?: string
    }

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function fetchPushLifecycleStatus(): Promise<PushLifecycleStatus | { error: string; status: number }> {
  const res = await fetch('/api/notifications/push', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? 'error', status: res.status }
  return (await res.json()) as PushLifecycleStatus
}

export async function enablePushNotifications(): Promise<PushLifecycleResult> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' }
  }

  const status = await fetchPushLifecycleStatus()
  if ('error' in status) {
    if (status.status === 401) return { ok: false, reason: 'unauthorized' }
    if (status.status === 404) return { ok: false, reason: 'notifications-disabled' }
    return { ok: false, reason: 'subscribe-failed', detail: status.error }
  }
  if (status.vapidStatus !== 'configured' || !status.publicKey) {
    return { ok: false, reason: 'not_configured', detail: status.missing.join(',') }
  }

  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : Notification.permission === 'denied'
        ? 'denied'
        : await Notification.requestPermission()

  if (permission === 'denied') return { ok: false, reason: 'permission-denied' }
  if (permission !== 'granted') return { ok: false, reason: 'permission-dismissed' }

  const reg = await navigator.serviceWorker.register(status.serviceWorkerUrl, { scope: '/' })
  await navigator.serviceWorker.ready

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(status.publicKey) as BufferSource,
  })

  const res = await fetch('/api/notifications/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 503) return { ok: false, reason: 'not_configured', detail: err.missing?.join?.(',') }
    return { ok: false, reason: 'subscribe-failed', detail: err.error }
  }

  const json = (await res.json()) as { endpoint: string }
  return { ok: true, endpoint: json.endpoint }
}

export async function disablePushNotifications(): Promise<PushLifecycleResult> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported' }
  }

  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (!sub) return { ok: true, endpoint: '' }

  const endpoint = sub.endpoint
  const res = await fetch('/api/notifications/push/unsubscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { ok: false, reason: 'unsubscribe-failed', detail: err.error }
  }

  await sub.unsubscribe().catch(() => undefined)
  return { ok: true, endpoint }
}
