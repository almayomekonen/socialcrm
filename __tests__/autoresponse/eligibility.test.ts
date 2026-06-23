import { describe, it, expect } from 'vitest'
import { decideEligibility } from '@/lib/inbox/autoresponse/eligibility'

const base = {
  masterEnabled: true, channelEnabled: true,
  hasPriorOutbound: false, hasPriorHumanReply: false, hasPriorAutoFirstContact: false,
  withinQuietHours: false, sentTodayForAgency: 0, dailyCap: 200,
}

describe('decideEligibility', () => {
  it('first contact happy path', () => expect(decideEligibility(base)).toEqual({ shouldRespond: true, reason: 'first_contact' }))
  it('master off', () => expect(decideEligibility({ ...base, masterEnabled: false })).toMatchObject({ shouldRespond: false, skipReason: 'feature_off' }))
  it('channel off', () => expect(decideEligibility({ ...base, channelEnabled: false })).toMatchObject({ shouldRespond: false, skipReason: 'channel_off' }))
  it('human replied', () => expect(decideEligibility({ ...base, hasPriorHumanReply: true })).toMatchObject({ shouldRespond: false, skipReason: 'human_replied' }))
  it('quiet hours', () => expect(decideEligibility({ ...base, withinQuietHours: true })).toMatchObject({ shouldRespond: false, skipReason: 'quiet_hours' }))
  it('already auto-acked', () => expect(decideEligibility({ ...base, hasPriorAutoFirstContact: true, hasPriorOutbound: true })).toMatchObject({ shouldRespond: false, skipReason: 'already_first_contact' }))
  it('already has outbound', () => expect(decideEligibility({ ...base, hasPriorOutbound: true })).toMatchObject({ shouldRespond: false, skipReason: 'already_responded' }))
  it('cap hit', () => expect(decideEligibility({ ...base, sentTodayForAgency: 200 })).toMatchObject({ shouldRespond: false, skipReason: 'daily_cap' }))
})
