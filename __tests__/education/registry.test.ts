import { afterEach, describe, expect, it } from 'vitest'
import { acquireTourLock, isTourLockHeld, releaseTourLock, __resetTourLockForTests } from '@/lib/education/tourLock'
import { allTours, getTour, isTourId } from '@/lib/education/registry'

afterEach(() => {
  __resetTourLockForTests()
})

describe('tourLock', () => {
  it('rejects a second acquire until released', () => {
    expect(acquireTourLock()).toBe(true)
    expect(isTourLockHeld()).toBe(true)
    expect(acquireTourLock()).toBe(false)
    releaseTourLock()
    expect(acquireTourLock()).toBe(true)
  })
})

describe('registry', () => {
  it('has the four shipped tours and rejects unknown ids', () => {
    expect(
      allTours()
        .map((t) => t.id)
        .sort(),
    ).toEqual(['copilot', 'facebook', 'lead', 'overview', 'pipeline', 'whatsapp'])
    expect(isTourId('pipeline')).toBe(true)
    expect(isTourId('whatsapp')).toBe(true)
    expect(isTourId('instagram')).toBe(false)
    expect(isTourId(null)).toBe(false)
    expect(getTour('pipeline')?.auto).toBe(true)
    expect(getTour('overview')?.auto).toBe(false)
    expect(getTour('whatsapp')?.auto).toBe(false)
    expect(getTour('facebook')?.auto).toBe(false)
    expect(getTour('copilot')?.requiresCopilot).toBe(true)
    expect(getTour('lead')?.blockedByFirstLead).toBe(true)
    expect(getTour('overview')?.version).toBe(3)
    expect(getTour('overview')?.steps).toHaveLength(13)
    expect(getTour('pipeline')?.version).toBe(2)
    expect(getTour('pipeline')?.steps).toHaveLength(5)
  })

  it('starts the overview tour on היום and ends on a centered close, with no Pipeline', () => {
    const steps = getTour('overview')?.steps ?? []
    expect(steps[0]?.element).toBe('[data-edu="nav-today"]')
    expect(steps[0]?.title).toBe('היום')
    expect(steps[9]?.title).toBe('הסרגל העליון')
    expect(steps[10]?.element).toBe('[data-edu="copilot-trigger"]')
    expect(steps[11]?.element).toBe('[data-edu="notifications"]')
    expect(steps[12]?.element).toBeUndefined()
    expect(steps[12]?.title).toMatch(/זהו/)
    expect(steps.some((s) => s.element === '[data-edu="leads-table"]')).toBe(false)
  })

  it('keeps every step explanation short and in Hebrew', () => {
    const hebrew = /[\u0590-\u05FF]/
    for (const tour of allTours()) {
      for (const step of tour.steps) {
        expect(step.description.length).toBeLessThan(90)
        expect(step.title.length).toBeLessThan(40)
        expect(hebrew.test(step.title)).toBe(true)
        expect(hebrew.test(step.description)).toBe(true)
      }
    }
  })
})
