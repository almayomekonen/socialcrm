import { describe, it, expect, vi } from 'vitest'

// classifyGeneralIntent imports the AI router at module load; mock it so the pure
// substring pass can be tested without provider init.
vi.mock('@/lib/ai/router', () => ({ runStructured: vi.fn() }))

import { composeOverviewSentence } from '@/lib/copilot/general/overviewSentence'
import { quickClassifyGeneral } from '@/lib/copilot/general/classifyGeneralIntent'

describe('composeOverviewSentence — one deterministic line, non-zero parts only', () => {
  it('all clear', () => {
    expect(
      composeOverviewSentence({ overdueTasks: 0, meetingsToday: 0, waitingConversations: 0, staleLeads: 0, newLeads: 0 }),
    ).toBe('הכול תחת שליטה — אין משימות דחופות כרגע.')
  })

  it('omits zero counts, keeps order', () => {
    expect(
      composeOverviewSentence({ overdueTasks: 3, meetingsToday: 2, waitingConversations: 0, staleLeads: 5, newLeads: 4 }),
    ).toBe('היום: 3 משימות באיחור · 2 פגישות היום · 5 לידים שלא בקשר · 4 לידים חדשים השבוע.')
  })

  it('single non-zero', () => {
    expect(
      composeOverviewSentence({ overdueTasks: 0, meetingsToday: 0, waitingConversations: 1, staleLeads: 0, newLeads: 0 }),
    ).toBe('היום: 1 שיחות ממתינות.')
  })
})

describe('quickClassifyGeneral — system.overview is now recognized (was unknown)', () => {
  for (const q of ['מה מצב המערכת', 'מה המצב', 'סיכום כללי', 'תמונת מצב', 'מה קורה היום', 'מה חדש במערכת']) {
    it(`"${q}" → system.overview`, () => {
      expect(quickClassifyGeneral(q)).toEqual({ intent: 'system.overview', confidence: 0.95 })
    })
  }

  it('an unrelated question still falls through to unknown', () => {
    expect(quickClassifyGeneral('מה השעה עכשיו')).toEqual({ intent: 'unknown', confidence: 0 })
  })
})
