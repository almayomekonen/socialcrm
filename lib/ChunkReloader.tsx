'use client'

import { useEffect, useState } from 'react'
import { LEGACY_DEFAULT_LOCALE, type UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { preLoginLocaleFrom, readUiLocaleCookie, rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'
// Only this one sentence per language: the root layout ships on every route,
// marketing included, so the full catalogs must not be pulled into its bundle.
import { root as heRoot } from '@/lib/i18n/messages/he/auth/oauth'
import { root as enRoot } from '@/lib/i18n/messages/en/auth/oauth'
import { root as arRoot } from '@/lib/i18n/messages/ar/auth/oauth'

/** The catalog key of the sentence below (pinned to it in preLoginCopyPin.test.ts). */
export const CHUNK_RELOADING_KEY = 'auth.root.chunkReloading' satisfies MessageKey

const RELOADING: Record<UiLocale, string> = {
  he: heRoot.chunkReloading,
  en: enRoot.chunkReloading,
  ar: arRoot.chunkReloading,
}


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
  // The root layout has no session: the overlay's language is the `ui_locale`
  // hint (Phase F4), read only when a reload is triggered (never during the
  // first render, so hydration cannot disagree). No cookie → Hebrew.
  const [locale, setLocale] = useState<UiLocale>(LEGACY_DEFAULT_LOCALE)

  useEffect(() => {
    const clearTimer = setTimeout(() => {
      try { sessionStorage.removeItem(RELOAD_FLAG) } catch {}
    }, 5000)

    function triggerReload() {
      try {
        if (sessionStorage.getItem(RELOAD_FLAG)) return
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
      } catch {}
      try {
        setLocale(preLoginLocaleFrom(readUiLocaleCookie(document.cookie), true))
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
      {...rtlOrRegionAttrs(locale)}
      className='fixed inset-0 z-10000 flex items-center justify-center bg-black/40 backdrop-blur-sm'
    >
      <div className='bg-white rounded-xl px-6 py-5 shadow-xl flex items-center gap-3'>
        <div className='size-5 border-2 border-primary border-t-transparent rounded-full animate-spin' />
        <p className='text-gray-800 font-medium'>{RELOADING[locale]}</p>
      </div>
    </div>
  )
}
