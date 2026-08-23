import { describe, expect, it } from 'vitest'
import { createBudget, DEFAULT_MAX_STEPS, DEFAULT_DEADLINE_MS } from '@/lib/agent/budget'

/**
 * The investigation budget is owned by SocialCRM, never by the model. The model
 * may ask for another step; this decides. Four independent stops, each pinned
 * here: step ceiling, wall-clock deadline, identical repeat call, and two
 * consecutive results that added nothing new.
 *
 * Pure — no clock read, no I/O. `now` is injected so the deadline is testable.
 */

describe('investigation budget — step ceiling', () => {
  it('allows steps up to the ceiling then stops', () => {
    const b = createBudget({ maxSteps: 3, deadlineMs: 60_000, now: () => 0 })
    expect(b.canStep('get_lead', 'a').allowed).toBe(true)
    b.noteResult('r1')
    expect(b.canStep('get_lead', 'b').allowed).toBe(true)
    b.noteResult('r2')
    expect(b.canStep('get_lead', 'c').allowed).toBe(true)
    b.noteResult('r3')

    const fourth = b.canStep('get_lead', 'd')
    expect(fourth.allowed).toBe(false)
    expect(b.reason()).toBe('step_ceiling')
  })

  it('counts only allowed steps', () => {
    const b = createBudget({ maxSteps: 2, deadlineMs: 60_000, now: () => 0 })
    b.canStep('get_lead', 'a')
    expect(b.stepsUsed()).toBe(1)
    b.canStep('get_lead', 'a') // refused repeat — must not consume a step
    expect(b.stepsUsed()).toBe(1)
  })

  it('stays stopped once the ceiling is hit', () => {
    const b = createBudget({ maxSteps: 1, deadlineMs: 60_000, now: () => 0 })
    b.canStep('get_lead', 'a')
    expect(b.canStep('get_lead', 'b').allowed).toBe(false)
    expect(b.canStep('get_conversation', 'z').allowed).toBe(false)
    expect(b.reason()).toBe('step_ceiling')
  })
})

describe('investigation budget — repeat calls', () => {
  it('refuses an identical repeat call', () => {
    const b = createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 })
    expect(b.canStep('get_lead', 'lead:15').allowed).toBe(true)
    b.noteResult('r1')

    const repeat = b.canStep('get_lead', 'lead:15')
    expect(repeat.allowed).toBe(false)
    expect(repeat.allowed === false && repeat.reason).toBe('repeat_call')
  })

  it('a refused repeat is NOT terminal — a different call still proceeds', () => {
    const b = createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 })
    b.canStep('get_lead', 'lead:15')
    b.canStep('get_lead', 'lead:15') // refused
    expect(b.reason()).toBeNull()
    expect(b.canStep('get_lead', 'lead:99').allowed).toBe(true)
  })

  it('the same args on a DIFFERENT tool is not a repeat', () => {
    const b = createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 })
    expect(b.canStep('get_lead', '15').allowed).toBe(true)
    expect(b.canStep('get_conversation', '15').allowed).toBe(true)
  })
})

describe('investigation budget — wall-clock deadline', () => {
  it('stops when the deadline has passed', () => {
    let t = 0
    const b = createBudget({ maxSteps: 6, deadlineMs: 1_000, now: () => t })
    expect(b.canStep('get_lead', 'a').allowed).toBe(true)
    b.noteResult('r1')

    t = 2_000
    expect(b.canStep('get_lead', 'b').allowed).toBe(false)
    expect(b.reason()).toBe('deadline')
  })

  it('the deadline is inclusive — exactly at the limit stops', () => {
    let t = 0
    const b = createBudget({ maxSteps: 6, deadlineMs: 1_000, now: () => t })
    t = 1_000
    expect(b.canStep('get_lead', 'a').allowed).toBe(false)
    expect(b.reason()).toBe('deadline')
  })

  it('deadline beats an unspent step ceiling', () => {
    let t = 0
    const b = createBudget({ maxSteps: 99, deadlineMs: 500, now: () => t })
    t = 600
    expect(b.canStep('get_lead', 'a').allowed).toBe(false)
    expect(b.reason()).toBe('deadline')
  })
})

describe('investigation budget — novelty', () => {
  it('stops after two consecutive results that add nothing new', () => {
    const b = createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 })
    b.canStep('get_lead', 'a')
    b.noteResult('same')
    b.canStep('get_lead', 'b')
    b.noteResult('same')
    b.canStep('get_lead', 'c')
    b.noteResult('same')

    expect(b.canStep('get_lead', 'd').allowed).toBe(false)
    expect(b.reason()).toBe('no_new_information')
  })

  it('a differing result resets the novelty streak', () => {
    const b = createBudget({ maxSteps: 8, deadlineMs: 60_000, now: () => 0 })
    b.canStep('get_lead', 'a')
    b.noteResult('same')
    b.canStep('get_lead', 'b')
    b.noteResult('same')
    b.canStep('get_lead', 'c')
    b.noteResult('DIFFERENT')

    expect(b.canStep('get_lead', 'd').allowed).toBe(true)
    expect(b.reason()).toBeNull()
  })

  it('two identical results are not yet enough to stop', () => {
    const b = createBudget({ maxSteps: 6, deadlineMs: 60_000, now: () => 0 })
    b.canStep('get_lead', 'a')
    b.noteResult('same')
    b.canStep('get_lead', 'b')
    b.noteResult('same')

    expect(b.canStep('get_lead', 'c').allowed).toBe(true)
  })
})

describe('investigation budget — defaults', () => {
  it('exposes the shipped defaults and applies them when unspecified', () => {
    expect(DEFAULT_MAX_STEPS).toBeGreaterThan(0)
    expect(DEFAULT_DEADLINE_MS).toBeGreaterThan(0)

    const b = createBudget()
    expect(b.stepsUsed()).toBe(0)
    expect(b.reason()).toBeNull()
    expect(b.canStep('get_today_state', '').allowed).toBe(true)
  })
})
