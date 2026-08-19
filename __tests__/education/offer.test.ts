import { describe, expect, it } from 'vitest'
import { offerEducationForGuide } from '@/lib/education/offer'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'

const desktop = {
  copilotEnabled: true,
  whatsappConnected: false,
  facebookConnected: false,
  facebookNeedsReconnect: false,
}

function guide(id: string) {
  const g = GUIDE_ENTRIES.find((e) => e.id === id)
  if (!g) throw new Error(id)
  return g
}

describe('offerEducationForGuide', () => {
  it('offers Show me for pipeline, lead, and copilot tours', () => {
    expect(offerEducationForGuide(guide('guide.pipeline'), desktop).educationAction).toBe('open_pipeline_tour')
    expect(offerEducationForGuide(guide('guide.lead'), desktop).educationAction).toBe('open_lead_tour')
    expect(offerEducationForGuide(guide('guide.copilot'), desktop).educationAction).toBe('open_copilot_tour')
    expect(offerEducationForGuide(guide('guide.importLeads'), desktop).educationAction).toBe('open_pipeline_tour')
  })

  it('offers the WhatsApp tour only when WhatsApp is not already connected', () => {
    expect(offerEducationForGuide(guide('guide.connectWhatsapp'), desktop)).toMatchObject({
      educationAction: 'open_whatsapp_tour',
      route: '/settings/integrations?section=whatsapp',
    })
    const connected = offerEducationForGuide(guide('guide.connectWhatsapp'), { ...desktop, whatsappConnected: true })
    expect(connected.educationAction).toBeUndefined()
    expect(connected.route).toBe('/inbox')
    expect(connected.answer).toMatch(/כבר מחובר/)
  })

  it('offers the Facebook tour when disconnected or when reconnect is needed', () => {
    expect(offerEducationForGuide(guide('guide.connectFacebook'), desktop).educationAction).toBe('open_facebook_tour')
    expect(
      offerEducationForGuide(guide('guide.connectFacebook'), {
        ...desktop,
        facebookConnected: true,
        facebookNeedsReconnect: true,
      }).educationAction,
    ).toBe('open_facebook_tour')
    expect(
      offerEducationForGuide(guide('guide.connectFacebook'), { ...desktop, facebookConnected: true }).educationAction,
    ).toBeUndefined()
  })

  it('does not offer the Copilot tour without Copilot entitlement', () => {
    const offered = offerEducationForGuide(guide('guide.copilot'), { ...desktop, copilotEnabled: false })
    expect(offered.educationAction).toBeUndefined()
    expect(offered.answer.length).toBeGreaterThan(0)
  })

  it('does not invent an action for guides without one', () => {
    expect(offerEducationForGuide(guide('guide.calendar'), desktop).educationAction).toBeUndefined()
    expect(
      offerEducationForGuide({ id: 'guide.missingTour', answer: 'Go here.', educationAction: 'open_anything' as never }, desktop)
        .educationAction,
    ).toBeUndefined()
  })
})
