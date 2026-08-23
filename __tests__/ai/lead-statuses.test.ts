import { describe, it, expect } from 'vitest'
import { classifyLeadStatus } from '@/lib/copilot/copilotContext'
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from '@/lib/ai/leadStatuses'

// ─── classifyLeadStatus ──────────────────────────────────────────────────────
// The classifier maps the dozen+ Hebrew status strings into 5 buckets.
// Drift here would silently change copilot suggestion behavior (terminal →
// no suggestions) or follow-up rule activation. The tests pin every member
// of the canonical sets and the catch-alls.

describe('classifyLeadStatus — terminal statuses', () => {
  it.each([...TERMINAL_STATUSES].map((s) => [s] as const))('%s → terminal', (status) => {
    expect(classifyLeadStatus(status)).toBe('terminal')
  })
})

describe('classifyLeadStatus — active statuses', () => {
  it.each([...ACTIVE_STATUSES].map((s) => [s] as const))('%s → active', (status) => {
    expect(classifyLeadStatus(status)).toBe('active')
  })
})

describe('classifyLeadStatus — null / undefined / empty are unknown', () => {
  it.each([[null], [undefined], ['']])('%s → unknown', (status) => {
    expect(classifyLeadStatus(status as string | null | undefined)).toBe('unknown')
  })
})

describe('classifyLeadStatus — anything else is cool', () => {
  it.each([['פגישה נקבעה'], ['בהצעה'], ['unknown-custom-status'], ['Lead']])(
    '%s → cool (catch-all)',
    (status) => {
      expect(classifyLeadStatus(status)).toBe('cool')
    },
  )
})

// ─── Status set hygiene ─────────────────────────────────────────────────────
// Sets are now single-sourced in lib/ai/leadStatuses.ts. These checks would
// fail if a future edit shrinks/breaks the canonical sets.

describe('canonical status sets', () => {
  it('terminal and active sets are disjoint', () => {
    for (const t of TERMINAL_STATUSES) {
      expect(ACTIVE_STATUSES.has(t)).toBe(false)
    }
  })

  it('terminal set covers the production close-states', () => {
    // Hard-pinned: any change here is a deliberate product decision.
    expect(TERMINAL_STATUSES.has('סגורה')).toBe(true)
    expect(TERMINAL_STATUSES.has('לא רלוונטי')).toBe(true)
    expect(TERMINAL_STATUSES.has('לא מעוניין')).toBe(true)
    expect(TERMINAL_STATUSES.has('הסתיים טיפול')).toBe(true)
    expect(TERMINAL_STATUSES.has('הועבר לנציג אחר')).toBe(true)
  })

  it('active set covers the production engagement states', () => {
    expect(ACTIVE_STATUSES.has('חדש')).toBe(true)
    expect(ACTIVE_STATUSES.has('בטיפול')).toBe(true)
    expect(ACTIVE_STATUSES.has('ממתין לתשובה')).toBe(true)
  })
})

// ─── Persisted (English) vocabulary ─────────────────────────────────────────
// clients.status stores the English keys declared in lib/leads/statusStyles.ts
// and mirrored as catalog data in lib/automations/catalog/entries/events.ts.
// The canonical sets previously held only Hebrew LABELS, so they matched no row:
// every real status fell through to 'cool', which meant closed/lost leads still
// received copilot sales suggestions and follow-up pulses.

describe('canonical sets cover the persisted English vocabulary', () => {
  it('terminal set contains the persisted close-states', () => {
    expect(TERMINAL_STATUSES.has('closed')).toBe(true)
    expect(TERMINAL_STATUSES.has('lost')).toBe(true)
  })

  it('active set contains the persisted engagement-states', () => {
    expect(ACTIVE_STATUSES.has('new')).toBe(true)
    expect(ACTIVE_STATUSES.has('contacted')).toBe(true)
    expect(ACTIVE_STATUSES.has('interested')).toBe(true)
  })
})

describe('classifyLeadStatus — persisted English statuses', () => {
  it.each([['closed'], ['lost']])('%s → terminal', (status) => {
    expect(classifyLeadStatus(status)).toBe('terminal')
  })

  it.each([['new'], ['contacted'], ['interested']])('%s → active', (status) => {
    expect(classifyLeadStatus(status)).toBe('active')
  })
})
