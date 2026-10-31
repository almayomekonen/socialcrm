import Link from 'next/link'
import type { Route } from 'next'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { listTemplates } from '@/db/whatsappTemplates'
import ReadyMessagesWorkspace from './ReadyMessagesWorkspace'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey, Translator } from '@/lib/i18n/translate'

const NOTICE_KEYS: Record<'notConnected' | 'notReady', { title: MessageKey; explanation: MessageKey }> = {
  notConnected: { title: 'settings.templates.notConnected.title', explanation: 'settings.templates.notConnected.explanation' },
  notReady: { title: 'settings.templates.notReady.title', explanation: 'settings.templates.notReady.explanation' },
}

/** A notice in `t`'s language (Hebrew: the constant itself — the same copy as `TemplatesSection`). */
function worded(base: Notice, t: Translator, keys: 'notConnected' | 'notReady'): Notice {
  if (t.locale === 'he') return base
  return { ...base, title: t(NOTICE_KEYS[keys].title), explanation: t(NOTICE_KEYS[keys].explanation) }
}

const NOT_CONNECTED: Notice = {
  tone: 'attention',
  title: 'צריך לחבר וואטסאפ עסקי',
  explanation: 'כדי ליצור הודעות WhatsApp מוכנות, חברו קודם את מספר הוואטסאפ העסקי.',
}

const NOT_READY: Notice = {
  tone: 'attention',
  title: 'חיבור הוואטסאפ עדיין לא מוכן',
  explanation: 'לאחר שהחיבור יאומת, אפשר יהיה ליצור הודעות WhatsApp מוכנות.',
}

/**
 * Phone Ready Messages screen. Connection gating is the same copy TemplatesSection
 * already uses — no new plan policy.
 */
export default async function ReadyMessagesScreen({
  agencyId,
  connected,
  messagingReady,
  locale = 'he',
}: {
  agencyId: number
  connected: boolean
  messagingReady: boolean
  /** The interface language, resolved once by the page (Hebrew by default). */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  if (!connected) {
    return (
      <div className='px-4 pb-8 pt-4' {...regionAttrs(locale)}>
        <BackLink t={t} />
        <h1 className='text-xl font-bold text-ink'>{t('settings.mobile.landing.readyMessages')}</h1>
        <div className='mt-3 grid gap-3'>
          <ConnectionNotice notice={worded(NOT_CONNECTED, t, 'notConnected')} />
          <Link
            href={'/settings/integrations?section=whatsapp' as Route}
            className='press flex min-h-11 items-center justify-center rounded-md bg-solid font-medium text-white'
          >
            {t('settings.templates.goConnect')}
          </Link>
        </div>
      </div>
    )
  }

  if (!messagingReady) {
    return (
      <div className='px-4 pb-8 pt-4' {...regionAttrs(locale)}>
        <BackLink t={t} />
        <h1 className='text-xl font-bold text-ink'>{t('settings.mobile.landing.readyMessages')}</h1>
        <div className='mt-3'>
          <ConnectionNotice notice={worded(NOT_READY, t, 'notReady')} />
        </div>
      </div>
    )
  }

  return <ReadyMessagesBody agencyId={agencyId} />
}

function BackLink({ t }: { t: Translator }) {
  return (
    <Link
      href={'/settings/integrations' as Route}
      className='mb-3 inline-flex min-h-11 items-center text-sm font-medium text-primary-text'
    >
      {t('settings.mobile.landing.back')}
    </Link>
  )
}

async function ReadyMessagesBody({ agencyId }: { agencyId: number }) {
  const templates = await listTemplates(agencyId)
  return <ReadyMessagesWorkspace initial={templates} />
}
