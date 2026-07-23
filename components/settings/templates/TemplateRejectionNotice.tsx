import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'

/**
 * The rejection reason for a declined ready-made message, in the same calm status
 * box as the connection notices (error tone). `failureText` is the already-mapped
 * Hebrew (never a raw Meta reason) resolved server-side. The "ערוך ונסה שוב" retry
 * action arrives in Sprint 5; here we surface the reason.
 */
export default function TemplateRejectionNotice({ failureText }: { failureText: string }) {
  const notice: Notice = { tone: 'error', title: 'ההודעה לא אושרה', explanation: failureText }
  return <ConnectionNotice notice={notice} />
}
