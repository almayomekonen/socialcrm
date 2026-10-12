import { MAX_ADMIN_RECIPIENTS } from './constants'

/**
 * Who receives a reminder. Pure: every fact is passed in, already scoped to the
 * conversation's agency by the caller's query.
 *
 *   1. The lead's handler, when they have an ACTIVE recipient row.
 *   2. Otherwise (and always for a conversation with no lead): up to
 *      MAX_ADMIN_RECIPIENTS active recipients whose role is exactly ADMIN
 *      (not GM), earliest verified first.
 *
 * A recipient is never used when:
 *   - they activated AFTER the hand-off (no backlog: enabling reminders never
 *     reminds about earlier hand-offs), or
 *   - their verified number is the conversation's customer (never remind an
 *     owner about a conversation with themselves).
 */
export type ActiveRecipient = {
  recipientId: number
  userId: number
  role: string
  phoneE164: string
  verifiedAt: Date
}

export function selectReminderRecipients(input: {
  handlerUserId: number | null
  escalatedAt: Date
  customerWaId: string | null
  recipients: ActiveRecipient[]
}): ActiveRecipient[] {
  const customer = (input.customerWaId ?? '').replace(/\D/g, '')
  const usable = input.recipients.filter(
    (r) =>
      r.verifiedAt.getTime() <= input.escalatedAt.getTime() &&
      (customer === '' || r.phoneE164.replace(/\D/g, '') !== customer),
  )
  if (input.handlerUserId != null) {
    const handler = usable.find((r) => r.userId === input.handlerUserId)
    if (handler) return [handler]
  }
  return usable
    .filter((r) => r.role === 'ADMIN')
    .sort((a, b) => a.verifiedAt.getTime() - b.verifiedAt.getTime() || a.recipientId - b.recipientId)
    .slice(0, MAX_ADMIN_RECIPIENTS)
}
