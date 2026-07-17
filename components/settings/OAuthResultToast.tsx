'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'

const MESSAGES: Record<string, { icon: 'success' | 'error'; msg: string }> = {
  gcal: { icon: 'success', msg: 'Google Calendar חובר בהצלחה' },
  gdrive: { icon: 'success', msg: 'Google Drive חובר בהצלחה' },
  gcal_error: { icon: 'error', msg: 'החיבור ל-Google Calendar נכשל. נסה שוב.' },
  gdrive_error: { icon: 'error', msg: 'החיבור ל-Google Drive נכשל. נסה שוב.' },
}

const SUCCESS_VALUE = 'connected'

export default function OAuthResultToast() {
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return

    const url = new URL(window.location.href)
    const params = url.searchParams

    let matched: { icon: 'success' | 'error'; msg: string } | null = null
    for (const key of Object.keys(MESSAGES)) {
      if (!params.has(key)) continue
      const isError = key.endsWith('_error')
      if (!isError && params.get(key) !== SUCCESS_VALUE) continue
      matched = MESSAGES[key]
      break
    }

    if (!matched) return
    firedRef.current = true

    toast(matched.icon, matched.msg)

    for (const key of Object.keys(MESSAGES)) params.delete(key)
    const query = params.toString()
    window.history.replaceState(null, '', url.pathname + (query ? `?${query}` : '') + url.hash)
  }, [])

  return null
}
