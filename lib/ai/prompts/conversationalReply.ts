import type { SocialIntent } from '@/lib/copilot/intents'

export type ConversationalReply = {
  reply: string
  intent: SocialIntent
}
