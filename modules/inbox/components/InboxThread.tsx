'use client'

import { useEffect, type ReactNode } from 'react'
import WhatsappConversation from '@/components/summary/WhatsappConversation'
import { useInboxStore } from '@/modules/inbox/client/inboxStore'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import type { WhatsappComposerFacts } from '@/components/inbox/WhatsappComposerPanel'

export default function InboxThread({
  conversationId,
  leadId,
  isPersonal = false,
  initialMessages,
  displayName = null,
  leadStatus = null,
  customerWaId = null,
  banner = null,
  composerFacts = null,
}: {
  conversationId: number
  leadId: number | null
  isPersonal?: boolean
  initialMessages: LeadWhatsappMessage[]
  displayName?: string | null
  leadStatus?: string | null
  customerWaId?: string | null
  banner?: ReactNode
  composerFacts?: WhatsappComposerFacts | null
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
      conversationId={conversationId}
      isPersonal={isPersonal}
      showDelete
      displayName={displayName}
      leadStatus={leadStatus}
      customerWaId={customerWaId}
      banner={banner}
      composerFacts={composerFacts}
    />
  )
}
