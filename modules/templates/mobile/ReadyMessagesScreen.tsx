import Link from 'next/link'
import type { Route } from 'next'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { listTemplates } from '@/db/whatsappTemplates'
import ReadyMessagesWorkspace from './ReadyMessagesWorkspace'

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
}: {
  agencyId: number
  connected: boolean
  messagingReady: boolean
}) {
  if (!connected) {
    return (
      <div className='px-4 pb-8 pt-4'>
        <BackLink />
        <h1 className='text-xl font-bold text-ink'>הודעות מוכנות</h1>
        <div className='mt-3 grid gap-3'>
          <ConnectionNotice notice={NOT_CONNECTED} />
          <Link
            href={'/settings/integrations?section=whatsapp' as Route}
            className='press flex min-h-11 items-center justify-center rounded-md bg-solid font-medium text-white'
          >
            למעבר לחיבור וואטסאפ
          </Link>
        </div>
      </div>
    )
  }

  if (!messagingReady) {
    return (
      <div className='px-4 pb-8 pt-4'>
        <BackLink />
        <h1 className='text-xl font-bold text-ink'>הודעות מוכנות</h1>
        <div className='mt-3'>
          <ConnectionNotice notice={NOT_READY} />
        </div>
      </div>
    )
  }

  return <ReadyMessagesBody agencyId={agencyId} />
}

function BackLink() {
  return (
    <Link
      href={'/settings/integrations' as Route}
      className='mb-3 inline-flex min-h-11 items-center text-sm font-medium text-primary-text'
    >
      חזרה לאינטגרציות
    </Link>
  )
}

async function ReadyMessagesBody({ agencyId }: { agencyId: number }) {
  const templates = await listTemplates(agencyId)
  return <ReadyMessagesWorkspace initial={templates} />
}
