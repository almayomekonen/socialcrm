import { describe, it, expect } from 'vitest'
import { ACTIVATION_EVENTS } from '@/lib/activation/activationAnalytics'

describe('activation analytics — 5 KPI events only', () => {
  it('declares exactly the five milestones, no noise', () => {
    expect([...ACTIVATION_EVENTS].sort()).toEqual(
      [
        'activation_started',
        'oauth_completed',
        'subscription_completed',
        'subscription_failed',
        'activation_abandoned',
      ].sort(),
    )
  })
})
