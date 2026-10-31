import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Hebrew baseline for the lead → WhatsApp contact toasts, recorded before
 * Phase F6 on unmodified code. Every surface that contacts a lead by button
 * (desktop row menu, Today quick actions, the phone list / overflow sheet /
 * contact bar) ends in one of these four sentences, so they are pinned here
 * with the exact arguments `toast` receives.
 */

const toastFn = vi.fn()
const resolveConversation = vi.fn()
const recordEvent = vi.fn(async (..._args: unknown[]) => {})

vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toastFn(...args) }))
vi.mock('@/modules/inbox/actions', () => ({
  resolveLeadWhatsappConversation: (...args: unknown[]) => resolveConversation(...args),
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: (...args: unknown[]) => recordEvent(...args),
}))

import { openLeadWhatsappInInbox } from '@/modules/inbox/client/openLeadWhatsapp'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'

beforeEach(() => {
  toastFn.mockClear()
  resolveConversation.mockReset()
})

async function toastFor(reason: string) {
  resolveConversation.mockResolvedValue({ conversationId: null, reason })
  const outcome = await openLeadWhatsappInInbox(5, vi.fn())
  return { outcome: outcome.kind, calls: toastFn.mock.calls }
}

describe('contact toasts — Hebrew baseline', () => {
  it('in-app conversation outcomes', async () => {
    const recorded = {
      noConnection: await toastFor('no-connection'),
      noRecipient: (toastFn.mockClear(), await toastFor('no-recipient')),
      unavailable: (toastFn.mockClear(), await toastFor('lead-missing')),
    }
    expect(recorded).toMatchInlineSnapshot(`
      {
        "noConnection": {
          "calls": [
            [
              "message",
              "יש לחבר WhatsApp בהגדרות לפני פתיחת שיחה",
            ],
          ],
          "outcome": "no-connection",
        },
        "noRecipient": {
          "calls": [
            [
              "message",
              "לליד אין מספר טלפון תקין לשיחת WhatsApp",
            ],
          ],
          "outcome": "no-recipient",
        },
        "unavailable": {
          "calls": [
            [
              "message",
              "לא ניתן לפתוח שיחת WhatsApp לליד זה כרגע",
            ],
          ],
          "outcome": "unavailable",
        },
      }
    `)
  })

  it('a lead without a usable phone, workspace not connected', () => {
    contactLeadViaWhatsapp({ id: 5, phone: null }, false, vi.fn(), 'desktop')
    expect(toastFn.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "message",
          "לליד אין מספר טלפון תקין לוואטסאפ",
        ],
      ]
    `)
  })
})
