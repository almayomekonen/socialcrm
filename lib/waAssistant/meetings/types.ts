import type { ReplyButton } from '@/lib/whatsapp/platform/sendText'

/** What a meeting step hands back to the worker: one reply, and how to close the job. */
export type MeetingReply = {
  status: 'answered' | 'refused' | 'failed'
  stopReason: string
  text: string | null
  buttons?: ReplyButton[]
  /** Kept as conversation memory (24h) so the next turn has context; never customer contact data. */
  headline: string | null
}
