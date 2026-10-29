'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Link2, User } from 'lucide-react'
import { useAction, ENTITLEMENT_ERROR } from '@/lib/useAction'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import {
  linkConversationToExistingLead,
  listConversationLeadMatches,
  promoteConversationToLead,
  type ConversationLeadMatch,
} from '@/actions/whatsapp/promoteConversationToLead'
import { markConversationPersonal } from '@/actions/whatsapp/markConversationPersonal'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

const HEBREW = translatorFor('he')

const TONE = {
  default:
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
  onGreen:
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/40 bg-white/10 px-2.5 py-1 text-xs font-medium text-white no-underline transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50',
} as const

export default function LeadlessConversationActions({
  conversationId,
  isPersonal,
  tone = 'default',
  translated = false,
}: {
  conversationId: number
  isPersonal: boolean
  /** `onGreen` is the mobile WhatsApp header. Desktop keeps `default`. */
  tone?: keyof typeof TONE
  /** The caller follows the interface language (the desktop inbox). Off: Hebrew (the phone header). */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const router = useRouter()
  /** Entitlement from the shared context — the same answer the server gives. */
  const expired = useAccessDenied()
  const { loading, error, setError, run } = useAction()
  /** Errors are set as catalog keys and shown in the language above (`useAction`'s own generic line is its text). */
  const fail = (key: MessageKey) => setError(t(key))
  const [matches, setMatches] = useState<ConversationLeadMatch[] | null>(null)
  const chip = TONE[tone]

  function refresh() {
    router.refresh()
  }

  function onCreate() {
    void run(async () => {
      const res = await promoteConversationToLead(conversationId)
      if (res.ok === false) {
        fail(res.reason === 'quota_exceeded' ? 'inbox.leadless.quota' : 'inbox.leadless.createFailed')
        return
      }
      refresh()
    })
  }

  function onLinkClick() {
    void run(async () => {
      const listed = await listConversationLeadMatches(conversationId)
      if (listed.ok === false) {
        fail('inbox.leadless.notFound')
        return
      }
      if (listed.matches.length === 0) {
        fail('inbox.leadless.noMatch')
        return
      }
      if (listed.matches.length === 1) {
        const res = await linkConversationToExistingLead(conversationId, listed.matches[0].id)
        if (res.ok === false) {
          fail('inbox.leadless.linkFailed')
          return
        }
        refresh()
        return
      }
      setMatches(listed.matches)
    })
  }

  function onPick(leadId: number) {
    void run(async () => {
      const res = await linkConversationToExistingLead(conversationId, leadId)
      if (res.ok === false) {
        fail('inbox.leadless.linkFailed')
        return
      }
      setMatches(null)
      refresh()
    })
  }

  function onPersonal() {
    void run(async () => {
      const res = await markConversationPersonal(conversationId)
      if (res.ok === false) {
        fail('inbox.leadless.personalFailed')
        return
      }
      refresh()
    })
  }

  /**
   * PRE-SUBMIT GATE, not a post-mortem.
   *
   * Every action behind these chips — promote, link, list matches, mark
   * personal — is `requireProductAccess`-guarded, so for a lapsed subscription
   * all three are already dead. Rendering them live meant the customer clicked
   * "+ צור ליד", waited, and only then learned the subscription had ended: the
   * product let them try something it knew would fail. The locked state now
   * replaces the row before any mutation is attempted.
   *
   * The `ENTITLEMENT_ERROR` branch below stays as the backstop for the one case
   * this cannot cover: the seeded context being stale relative to the server.
   * The server remains the only thing enforcing access.
   */
  if (expired) {
    return <SubscriptionExpiredState mode='inline' source='conversation_actions' feature={t('inbox.leadless.locked')} translated={translated} />
  }

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      <button type='button' className={chip} disabled={loading} onClick={onCreate}>
        <UserPlus aria-hidden className='size-3.5' />
        {t('inbox.leadless.create')}
      </button>
      <button type='button' className={chip} disabled={loading} onClick={onLinkClick}>
        <Link2 aria-hidden className='size-3.5' />
        {t('inbox.leadless.link')}
      </button>
      {!isPersonal && (
        <button type='button' className={chip} disabled={loading} onClick={onPersonal}>
          <User aria-hidden className='size-3.5' />
          {t('inbox.leadless.personal')}
        </button>
      )}
      {/* A lapsed subscription gets the shared locked state, never a retry line. */}
      {error === ENTITLEMENT_ERROR && (
        <SubscriptionExpiredState mode='inline' source='conversation_actions' feature={t('inbox.leadless.locked')} translated={translated} />
      )}
      {error && error !== ENTITLEMENT_ERROR && (
        <span role='alert' className='text-xs text-error-text'>
          {error}
        </span>
      )}
      {matches && matches.length > 1 && (
        <div className='flex w-full flex-wrap items-center gap-1.5'>
          {matches.map((m) => (
            <button
              key={m.id}
              type='button'
              className={chip}
              disabled={loading}
              onClick={() => onPick(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
