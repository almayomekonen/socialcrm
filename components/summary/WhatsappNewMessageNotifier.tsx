'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'

export default function WhatsappNewMessageNotifier({ latestInboundId }: { latestInboundId: number | null }) {
  const t = useT()
  const seenRef = useRef<number | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!initializedRef.current) {
      seenRef.current = latestInboundId
      initializedRef.current = true
      return
    }
    if (latestInboundId !== null && (seenRef.current === null || latestInboundId > seenRef.current)) {
      toast('success', t('inbox.conversation.newMessage'))
      seenRef.current = latestInboundId
    }
  }, [latestInboundId, t])

  return null
}
