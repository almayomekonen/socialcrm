'use client'

// Recovers from chunk-load failures that happen AFTER a healthy mount — e.g. a
// lazy import triggered by a later click/navigation whose chunk 404s because a
// deploy landed mid-session. Failures during the INITIAL render/hydration are
// handled by app/global-error.tsx instead; both share the same loop guard in
// lib/chunkRecovery so they can never double-reload.

import { useEffect, useState } from 'react'
import { isChunkError, markChunkReloadAttempt, clearChunkReloadFlag } from './chunkRecovery'

export default function ChunkReloader() {
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    // This component only mounts on a healthy render, which proves the current
    // document and its chunks are in sync. Clear the guard so a future
    // (different-deploy) chunk error is allowed to auto-recover once more.
    clearChunkReloadFlag()

    function recover(candidate: unknown) {
      if (!isChunkError(candidate)) return
      if (!markChunkReloadAttempt()) return // already reloaded once this window — do not loop
      setReloading(true)
      window.setTimeout(() => {
        try {
          window.location.reload()
        } catch {}
      }, 600)
    }

    const onError = (e: ErrorEvent) => recover(e?.error ?? e?.message)
    const onRejection = (e: PromiseRejectionEvent) => recover(e?.reason)

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (!reloading) return null

  return (
    <div
      dir='rtl'
      className='fixed inset-0 z-10000 flex items-center justify-center bg-black/40 backdrop-blur-sm'
    >
      <div className='bg-white rounded-xl px-6 py-5 shadow-xl flex items-center gap-3'>
        <div className='size-5 border-2 border-primary border-t-transparent rounded-full animate-spin' />
        <p className='text-gray-800 font-medium'>עדכון חדש נטען, מרענן...</p>
      </div>
    </div>
  )
}
