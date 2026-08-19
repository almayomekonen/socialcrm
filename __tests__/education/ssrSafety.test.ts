import { describe, expect, it } from 'vitest'
import { presentSteps } from '@/lib/education/presentSteps'
import { readState, emptyState } from '@/lib/education/storage'
import { acquireTourLock, __resetTourLockForTests } from '@/lib/education/tourLock'
import { requestEducationAction } from '@/lib/education/actions'

describe('SSR safety', () => {
  it('readState does not throw without window and returns empty', () => {
    expect(typeof window).toBe('undefined')
    expect(readState(1)).toEqual(emptyState())
  })

  it('presentSteps default query finds nothing without a document, keeps untargeted steps only', () => {
    const present = presentSteps([
      { element: '[data-edu="x"]', title: 'X', description: 'x' },
      { title: 'Hello', description: 'untargeted' },
    ])
    expect(present.map((s) => s.title)).toEqual(['Hello'])
  })

  it('tour lock is module-local and resettable without DOM', () => {
    __resetTourLockForTests()
    expect(acquireTourLock()).toBe(true)
    expect(acquireTourLock()).toBe(false)
    __resetTourLockForTests()
    expect(acquireTourLock()).toBe(true)
  })

  it('requestEducationAction is a no-op without window', () => {
    expect(requestEducationAction('open_pipeline_tour')).toBe(false)
  })

  it('waitForTourTargets does not poll on the server when targets are missing', async () => {
    const { waitForTourTargets } = await import('@/lib/education/presentSteps')
    await expect(
      waitForTourTargets([{ element: '[data-edu="x"]', title: 'X', description: 'x' }]),
    ).resolves.toBe(false)
  })

  it('waitForLeadsWorkspaceEmpty does not poll or claim empty on the server', async () => {
    const { waitForLeadsWorkspaceEmpty } = await import('@/lib/education/presentSteps')
    await expect(waitForLeadsWorkspaceEmpty()).resolves.toBe(false)
  })
})
