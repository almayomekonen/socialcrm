/**
 * v5 completion messages carry `messaging_account_ids` ("Replaces waba_id")
 * plus `phone_number_id` and `is_on_biz_app`; event names are unchanged.
 * v4 `waba_id` messages keep working exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { parseEmbeddedSignupMessage, hasUsableWaba } from '@/lib/facebook/embeddedSignupSession'

const FB = 'https://www.facebook.com'
const v5 = (event: string, data: Record<string, unknown>) => JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data })

describe('v5 session info', () => {
  it('Coexistence completion: the single messaging account id becomes the WABA', () => {
    const s = parseEmbeddedSignupMessage(FB, v5('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', {
      phone_number_id: '106540352242922', is_on_biz_app: true, messaging_account_ids: ['102290129340398'],
      primary_waac_ids: [], page_ids: [], catalog_ids: [], dataset_ids: [], business_id: '506914307656634', instagram_account_ids: [],
    }))
    expect(s).toEqual({ waba_id: '102290129340398', phone_number_id: '106540352242922', onboardingType: 'coexistence' })
    expect(hasUsableWaba(s)).toBe(true)
  })

  it('Cloud API completion (FINISH, is_on_biz_app false)', () => {
    expect(parseEmbeddedSignupMessage(FB, v5('FINISH', { phone_number_id: '1', is_on_biz_app: false, messaging_account_ids: ['2'] }))).toEqual({
      waba_id: '2', phone_number_id: '1', onboardingType: 'cloud_api',
    })
  })

  it('several, none or malformed messaging account ids: no WABA (fails safely as missing details, never a guess)', () => {
    for (const ids of [['2', '3'], [], [42], 'not-a-list', undefined]) {
      const s = parseEmbeddedSignupMessage(FB, v5('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', { phone_number_id: '1', messaging_account_ids: ids }))
      expect(s?.waba_id).toBeUndefined()
      expect(hasUsableWaba(s)).toBe(false)
    }
  })

  it('v4 waba_id is still read, and takes precedence', () => {
    expect(parseEmbeddedSignupMessage(FB, v5('FINISH', { waba_id: 'W4', phone_number_id: 'P4' }))).toEqual({ waba_id: 'W4', phone_number_id: 'P4', onboardingType: 'cloud_api' })
    expect(parseEmbeddedSignupMessage(FB, v5('FINISH', { waba_id: 'W4', messaging_account_ids: ['W5'] }))?.waba_id).toBe('W4')
  })

  it('still ignores other origins and non-completion events', () => {
    expect(parseEmbeddedSignupMessage('https://evilfacebook.com', v5('FINISH', { messaging_account_ids: ['2'] }))).toBeNull()
    expect(parseEmbeddedSignupMessage(FB, v5('CANCEL', { messaging_account_ids: ['2'] }))).toBeNull()
  })
})
