'use client'

import { useEffect, type ReactNode } from 'react'
import WhatsappConversation from '@/components/summary/WhatsappConversation'
import { useInboxStore } from '@/modules/inbox/client/inboxStore'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'

export default function InboxThread({
  conversationId,
  leadId,
  initialMessages,
  displayName = null,
  leadStatus = null,
  customerWaId = null,
  banner = null,
}: {
  conversationId: number
  leadId: number
  initialMessages: LeadWhatsappMessage[]
  displayName?: string | null
  leadStatus?: string | null
  customerWaId?: string | null
  banner?: ReactNode
}) {
  const { activeConversationId, activeMessages, initActiveThread } = useInboxStore()

  useEffect(() => {
    initActiveThread(conversationId, initialMessages)
  }, [conversationId, initialMessages, initActiveThread])

  const messages = activeConversationId === conversationId ? activeMessages : initialMessages
  return (
    <WhatsappConversation
      messages={messages}
      leadId={leadId}
      displayName={displayName}
      leadStatus={leadStatus}
      customerWaId={customerWaId}
      banner={banner}
    />
  )
}
