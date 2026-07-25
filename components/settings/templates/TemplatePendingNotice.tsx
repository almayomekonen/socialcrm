import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'

/**
 * Calm, reassuring notice for a ready-made message awaiting WhatsApp review —
 * the sibling of `TemplateRejectionNotice`, in the same status box (attention
 * tone, matching the pending badge). It makes the wait legible: the message was
 * submitted to WhatsApp, no user action is needed, and it becomes sendable
 * automatically on approval. Pure presentation — no state, no functionality.
 */
const PENDING_NOTICE: Notice = {
  tone: 'attention',
  title: 'ההודעה נשלחה לאישור וואטסאפ',
  explanation: 'אין צורך לעשות דבר — ברגע שתאושר, היא תהיה מוכנה לשליחה.',
}

export default function TemplatePendingNotice() {
  return <ConnectionNotice notice={PENDING_NOTICE} />
}
