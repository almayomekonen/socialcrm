import { describe, expect, it } from 'vitest'
import { canDraftQuote, canManageQuoteTemplates, canReadQuotes, canSendQuote } from '@/lib/quotes/permissions'
import { canIssueBilling } from '@/lib/billing/permissions'
import { Roles } from '@/types/roles'

/**
 * Quote permissions are composed from the SAME role primitives as billing's —
 * no new authorization model. What is worth pinning is the deliberate
 * asymmetry, because it is the sales/accounting boundary expressed in code.
 */

const user = (role: Roles) => ({ role }) as never
const INTERNAL = [Roles.ADMIN, Roles.GM, Roles.MNGR, Roles.AGNT, Roles.OFFICE]

describe('quote permissions', () => {
  it('every internal role may read; visibility is narrowed by lead perms elsewhere', () => {
    for (const role of [...INTERNAL, Roles.EXT]) {
      expect(canReadQuotes(user(role))).toBe(true)
    }
  })

  it('every internal role may draft and send; EXT may do neither', () => {
    for (const role of INTERNAL) {
      expect(canDraftQuote(user(role))).toBe(true)
      expect(canSendQuote(user(role))).toBe(true)
    }
    expect(canDraftQuote(user(Roles.EXT))).toBe(false)
    expect(canSendQuote(user(Roles.EXT))).toBe(false)
  })
})

describe('managing the price list is narrower than using it', () => {
  it('only admins may create, edit or archive templates', () => {
    expect(canManageQuoteTemplates(user(Roles.ADMIN))).toBe(true)
    expect(canManageQuoteTemplates(user(Roles.GM))).toBe(true)
    for (const role of [Roles.MNGR, Roles.AGNT, Roles.OFFICE, Roles.EXT]) {
      expect(canManageQuoteTemplates(user(role)), `role=${role}`).toBe(false)
    }
  })

  it('every role that may MANAGE prices may also USE them', () => {
    // The reverse is deliberately false: a rep quoting ₪4,900 is doing their
    // job; a rep changing what ₪4,900 means for everyone is changing policy.
    for (const role of INTERNAL) {
      if (canManageQuoteTemplates(user(role))) expect(canDraftQuote(user(role))).toBe(true)
    }
    expect(canDraftQuote(user(Roles.AGNT))).toBe(true)
    expect(canManageQuoteTemplates(user(Roles.AGNT))).toBe(false)
  })
})

describe('the sales / accounting boundary', () => {
  it('a נציג may QUOTE but may not INVOICE', () => {
    // The whole point: quoting commits the business to a price it is willing to
    // accept, which is what a rep is for. Issuing an invoice is an accounting
    // act with legal numbering, and it stays managers-only.
    expect(canSendQuote(user(Roles.AGNT))).toBe(true)
    expect(canIssueBilling(user(Roles.AGNT) as never)).toBe(false)
  })

  it('canSendQuote is a strict superset of canIssueBilling', () => {
    for (const role of INTERNAL) {
      if (canIssueBilling(user(role) as never)) expect(canSendQuote(user(role))).toBe(true)
    }
  })

  it('billing permissions are unchanged — managers and above still issue', () => {
    expect(canIssueBilling(user(Roles.MNGR) as never)).toBe(true)
    expect(canIssueBilling(user(Roles.ADMIN) as never)).toBe(true)
    expect(canIssueBilling(user(Roles.GM) as never)).toBe(true)
    expect(canIssueBilling(user(Roles.OFFICE) as never)).toBe(false)
    expect(canIssueBilling(user(Roles.EXT) as never)).toBe(false)
  })
})
