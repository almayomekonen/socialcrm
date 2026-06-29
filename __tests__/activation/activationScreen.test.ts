import { describe, it, expect } from 'vitest'
import { screenKindFor } from '@/lib/activation/activationState'

/**
 * The renderer is a pure switch on screenKindFor. We test the decision function
 * directly (no jsdom needed). The truth-gate lives here: a subscribing state must
 * NEVER resolve to the success screen.
 */
describe('renderer mapping (truth-gate)', () => {
  it('subscribingPage → working, never completed', () => {
    expect(screenKindFor('subscribingPage')).toBe('working')
    expect(screenKindFor('subscribingPage')).not.toBe('completed')
  })
  it('oauthPending → working', () => {
    expect(screenKindFor('oauthPending')).toBe('working')
  })
  it('activationCompleted → completed', () => {
    expect(screenKindFor('activationCompleted')).toBe('completed')
  })
  it('waitingForActivation → waiting', () => {
    expect(screenKindFor('waitingForActivation')).toBe('waiting')
  })
  it('selectingPage → select', () => {
    expect(screenKindFor('selectingPage')).toBe('select')
  })
  it('failed → retry', () => {
    expect(screenKindFor('failed')).toBe('retry')
  })
})
