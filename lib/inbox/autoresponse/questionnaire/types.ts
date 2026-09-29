/**
 * The handful of values the questionnaire's runtime files share.
 *
 * Its own module so `processJob` and `finalize` can depend on the same
 * constants without importing each other, which would be a cycle.
 */
import type { sendWhatsappInteractive, sendWhatsappText } from '@/lib/whatsapp/sendMessage'

/**
 * Abandon a Graph call before the 60s job lease can hand the same job to a
 * second worker. A request still in flight when another worker picks the job up
 * is how one question becomes two messages.
 */
export const QUESTIONNAIRE_SEND_TIMEOUT_MS = 20_000

/** `deferred`: back to pending for after a pre-turn typing hold (typingDefer.ts). */
export type QuestionnaireOutcome = 'sent' | 'skipped' | 'failed' | 'deferred'
export type QuestionnaireDeps = {
  send: typeof sendWhatsappText
  /** Tap-to-select sends (interactive.ts). Defaults to the real Graph call. */
  sendInteractive?: typeof sendWhatsappInteractive
}
