/**
 * Browser PushSubscription payload validation — P3.1. Spec §15.3, §20.5.
 *
 * Accepts only what we persist: endpoint + p256dh + auth. Zod strips unknown
 * keys so a client cannot smuggle phone/email/idNum/userId/agencyId into the
 * row. Malformed required fields fail the parse.
 */

import { z } from 'zod'

const MAX_ENDPOINT = 2048
const MAX_KEY = 512

export const PushSubscriptionBodySchema = z.object({
  endpoint: z
    .string()
    .min(1)
    .max(MAX_ENDPOINT)
    .refine((v) => /^https:\/\//i.test(v), { message: 'endpoint-must-be-https' }),
  keys: z.object({
    p256dh: z.string().min(1).max(MAX_KEY),
    auth: z.string().min(1).max(MAX_KEY),
  }),
})

export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBodySchema>

export type ParsePushSubscriptionResult = { ok: true; value: PushSubscriptionBody } | { ok: false; error: 'invalid-subscription' }

/**
 * Parse and narrow. Returns only the three stored fields — never the raw body.
 */
export function parsePushSubscriptionBody(raw: unknown): ParsePushSubscriptionResult {
  const result = PushSubscriptionBodySchema.safeParse(raw)
  if (!result.success) return { ok: false, error: 'invalid-subscription' }
  return {
    ok: true,
    value: {
      endpoint: result.data.endpoint,
      keys: {
        p256dh: result.data.keys.p256dh,
        auth: result.data.keys.auth,
      },
    },
  }
}

/** Truncate User-Agent for storage; never accept it from the JSON body. */
export function truncateUserAgent(header: string | null | undefined): string | null {
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 512)
}
