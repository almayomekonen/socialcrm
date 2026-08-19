'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import SendReadyMessage from '@/components/clients/SendReadyMessage'
import SendReadyMessageMobile from '@/components/clients/SendReadyMessageMobile'
import {
  INTEGRATIONS_SETTINGS_HREF,
  SERVICE_WINDOW_COPY,
  TEMPLATES_SETTINGS_HREF,
  noticeForComposerHealth,
  resolveWhatsappComposerDecision,
} from '@/lib/inbox/whatsappComposerDecision'
import { latestInboundTimestamp, resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import type { WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import type { Template } from '@/lib/whatsapp/templates/types'

export type WhatsappComposerFacts = {
  health: WhatsappHealthPrimary
  templatesEnabled: boolean
  templates: Template[]
  canManageTemplates: boolean
}

/**
 * Conversation composer shell. Window is derived from the loaded inbound
 * timestamps via the shared helper. Health + templates arrive from the server.
 */
export default function WhatsappComposerPanel({
  leadId,
  conversationId = null,
  messages,
  facts,
  textComposer,
  readyMessageSurface = 'modal',
}: {
  leadId: number | null
  conversationId?: number | null
  messages: ReadonlyArray<{ direction: string; timestamp?: string | null }>
  facts: WhatsappComposerFacts
  textComposer: ReactNode
  /** Phone Inbox uses a sheet. Desktop keeps the existing middle modal. */
  readyMessageSurface?: 'modal' | 'sheet'
}) {
  const window = resolveWhatsappServiceWindow(latestInboundTimestamp(messages))
  const decision = resolveWhatsappComposerDecision({
    leadId,
    health: facts.health,
    window,
    templatesEnabled: facts.templatesEnabled,
    hasApprovedTemplates: facts.templates.length > 0,
  })

  if (decision.kind === 'leadless') return null

  if (decision.kind === 'text') return <>{textComposer}</>

  if (decision.kind === 'health_blocked') {
    const notice = noticeForComposerHealth(facts.health)
    return (
      <div className='grid gap-2'>
        {notice ? (
          <ConnectionNotice notice={notice} />
        ) : (
          <p className='text-sm text-gray-500'>
            כדי לשלוח הודעות,{' '}
            <Link href={INTEGRATIONS_SETTINGS_HREF as Route} className='font-medium text-primary-text underline'>
              חברו את וואטסאפ
            </Link>
          </p>
        )}
        {notice && (
          <Link href={INTEGRATIONS_SETTINGS_HREF as Route} className='text-sm font-medium text-primary-text underline'>
            להגדרות החיבור
          </Link>
        )}
      </div>
    )
  }

  if (decision.kind === 'window_unknown') {
    return <p className='text-sm text-gray-500'>{SERVICE_WINDOW_COPY.unknown}</p>
  }

  if (decision.kind === 'template' && leadId != null) {
    const Picker = readyMessageSurface === 'sheet' ? SendReadyMessageMobile : SendReadyMessage
    return (
      <div className='grid gap-2'>
        <p className='text-sm font-medium text-gray-800'>{SERVICE_WINDOW_COPY.closedTitle}</p>
        <p className='text-sm text-gray-500'>{SERVICE_WINDOW_COPY.closedBody}</p>
        <Picker
          leadId={leadId}
          conversationId={conversationId}
          templates={facts.templates}
          lbl={SERVICE_WINDOW_COPY.closedCta}
        />
      </div>
    )
  }

  return (
    <div className='grid gap-2'>
      <p className='text-sm text-gray-500'>{SERVICE_WINDOW_COPY.closedNoTemplate}</p>
      {facts.canManageTemplates && (
        <Link href={TEMPLATES_SETTINGS_HREF as Route} className='text-sm font-medium text-primary-text underline'>
          {SERVICE_WINDOW_COPY.templatesSettings}
        </Link>
      )}
    </div>
  )
}
