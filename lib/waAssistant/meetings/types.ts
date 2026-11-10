import type { ReplyButton, ReplyDocument } from '@/lib/whatsapp/platform/sendText'

/** What a meeting step hands back to the worker: one reply, and how to close the job. */
export type MeetingReply = {
  status: 'answered' | 'refused' | 'failed'
  stopReason: string
  text: string | null
  buttons?: ReplyButton[]
  /** A PDF shown above the buttons. */
  document?: ReplyDocument | null
  /** Kept as conversation memory (24h) so the next turn has context; never customer contact data. */
  headline: string | null
}
