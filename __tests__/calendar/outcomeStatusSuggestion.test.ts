/**
 * Pure-function tests for the lead-status suggestion contract.
 *
 * Every change to suggestNextLeadStatus should land here first — the rest of
 * the system (action result type, hook, nudge banner) consumes whatever this
 * returns. If a test name here changes, the user-visible behavior changes.
 */

import { describe, it, expect } from 'vitest'
import { suggestNextLeadStatus } from '@/lib/calendar/outcomeStatusSuggestion'

describe('suggestNextLeadStatus — completed outcome', () => {
  it('new → interested (meeting attendance is a stronger signal than the outreach-stamp `contacted`)', () => {
    expect(suggestNextLeadStatus('completed', 'new')).toBe('interested')
  })

  it('contacted → interested (contacted is auto-applied by quick actions; meeting completion lifts above it)', () => {
    expect(suggestNextLeadStatus('completed', 'contacted')).toBe('interested')
  })

  it('interested → closed (the funnel-forward nudge after a real conversation)', () => {
    expect(suggestNextLeadStatus('completed', 'interested')).toBe('closed')
  })

  it('closed → null (terminal; we never nudge a committed close back into the funnel)', () => {
    expect(suggestNextLeadStatus('completed', 'closed')).toBeNull()
  })

  it('lost → null (terminal; reviving a lost lead is a deliberate manual action)', () => {
    expect(suggestNextLeadStatus('completed', 'lost')).toBeNull()
  })
})

describe('suggestNextLeadStatus — no_show outcome', () => {
  it.each(['new', 'contacted', 'interested', 'closed', 'lost'])(
    'returns null regardless of current status (%s) — setback is the signal',
    (status) => {
      expect(suggestNextLeadStatus('no_show', status)).toBeNull()
    },
  )
})

describe('suggestNextLeadStatus — defensive defaults', () => {
  it('null current status → null (no nudge if we can\'t classify)', () => {
    expect(suggestNextLeadStatus('completed', null)).toBeNull()
  })

  it('undefined current status → null', () => {
    expect(suggestNextLeadStatus('completed', undefined)).toBeNull()
  })

  it('unrecognized status string → null (forward-compat: never guess for unknown statuses)', () => {
    expect(suggestNextLeadStatus('completed', 'prospect_extended_v2')).toBeNull()
  })
})
