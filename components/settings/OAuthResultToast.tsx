'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

const MESSAGES: Record<string, { icon: 'success' | 'error'; msg: MessageKey }> = {
  gcal: { icon: 'success', msg: 'settings.integrations.oauth.gcal' },
  gdrive: { icon: 'success', msg: 'settings.integrations.oauth.gdrive' },
  gcal_error: { icon: 'error', msg: 'settings.integrations.oauth.gcalError' },
  gdrive_error: { icon: 'error', msg: 'settings.integrations.oauth.gdriveError' },
}

const SUCCESS_VALUE = 'connected'

export default function OAuthResultToast() {
  const t = useT()
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return

    const url = new URL(window.location.href)
    const params = url.searchParams

    let matched: { icon: 'success' | 'error'; msg: MessageKey } | null = null
    for (const key of Object.keys(MESSAGES)) {
      if (!params.has(key)) continue
      const isError = key.endsWith('_error')
      if (!isError && params.get(key) !== SUCCESS_VALUE) continue
      matched = MESSAGES[key]
      break
    }

    if (!matched) return
    firedRef.current = true

    toast(matched.icon, t(matched.msg))

    for (const key of Object.keys(MESSAGES)) params.delete(key)
    const query = params.toString()
    window.history.replaceState(null, '', url.pathname + (query ? `?${query}` : '') + url.hash)
  }, [])

  return null
}
