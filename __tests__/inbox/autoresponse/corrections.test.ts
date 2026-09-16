import { describe, expect, it } from 'vitest'
import { mergeCognition, mergeQualification } from '@/lib/inbox/autoresponse/qualification'

/**
 * V7 — a customer can correct a detail they already gave.
 *
 * The merge stays fill-empty by default: a re-extraction of the same fact worded
 * slightly differently must not churn a stable value. The exception is an
 * explicit per-turn `corrected` signal, and only the fields it names move.
 */
describe('mergeQualification — default is still fill-empty', () => {
  it('a known value is not replaced by a re-extraction', () => {
    const merged = mergeQualification({ name: 'דנה' }, { name: 'דנה כהן' })
    expect(merged.name).toBe('דנה')
  })

  it('an empty field is filled', () => {
    expect(mergeQualification({}, { name: 'דנה' }).name).toBe('דנה')
  })

  it('an empty incoming value never blanks a known one', () => {
    expect(mergeQualification({ name: 'דנה' }, { name: '' }).name).toBe('דנה')
    expect(mergeQualification({ name: 'דנה' }, {}).name).toBe('דנה')
  })

  it('ignores keys outside the field set', () => {
    const merged = mergeQualification({}, { bogus: 'x' } as never)
    expect(merged).not.toHaveProperty('bogus')
  })
})

describe('V7 — an explicit correction overwrites', () => {
  it('"Dana… sorry, Danit" ends with Danit', () => {
    const merged = mergeQualification({ name: 'דנה' }, { name: 'דנית' }, { corrected: ['name'] })
    expect(merged.name).toBe('דנית')
  })

  it('only the named field moves', () => {
    const merged = mergeQualification(
      { name: 'דנה', need: 'טיפול פנים', urgency: 'השבוע' },
      { name: 'דנית', need: 'טיפול אחר', urgency: 'החודש' },
      { corrected: ['name'] },
    )
    expect(merged.name).toBe('דנית')
    expect(merged.need).toBe('טיפול פנים')
    expect(merged.urgency).toBe('השבוע')
  })

  it('a correction with no new value does not blank the old one', () => {
    const merged = mergeQualification({ name: 'דנה' }, { name: '' }, { corrected: ['name'] })
    expect(merged.name).toBe('דנה')
  })

  it('an empty or absent corrected list changes nothing', () => {
    expect(mergeQualification({ name: 'דנה' }, { name: 'דנית' }, { corrected: [] }).name).toBe('דנה')
    expect(mergeQualification({ name: 'דנה' }, { name: 'דנית' }, {}).name).toBe('דנה')
  })

  it('tolerates junk in the corrected list', () => {
    const merged = mergeQualification({ name: 'דנה' }, { name: 'דנית' }, { corrected: ['', '  ', 'nope'] })
    expect(merged.name).toBe('דנה')
  })
})

describe('cognition facts follow the same rule', () => {
  it('fill-empty by default', () => {
    const merged = mergeCognition({ pain: 'טפסים בנייר' }, { pain: 'משהו אחר' })
    expect(merged?.pain).toBe('טפסים בנייר')
  })

  it('a correction replaces the fact', () => {
    const merged = mergeCognition({ pain: 'טפסים בנייר' }, { pain: 'זמן המתנה' }, ['pain'])
    expect(merged?.pain).toBe('זמן המתנה')
  })

  it('objective and strategy always advance — they are "what we are doing now"', () => {
    const merged = mergeCognition(
      { lastObjective: 'discover_need', salesStrategy: 'discover' },
      { lastObjective: 'advance', salesStrategy: 'explain' },
    )
    expect(merged?.lastObjective).toBe('advance')
    expect(merged?.salesStrategy).toBe('explain')
  })

  it('an invalid objective or strategy is ignored rather than stored', () => {
    const merged = mergeCognition(
      { lastObjective: 'advance' },
      { lastObjective: 'nonsense' as never, salesStrategy: 'nope' as never },
    )
    expect(merged?.lastObjective).toBe('advance')
    expect(merged?.salesStrategy).toBeUndefined()
  })
})

/**
 * V6 — a detail given once is not asked for again. The memory side of that
 * promise: a value, once known, survives every subsequent turn that does not
 * correct it.
 */
describe('V6 — remembered details survive a long conversation', () => {
  it('a fact from turn 1 is still present after twenty turns', () => {
    let state = mergeQualification({}, { name: 'דנה', need: 'טיפול פנים' })
    for (let turn = 0; turn < 20; turn++) {
      state = mergeQualification(state, { urgency: turn === 5 ? 'השבוע' : '' })
    }
    expect(state.name).toBe('דנה')
    expect(state.need).toBe('טיפול פנים')
    expect(state.urgency).toBe('השבוע')
  })
})
