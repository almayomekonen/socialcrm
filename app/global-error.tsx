'use client'

// Root error boundary. Next renders this IN PLACE OF the root layout when an
// error escapes every nested boundary — including failures during initial
// hydration, which is exactly where a post-deploy ChunkLoadError surfaces.
// Without this file the user would get Next's bare default error page or a
// blank white screen. Because it replaces the root layout, it does NOT inherit
// the app's global CSS, so everything here is inline-styled and self-contained.

import { useEffect, useState } from 'react'
import { isChunkError, markChunkReloadAttempt, clearChunkReloadFlag } from '@/lib/chunkRecovery'

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Start in "recovering" only for a recoverable chunk error, so we never flash
  // an error message before an imminent reload — and never show the recovering
  // state for a real (non-recoverable) crash.
  const [recovering, setRecovering] = useState(() => isChunkError(error))

  useEffect(() => {
    // Keep it in logs for observability (digest correlates with server logs).
    console.error('[global-error]', error?.digest ?? '', error)

    if (isChunkError(error) && markChunkReloadAttempt()) {
      // Recoverable and not yet retried this window → reload the document once.
      window.location.reload()
      return
    }
    // Non-chunk crash, or a chunk error that already survived one reload
    // (persistent) → do NOT reload again. Show the manual recovery UI.
    setRecovering(false)
  }, [error])

  return (
    <html lang='he' dir='rtl'>
      <body style={S.body}>{recovering ? <Recovering /> : <Crashed />}</body>
    </html>
  )
}

// Shown for the brief moment before a guarded auto-reload of a chunk error.
// This is a genuine in-flight recovery, not a spinner masking a crash: it only
// renders when we are actually about to reload a KNOWN-recoverable failure.
function Recovering() {
  return (
    <div style={S.center}>
      <div style={S.spinner} />
      <p style={S.muted}>טוען מחדש…</p>
      <style>{spinnerKeyframes}</style>
    </div>
  )
}

// Shown for a real crash, or a chunk error that a reload did not fix. Never a
// blank screen, never Next's default page — always an actionable recovery.
function Crashed() {
  return (
    <div style={S.center}>
      <div style={S.card}>
        <h1 style={S.title}>אירעה שגיאה בטעינת הדף</h1>
        <p style={S.text}>ניתן לנסות לרענן את הדף. אם הבעיה חוזרת, נסו שוב בעוד רגע.</p>
        <button
          type='button'
          style={S.button}
          onClick={() => {
            // A fresh document is the reliable recovery for a version skew.
            // Clear the guard so this manual reload isn't treated as a loop.
            clearChunkReloadFlag()
            window.location.reload()
          }}
        >
          רענן את הדף
        </button>
      </div>
    </div>
  )
}

const spinnerKeyframes = '@keyframes gerspin{to{transform:rotate(360deg)}}'

const S: Record<string, React.CSSProperties> = {
  body: { margin: 0, fontFamily: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif', background: '#fff', color: '#111827' },
  center: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' },
  card: { maxWidth: 420, border: '1px solid #e5e7eb', borderRadius: 12, padding: '28px 24px', display: 'grid', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  title: { fontSize: 20, fontWeight: 700, margin: 0 },
  text: { fontSize: 14, lineHeight: 1.6, color: '#4b5563', margin: 0 },
  muted: { fontSize: 14, color: '#6b7280', margin: 0 },
  button: { marginTop: 4, height: 44, padding: '0 20px', border: 'none', borderRadius: 8, background: '#2042F5', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  spinner: { width: 36, height: 36, borderRadius: '50%', border: '3px solid #e5e7eb', borderTopColor: '#2042F5', animation: 'gerspin 0.7s linear infinite' },
}
