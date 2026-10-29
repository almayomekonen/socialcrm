'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import LeadPicker from '@/components/billing/lead-picker/LeadPicker'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { createLeadFromMessengerConversation, linkMessengerConversationToLead, type MessengerLeadResult } from '../leadActions'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

const FAILURE_KEYS: Record<string, MessageKey> = {
  not_enabled: 'inbox.messenger.lead.failure.not_enabled',
  not_found: 'inbox.messenger.lead.failure.not_found',
  quota_exceeded: 'inbox.messenger.lead.failure.quota_exceeded',
  create_failed: 'inbox.messenger.lead.failure.create_failed',
}

/**
 * Lead association for a Messenger conversation: open the linked ליד, or
 * create one, or attach an existing one through the shared LeadPicker (the
 * same picker the calendar uses — its search is permission-scoped server-side).
 * `locale` labels our controls and toasts; the picker's own panel is shared and
 * still Hebrew.
 */
export default function MessengerLeadActions({
  conversationId,
  leadId,
  leadName,
  locale = 'he',
}: {
  conversationId: number
  leadId: number | null
  leadName: string | null
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const router = useRouter()
  const { loading, run, accessDenied } = useAction()

  if (leadId) {
    return (
      <Link href={`/clients/${leadId}/summary`} className='text-sm text-primary underline underline-offset-2'>
        {leadName ? t('inbox.messenger.lead.openNamed', { name: leadName }) : t('inbox.messenger.lead.open')}
      </Link>
    )
  }

  if (accessDenied) {
    return (
      <SubscriptionExpiredState
        mode='inline'
        source='messenger_lead'
        feature={t('inbox.messenger.lead.expired')}
        translated={locale !== 'he'}
      />
    )
  }

  const handle = (result: MessengerLeadResult, success: string) => {
    if ('reason' in result) {
      toast('error', t(FAILURE_KEYS[result.reason] ?? FAILURE_KEYS.create_failed))
      return
    }
    toast('success', success)
    router.refresh()
  }

  const create = () =>
    run(async () => handle(await createLeadFromMessengerConversation(conversationId), t('inbox.messenger.lead.created')))

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Btn
        lbl={loading ? t('inbox.messenger.lead.creating') : t('inbox.messenger.lead.create')}
        icon={loading ? 'spinner' : undefined}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant='outline'
        size='small'
        className='w-fit'
        disabled={loading}
        onClick={create}
      />
      <div className='w-52'>
        <LeadPicker
          currentLeadId={0}
          currentLeadName={t('inbox.messenger.lead.link')}
          recentLeads={[]}
          onPick={(id) =>
            run(async () => handle(await linkMessengerConversationToLead(conversationId, id), t('inbox.messenger.lead.linked')))
          }
          onCreateNew={create}
        />
      </div>
    </div>
  )
}
