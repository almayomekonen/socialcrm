import { describe, expect, it } from 'vitest'
import { isTourEligible, isSettled, copilotYieldsToPipeline, copilotYieldsToLead } from '@/lib/education/eligibility'
import { getTour } from '@/lib/education/registry'
import type { EligibilityContext, TourDefinition, TourRecord } from '@/lib/education/types'

const desktop: EligibilityContext = {
  surface: 'desktop',
  toursEnabled: true,
  copilotEnabled: true,
  firstLeadActive: false,
  pathname: '/leads',
}

function ctx(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return { ...desktop, ...over }
}

const pipeline = getTour('pipeline') as TourDefinition
const copilot = getTour('copilot') as TourDefinition
const lead = getTour('lead') as TourDefinition
const overview = getTour('overview') as TourDefinition

const dismissed: TourRecord = { version: 1, status: 'dismissed', at: '2026-01-01T00:00:00.000Z' }
const completedV1: TourRecord = { version: 1, status: 'completed', at: '2026-01-01T00:00:00.000Z' }

describe('isSettled', () => {
  it('is unsettled when missing', () => {
    expect(isSettled(undefined, 1)).toBe(false)
  })

  it('is settled after dismiss or complete at the same version', () => {
    expect(isSettled(dismissed, 1)).toBe(true)
    expect(isSettled(completedV1, 1)).toBe(true)
  })

  it('is unsettled when the tour version is newer', () => {
    expect(isSettled(completedV1, 2)).toBe(false)
    expect(isSettled(dismissed, 2)).toBe(false)
  })
})

describe('isTourEligible', () => {
  it('blocks mobile, disabled workspace, and missing copilot entitlement', () => {
    expect(isTourEligible(pipeline, ctx({ surface: 'mobile' }))).toBe(false)
    expect(isTourEligible(pipeline, ctx({ toursEnabled: false }))).toBe(false)
    expect(isTourEligible(copilot, ctx({ copilotEnabled: false }))).toBe(false)
  })

  it('allows pipeline on desktop when unseen', () => {
    expect(isTourEligible(pipeline, ctx())).toBe(true)
  })

  it('does not auto-show a dismissed or completed tour at the current version', () => {
    const dismissedNow: TourRecord = { version: pipeline.version, status: 'dismissed', at: '2026-01-01T00:00:00.000Z' }
    const completedNow: TourRecord = { version: pipeline.version, status: 'completed', at: '2026-01-01T00:00:00.000Z' }
    expect(isTourEligible(pipeline, ctx({ record: dismissedNow }))).toBe(false)
    expect(isTourEligible(pipeline, ctx({ record: completedNow }))).toBe(false)
  })

  it('re-shows the Leads tour after the v2 sequence bump even if v1 was completed', () => {
    expect(pipeline.version).toBe(2)
    expect(isSettled(completedV1, pipeline.version)).toBe(false)
    expect(isTourEligible(pipeline, ctx({ record: completedV1 }))).toBe(true)
    expect(isTourEligible(pipeline, ctx({ record: dismissed }))).toBe(true)
  })

  it('does not auto-start overview or integration tours', () => {
    expect(isTourEligible(overview, ctx())).toBe(false)
    expect(isTourEligible(overview, ctx({ force: true }))).toBe(true)
    const whatsapp = getTour('whatsapp')
    const facebook = getTour('facebook')
    expect(whatsapp && isTourEligible(whatsapp, ctx())).toBe(false)
    expect(facebook && isTourEligible(facebook, ctx())).toBe(false)
    expect(whatsapp && isTourEligible(whatsapp, ctx({ force: true }))).toBe(true)
    expect(whatsapp && isTourEligible(whatsapp, ctx({ force: true, surface: 'mobile' }))).toBe(false)
  })

  it('lets Help replay overview after v2 even though auto stays off', () => {
    const v2 = { version: 2, status: 'completed' as const, at: '2026-01-01T00:00:00.000Z' }
    expect(overview.version).toBe(3)
    expect(isSettled(v2, overview.version)).toBe(false)
    expect(isTourEligible(overview, ctx({ record: v2 }))).toBe(false)
    expect(isTourEligible(overview, ctx({ record: v2, force: true }))).toBe(true)
    expect(isTourEligible(overview, ctx({ record: v2, force: true, surface: 'mobile' }))).toBe(false)
  })

  it('force bypasses dismissed state but not entitlements or first-lead', () => {
    expect(isTourEligible(pipeline, ctx({ record: dismissed, force: true }))).toBe(true)
    expect(isTourEligible(copilot, ctx({ copilotEnabled: false, force: true }))).toBe(false)
    expect(isTourEligible(lead, ctx({ firstLeadActive: true, force: true }))).toBe(false)
  })

  it('blocks the lead tour while the first-lead callout owns the screen', () => {
    expect(isTourEligible(lead, ctx({ pathname: '/clients/9/summary', firstLeadActive: true }))).toBe(false)
    expect(isTourEligible(lead, ctx({ pathname: '/clients/9/summary', firstLeadActive: false }))).toBe(true)
  })
})

describe('stacking', () => {
  it('copilot waits while pipeline is unsettled on /leads', () => {
    expect(copilotYieldsToPipeline('/leads', false)).toBe(true)
    expect(copilotYieldsToPipeline('/leads', true)).toBe(false)
    expect(copilotYieldsToPipeline('/dashboard', false)).toBe(false)
  })

  it('copilot waits on a lead page until the lead tour (or first-lead) is done', () => {
    expect(copilotYieldsToLead('/clients/3/summary', false, false)).toBe(true)
    expect(copilotYieldsToLead('/clients/3/summary', true, false)).toBe(false)
    expect(copilotYieldsToLead('/clients/3/summary', true, true)).toBe(true)
    expect(copilotYieldsToLead('/inbox', false, false)).toBe(false)
  })
})
