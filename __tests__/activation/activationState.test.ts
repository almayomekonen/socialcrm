import { describe, it, expect } from 'vitest'
import {
  initialMachine,
  oauthPendingMachine,
  reducer,
  deriveReturnEvent,
  activationProgress,
  screenKindFor,
  type FacebookPage,
  type ActivationMachine,
} from '@/lib/activation/activationState'

const onePage: FacebookPage[] = [{ id: 'p1', name: 'Salon Dana' }]
const twoPages: FacebookPage[] = [
  { id: 'p1', name: 'Salon Dana' },
  { id: 'p2', name: 'Studio B' },
]

const at = (status: ActivationMachine['status'], partial = {}): ActivationMachine => ({
  status,
  context: { pages: [], selectedPageId: null, connectedPageName: null, errorReason: null, ...partial },
})

describe('activation reducer — durable states only', () => {
  it('initial machine is waitingForActivation', () => {
    expect(initialMachine.status).toBe('waitingForActivation')
  })

  it('RETURN_SUCCEEDED with zero pages → failed (deterministic recovery)', () => {
    const m = reducer(oauthPendingMachine, { type: 'RETURN_SUCCEEDED', pages: [] })
    expect(m.status).toBe('failed')
    expect(m.context.errorReason).toBe('no_pages')
  })

  it('RETURN_SUCCEEDED with one page → subscribingPage, auto-selected', () => {
    const m = reducer(oauthPendingMachine, { type: 'RETURN_SUCCEEDED', pages: onePage })
    expect(m.status).toBe('subscribingPage')
    expect(m.context.selectedPageId).toBe('p1')
    expect(m.context.pages).toEqual(onePage)
  })

  it('RETURN_SUCCEEDED with multiple pages → selectingPage, none selected', () => {
    const m = reducer(oauthPendingMachine, { type: 'RETURN_SUCCEEDED', pages: twoPages })
    expect(m.status).toBe('selectingPage')
    expect(m.context.selectedPageId).toBeNull()
  })

  it('RETURN_CANCELLED → failed with reason', () => {
    const m = reducer(oauthPendingMachine, { type: 'RETURN_CANCELLED', reason: 'denied' })
    expect(m.status).toBe('failed')
    expect(m.context.errorReason).toBe('denied')
  })

  it('PAGE_SELECTED → subscribingPage', () => {
    const m = reducer(at('selectingPage', { pages: twoPages }), { type: 'PAGE_SELECTED', pageId: 'p2' })
    expect(m.status).toBe('subscribingPage')
    expect(m.context.selectedPageId).toBe('p2')
  })

  it('SUBSCRIBE_OK → activationCompleted with connected page name', () => {
    const m = reducer(at('subscribingPage', { pages: onePage, selectedPageId: 'p1' }), {
      type: 'SUBSCRIBE_OK',
      pageName: 'Salon Dana',
    })
    expect(m.status).toBe('activationCompleted')
    expect(m.context.connectedPageName).toBe('Salon Dana')
  })

  it('SUBSCRIBE_FAILED → failed', () => {
    const m = reducer(at('subscribingPage', { pages: onePage, selectedPageId: 'p1' }), {
      type: 'SUBSCRIBE_FAILED',
      reason: 'subscription_failed',
    })
    expect(m.status).toBe('failed')
    expect(m.context.errorReason).toBe('subscription_failed')
  })

  it('failed + RETRY → waitingForActivation with clean context', () => {
    const m = reducer(at('failed', { errorReason: 'denied' }), { type: 'RETRY' })
    expect(m.status).toBe('waitingForActivation')
    expect(m.context.errorReason).toBeNull()
    expect(m.context.pages).toEqual([])
  })

  it('ignores events invalid for the current status (no throw, no change)', () => {
    const m = at('waitingForActivation')
    expect(reducer(m, { type: 'SUBSCRIBE_OK', pageName: 'x' })).toEqual(m)
    const done = at('activationCompleted', { connectedPageName: 'Salon Dana' })
    expect(reducer(done, { type: 'RETRY' })).toEqual(done)
  })
})

describe('deriveReturnEvent', () => {
  it('activation=select → RETURN_SUCCEEDED with injected pages', () => {
    expect(deriveReturnEvent(new URLSearchParams('activation=select'), onePage)).toEqual({
      type: 'RETURN_SUCCEEDED',
      pages: onePage,
    })
  })
  it('activation=error → RETURN_CANCELLED with reason', () => {
    expect(deriveReturnEvent(new URLSearchParams('activation=error&reason=denied'), [])).toEqual({
      type: 'RETURN_CANCELLED',
      reason: 'denied',
    })
  })
  it('no activation param → null (fresh entry)', () => {
    expect(deriveReturnEvent(new URLSearchParams(''), [])).toBeNull()
  })
})

describe('screenKindFor — truth-gate', () => {
  it('subscribingPage maps to working, NEVER completed', () => {
    expect(screenKindFor('subscribingPage')).toBe('working')
  })
  it('activationCompleted maps to completed', () => {
    expect(screenKindFor('activationCompleted')).toBe('completed')
  })
  it('failed maps to retry', () => {
    expect(screenKindFor('failed')).toBe('retry')
  })
})

describe('activationProgress — state-derived, monotonic on the happy path', () => {
  it('increases waiting → subscribing → completed', () => {
    expect(activationProgress('waitingForActivation')).toBeLessThan(activationProgress('subscribingPage'))
    expect(activationProgress('subscribingPage')).toBeLessThan(activationProgress('activationCompleted'))
    expect(activationProgress('activationCompleted')).toBe(1)
  })
})
