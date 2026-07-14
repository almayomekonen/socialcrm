'use client'

import { useEffect, useState } from 'react'


const CHUNK_ERROR_PATTERNS = [
  'Loading chunk',
  'ChunkLoadError',
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
]

const RELOAD_FLAG = '__chunk_reload_attempted__'

function isChunkError(message: unknown): boolean {
  if (typeof message !== 'string') return false
  return CHUNK_ERROR_PATTERNS.some((p) => message.includes(p))
}

export default function ChunkReloader() {
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    const clearTimer = setTimeout(() => {
      try { sessionStorage.removeItem(RELOAD_FLAG) } catch {}
    }, 5000)

    function triggerReload() {
      try {
        if (sessionStorage.getItem(RELOAD_FLAG)) return
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
      } catch {}
      setReloading(true)
      setTimeout(() => {
        try { window.location.reload() } catch {}
      }, 800)
    }

    function onError(e: ErrorEvent) {
      const msg = e?.message || e?.error?.message
      if (isChunkError(msg)) triggerReload()
    }

    function onRejection(e: PromiseRejectionEvent) {
      const reason = e?.reason
      const msg = typeof reason === 'string' ? reason : reason?.message
      if (isChunkError(msg)) triggerReload()
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      clearTimeout(clearTimer)
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
