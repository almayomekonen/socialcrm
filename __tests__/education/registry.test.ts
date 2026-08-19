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
  })

  it('keeps every step explanation short and in English', () => {
    const hebrew = /[\u0590-\u05FF]/
    for (const tour of allTours()) {
      for (const step of tour.steps) {
        expect(step.description.length).toBeLessThan(90)
        expect(step.title.length).toBeLessThan(40)
        expect(hebrew.test(step.title)).toBe(false)
        expect(hebrew.test(step.description)).toBe(false)
      }
    }
  })
})
