'use client'

import { useEffect } from 'react'
import WhatsappConversation from '@/components/summary/WhatsappConversation'
import { useInboxStore } from '@/modules/inbox/client/inboxStore'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'

/**
 * Client wrapper that renders the open thread from the shared store, so the
 * /sync loop can append new messages live. Seeds (and re-seeds on conversation
 * switch / router.refresh) from the server-rendered messages. Until the store's
 * active conversation matches, it renders the server messages directly — no flash.
 */
export default function InboxThread({
  conversationId,
  leadId,
  initialMessages,
}: {
  conversationId: number
  leadId: number
  initialMessages: LeadWhatsappMessage[]
}) {
  const { activeConversationId, activeMessages, initActiveThread } = useInboxStore()

  useEffect(() => {
    initActiveThread(conversationId, initialMessages)
  }, [conversationId, initialMessages, initActiveThread])

  const messages = activeConversationId === conversationId ? activeMessages : initialMessages
  return <WhatsappConversation messages={messages} leadId={leadId} />
}
