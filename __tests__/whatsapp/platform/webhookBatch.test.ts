import { describe, expect, it } from 'vitest'
import { isReplayUnprovenAgencyField, platformBatchResponse, splitPlatformWebhook } from '@/lib/whatsapp/platform/webhookBatch'

const PLATFORM = '1000000000001'
const change = (field: string, phoneNumberId: string) => ({ field, value: { metadata: { phone_number_id: phoneNumberId } } })
const entry = (id: string, ...changes: unknown[]) => ({ id, changes })

describe('splitting a delivery', () => {
  it('with no platform number configured, the agency path gets the very same object', () => {
    const body = { entry: [entry('W1', change('messages', PLATFORM))] }
    const split = splitPlatformWebhook(body, null)
    expect(split.platform).toEqual([])
    expect(split.agencyBody).toBe(body)
  })

  it('with no platform change, the agency path gets the very same object', () => {
    const body = { object: 'whatsapp_business_account', entry: [entry('W1', change('messages', 'AGENCY'))] }
    expect(splitPlatformWebhook(body, PLATFORM).agencyBody).toBe(body)
  })

  it('finds platform changes in any entry and any position, and removes only those', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [entry('W1', change('messages', 'AGENCY'), change('messages', PLATFORM)), entry('W2', change('statuses', PLATFORM)), entry('W3', change('smb_message_echoes', 'AGENCY'))],
    }
    const split = splitPlatformWebhook(body, PLATFORM)
    expect(split.platform).toEqual([change('messages', PLATFORM), change('statuses', PLATFORM)])
    expect(split.agencyBody).toEqual({
      object: 'whatsapp_business_account',
      entry: [entry('W1', change('messages', 'AGENCY')), entry('W3', change('smb_message_echoes', 'AGENCY'))],
    })
    expect(split.agencyFields).toEqual(['messages', 'smb_message_echoes'])
  })

  it('a platform-only delivery leaves nothing for the agency path', () => {
    const split = splitPlatformWebhook({ entry: [entry('W1', change('messages', PLATFORM))] }, PLATFORM)
    expect(split.agencyBody).toBeNull()
    expect(split.agencyFields).toEqual([])
  })

  it('matches by phone number id, never by WABA id: a template event for the platform WABA stays agency', () => {
    const body = { entry: [{ id: 'PLATFORM_WABA', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }] }] }
    expect(splitPlatformWebhook(body, PLATFORM).agencyBody).toBe(body)
  })
})

describe('the answer to Meta for a delivery with platform changes', () => {
  it('fields: coexistence and template lifecycle are unproven to replay; messages and statuses are not', () => {
    for (const f of ['smb_message_echoes', 'history', 'smb_app_state_sync', 'message_template_status_update', 'message_template_quality_update']) {
      expect(isReplayUnprovenAgencyField(f)).toBe(true)
    }
    expect(isReplayUnprovenAgencyField('messages')).toBe(false)
  })

  it('delivery statuses arrive under the `messages` field (value.statuses), so a status-only agency part is safe to repeat: 500', () => {
    const body = {
      entry: [
        { id: 'WABA_A', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'AGENCY' }, statuses: [{ id: 'wamid.out', status: 'delivered' }] } }] },
        entry('W2', change('messages', PLATFORM)),
      ],
    }
    const split = splitPlatformWebhook(body, PLATFORM)
    expect(split.agencyFields).toEqual(['messages'])
    expect(platformBatchResponse({ agencyStatus: 200, platformOk: false, agencyFields: split.agencyFields }).status).toBe(500)
  })

  it('platform saved: the agency answer, or 200 when there was no agency part', () => {
    expect(platformBatchResponse({ agencyStatus: 200, platformOk: true, agencyFields: ['messages'] })).toEqual({ status: 200, useAgencyResponse: true, unsavedPlatformEvent: false })
    expect(platformBatchResponse({ agencyStatus: null, platformOk: true, agencyFields: [] })).toEqual({ status: 200, useAgencyResponse: false, unsavedPlatformEvent: false })
  })

  it('platform failed, agency part safe to repeat (or absent): 500 so Meta redelivers', () => {
    expect(platformBatchResponse({ agencyStatus: 200, platformOk: false, agencyFields: ['messages'] }).status).toBe(500)
    expect(platformBatchResponse({ agencyStatus: null, platformOk: false, agencyFields: [] }).status).toBe(500)
  })

  it('platform failed after a successful agency part that is unproven to repeat: 200, flagged as NOT saved', () => {
    for (const f of ['smb_message_echoes', 'history', 'message_template_status_update']) {
      expect(platformBatchResponse({ agencyStatus: 200, platformOk: false, agencyFields: ['messages', f] })).toEqual({ status: 200, useAgencyResponse: true, unsavedPlatformEvent: true })
    }
  })

  it('agency part failed: its own answer stands, whatever happened to the platform part', () => {
    expect(platformBatchResponse({ agencyStatus: 503, platformOk: true, agencyFields: ['history'] })).toEqual({ status: 503, useAgencyResponse: true, unsavedPlatformEvent: false })
    expect(platformBatchResponse({ agencyStatus: 503, platformOk: false, agencyFields: ['history'] })).toEqual({ status: 503, useAgencyResponse: true, unsavedPlatformEvent: false })
  })
})
