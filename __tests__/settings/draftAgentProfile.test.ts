import { describe, expect, it } from 'vitest'
import { withDraftAgentProfile } from '@/lib/inbox/autoresponse/simulate/draftAgentProfile'
import type { AgentProfile } from '@/lib/inbox/autoresponse/conversational/agentProfile'

/** The test chat's unsaved greeting / tone / FAQ laid over the saved agent profile. */

const SAVED: AgentProfile = {
  greeting: 'שלום מהסטודיו',
  persona: 'נעים וסבלני',
  tone: 'formal',
  faq: [{ question: 'יש חניה?', answer: 'כן' }],
  escalationTopics: ['החזר כספי'],
}

describe('withDraftAgentProfile', () => {
  it('no draft fields (every existing caller): the saved profile, untouched', () => {
    expect(withDraftAgentProfile(SAVED, undefined)).toEqual({ profile: SAVED, changed: false })
    expect(withDraftAgentProfile(SAVED, {})).toEqual({ profile: SAVED, changed: false })
    expect(withDraftAgentProfile(null, undefined)).toEqual({ profile: null, changed: false })
  })

  it('only the sent fields replace the saved ones; persona and escalation topics are kept', () => {
    const r = withDraftAgentProfile(SAVED, { greeting: 'היי!' })
    expect(r.changed).toBe(true)
    expect(r.profile).toEqual({ ...SAVED, greeting: 'היי!' })
  })

  it('"nothing" is a value: empty greeting, adapt-to-customer tone, no FAQ', () => {
    expect(withDraftAgentProfile(SAVED, { greeting: '', tone: '', faq: [] }).profile).toEqual({ ...SAVED, greeting: null, tone: null, faq: [] })
  })

  it('a draft equal to the saved values is not reported as a change', () => {
    expect(withDraftAgentProfile(SAVED, { greeting: 'שלום מהסטודיו', tone: 'formal', faq: [{ question: 'יש חניה?', answer: 'כן' }] }).changed).toBe(false)
  })

  it('browser input is normalised like a save: unknown tone dropped, half FAQ dropped, caps applied', () => {
    const r = withDraftAgentProfile(null, {
      greeting: 'x'.repeat(500),
      tone: 'shouty' as never,
      faq: [{ question: 'רק שאלה', answer: '' }, { question: 'שאלה', answer: 'תשובה' }],
    })
    expect(r.profile?.greeting).toHaveLength(200)
    expect(r.profile?.tone).toBeNull()
    expect(r.profile?.faq).toEqual([{ question: 'שאלה', answer: 'תשובה' }])
  })

  it('a draft that empties a profile entirely leaves no profile', () => {
    expect(withDraftAgentProfile({ ...SAVED, persona: null, escalationTopics: [] }, { greeting: '', tone: '', faq: [] })).toEqual({ profile: null, changed: true })
  })
})
