import { describe, it, expect } from 'vitest'
import { followUpPulse, PULSE_LABELS, type FollowUpSignals } from '@/lib/ai/followUpRules'

const base: FollowUpSignals = {
  status: 'בטיפול',
  daysSinceLastInteraction: 1,
  daysInCurrentStatus: 1,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  openTaskCount: 1,
  taskCompletionRate: 0.5,
}

const merge = (over: Partial<FollowUpSignals>): FollowUpSignals => ({ ...base, ...over })

describe('followUpPulse — terminal statuses are silent', () => {
  it.each([['סגורה'], ['לא רלוונטי'], ['לא מעוניין'], ['הסתיים טיפול'], ['הועבר לנציג אחר']])(
    'returns null for %s — even with overdue and due-today tasks',
    (status) => {
      const r = followUpPulse(merge({ status, overdueTaskCount: 5, dueTodayTaskCount: 5 }))
      expect(r).toBeNull()
    },
  )
})

describe('followUpPulse — each pulse state has a representative case', () => {
  it('follow-up-overdue', () => {
    expect(followUpPulse(merge({ overdueTaskCount: 1 }))).toEqual({
      pulse: 'follow-up-overdue',
      label: PULSE_LABELS['follow-up-overdue'],
    })
  })

  it('follow-up-due', () => {
    expect(followUpPulse(merge({ dueTodayTaskCount: 1 }))).toEqual({
      pulse: 'follow-up-due',
      label: PULSE_LABELS['follow-up-due'],
    })
  })

  it('no-open-task — active lead, sat 5 days, no open task', () => {
    expect(followUpPulse(merge({ openTaskCount: 0, daysInCurrentStatus: 5 }))).toEqual({
      pulse: 'no-open-task',
      label: PULSE_LABELS['no-open-task'],
    })
  })

  it('momentum-cooling — 16d silent + 70% task completion', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: 16, daysInCurrentStatus: 16, taskCompletionRate: 0.7 }))).toEqual({
      pulse: 'momentum-cooling',
      label: PULSE_LABELS['momentum-cooling'],
    })
  })

  it('stalled-early — בטיפול + 9 days in status + low completion', () => {
    expect(followUpPulse(merge({ daysInCurrentStatus: 9, taskCompletionRate: 0.2 }))).toEqual({
      pulse: 'stalled-early',
      label: PULSE_LABELS['stalled-early'],
    })
  })

  it('silent — long-form silence (25 days quiet, low completion)', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: 25, daysInCurrentStatus: 25, taskCompletionRate: 0.2 }))).toEqual({
      pulse: 'silent',
      label: PULSE_LABELS.silent,
    })
  })

  it('silent — never interacted + 35d in status', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: null, daysInCurrentStatus: 35 }))).toEqual({
      pulse: 'silent',
      label: PULSE_LABELS.silent,
    })
  })
})

describe('followUpPulse — frequency discipline (silence is the default)', () => {
  it('healthy active lead, recent interaction, has open task → null', () => {
    expect(followUpPulse(merge({ daysInCurrentStatus: 3 }))).toBeNull()
  })

  it('brand-new lead under 2d with no tasks → null (does NOT trigger no-open-task)', () => {
    expect(
      followUpPulse(merge({ status: 'חדש', daysInCurrentStatus: 0, openTaskCount: 0, daysSinceLastInteraction: null })),
    ).toBeNull()
  })

  it('non-active status without other signals → null', () => {
    // 'ממתין לתשובה' is active per the rule, but with all else healthy → null.
    expect(followUpPulse(merge({ status: 'ממתין לתשובה', daysInCurrentStatus: 3 }))).toBeNull()
  })

  it('momentum-cooling does NOT fire when completion rate is below 0.5', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: 16, daysInCurrentStatus: 16, taskCompletionRate: 0.4 }))).toBeNull()
  })
})

describe('followUpPulse — threshold boundaries (off-by-one defenses)', () => {
  // no-open-task triggers when daysInCurrentStatus > 2.
  it('no-open-task does NOT fire at exactly 2 days', () => {
    expect(followUpPulse(merge({ openTaskCount: 0, daysInCurrentStatus: 2 }))).toBeNull()
  })
  it('no-open-task DOES fire at 3 days', () => {
    expect(followUpPulse(merge({ openTaskCount: 0, daysInCurrentStatus: 3 }))?.pulse).toBe('no-open-task')
  })

  // momentum-cooling triggers at >= 14d silence.
  it('momentum-cooling does NOT fire at 13 days silence', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: 13, taskCompletionRate: 0.7 }))).toBeNull()
  })
  it('momentum-cooling DOES fire at exactly 14 days silence', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: 14, taskCompletionRate: 0.7 }))?.pulse).toBe('momentum-cooling')
  })

  // stalled-early band: [7, 14) days in status, status === בטיפול.
  it('stalled-early does NOT fire at 6 days', () => {
    expect(followUpPulse(merge({ daysInCurrentStatus: 6 }))).toBeNull()
  })
  it('stalled-early DOES fire at exactly 7 days', () => {
    expect(followUpPulse(merge({ daysInCurrentStatus: 7 }))?.pulse).toBe('stalled-early')
  })
  it('stalled-early does NOT fire at 14 days (band excludes upper bound)', () => {
    // At 14d with the default base (no completion-rate help), it falls through
    // to the silent check, which requires >= 21d → null.
    expect(followUpPulse(merge({ daysInCurrentStatus: 14 }))).toBeNull()
  })

  // silent triggers at >= 21d quiet. Completion held below 0.5 so that
  // momentum-cooling does not preempt the silent decision.
  it('silent does NOT fire at 20 days quiet (low completion)', () => {
    expect(
      followUpPulse(merge({ daysSinceLastInteraction: 20, taskCompletionRate: 0.2 })),
    ).toBeNull()
  })
  it('silent DOES fire at exactly 21 days quiet (low completion)', () => {
    expect(
      followUpPulse(merge({ daysSinceLastInteraction: 21, taskCompletionRate: 0.2 }))?.pulse,
    ).toBe('silent')
  })

  // silent (no-interaction-ever variant) triggers at >= 30d in status.
  it('silent (no-interaction) does NOT fire at 29 days in status', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: null, daysInCurrentStatus: 29 }))).toBeNull()
  })
  it('silent (no-interaction) DOES fire at exactly 30 days in status', () => {
    expect(followUpPulse(merge({ daysSinceLastInteraction: null, daysInCurrentStatus: 30 }))?.pulse).toBe('silent')
  })
})

describe('followUpPulse — priority ordering between competing conditions', () => {
  it('overdue beats due-today', () => {
    expect(followUpPulse(merge({ overdueTaskCount: 1, dueTodayTaskCount: 1 }))?.pulse).toBe('follow-up-overdue')
  })

  it('overdue beats no-open-task even when no other open tasks exist', () => {
    expect(followUpPulse(merge({ overdueTaskCount: 1, openTaskCount: 0, daysInCurrentStatus: 30 }))?.pulse).toBe(
      'follow-up-overdue',
    )
  })

  it('due-today beats no-open-task', () => {
    expect(followUpPulse(merge({ dueTodayTaskCount: 1, openTaskCount: 1, daysInCurrentStatus: 5 }))?.pulse).toBe('follow-up-due')
  })

  it('no-open-task beats momentum-cooling', () => {
    expect(
      followUpPulse(
        merge({
          openTaskCount: 0,
          daysInCurrentStatus: 16,
          daysSinceLastInteraction: 16,
          taskCompletionRate: 0.7,
        }),
      )?.pulse,
    ).toBe('no-open-task')
  })

  it('momentum-cooling beats stalled-early in the overlap zone', () => {
    // 14d in status, 14d silent, 70% completion → both could fire; cooling wins.
    expect(followUpPulse(merge({ daysInCurrentStatus: 14, daysSinceLastInteraction: 14, taskCompletionRate: 0.7 }))?.pulse).toBe(
      'momentum-cooling',
    )
  })

  it('stalled-early beats silent in the overlap zone (status ≠ silent yet)', () => {
    // Default base has daysSinceLastInteraction=1, so silent never reaches.
    expect(followUpPulse(merge({ daysInCurrentStatus: 9 }))?.pulse).toBe('stalled-early')
  })
})

describe('followUpPulse — null status handling', () => {
  it('null status is not active — no-open-task does not fire', () => {
    expect(followUpPulse(merge({ status: null, openTaskCount: 0, daysInCurrentStatus: 10 }))).toBeNull()
  })

  it('null status still allows overdue task to win', () => {
    expect(followUpPulse(merge({ status: null, overdueTaskCount: 1 }))?.pulse).toBe('follow-up-overdue')
  })
})

// ─── Persisted (English) vocabulary ─────────────────────────────────────────
// The cases above pin the Hebrew LABELS, which are retained as legacy aliases.
// clients.status actually stores English keys (new | contacted | interested |
// closed | lost), so these pin the values the rule engine really receives.

describe('followUpPulse — persisted English statuses', () => {
  it.each([['closed'], ['lost']])(
    'returns null for %s — even with overdue and due-today tasks',
    (status) => {
      expect(followUpPulse(merge({ status, overdueTaskCount: 5, dueTodayTaskCount: 5 }))).toBeNull()
    },
  )

  it('no-open-task fires for an active English status', () => {
    expect(
      followUpPulse(merge({ status: 'new', openTaskCount: 0, daysInCurrentStatus: 5 }))?.pulse,
    ).toBe('no-open-task')
  })

  it('stalled-early fires for contacted at 9 days in status', () => {
    expect(
      followUpPulse(merge({ status: 'contacted', daysInCurrentStatus: 9, taskCompletionRate: 0.2 }))?.pulse,
    ).toBe('stalled-early')
  })

  it('stalled-early does NOT fire for interested (band is contacted only)', () => {
    expect(
      followUpPulse(merge({ status: 'interested', daysInCurrentStatus: 9, taskCompletionRate: 0.2 })),
    ).toBeNull()
  })
})
