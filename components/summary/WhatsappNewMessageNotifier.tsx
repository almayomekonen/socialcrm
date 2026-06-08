'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'

export default function WhatsappNewMessageNotifier({ latestInboundId }: { latestInboundId: number | null }) {
  const seenRef = useRef<number | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!initializedRef.current) {
      seenRef.current = latestInboundId
      initializedRef.current = true
      return
    }
    if (latestInboundId !== null && (seenRef.current === null || latestInboundId > seenRef.current)) {
      toast('success', 'התקבלה הודעת WhatsApp חדשה')
      seenRef.current = latestInboundId
    }
  }, [latestInboundId])

  return null
}
