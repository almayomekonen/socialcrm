// @vitest-environment jsdom
/**
 * "הגיע ממודעה ב-Meta" on the lead page: compact, only when Meta said so, read
 * with the session's agency, and linked into the ads report only for someone
 * who can open it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const h = vi.hoisted(() => ({
  user: { id: 7, agencyId: 103, role: 'ADMIN' } as Record<string, unknown> | null,
  attribution: null as Record<string, unknown> | null,
  calls: [] as unknown[][],
  creative: null as unknown,
}))
vi.mock('@/db/auth', () => ({ getUser: async () => h.user }))
vi.mock('@/db/adsCrmOutcomes', () => ({
  getLeadAdAttribution: async (...args: unknown[]) => {
    h.calls.push(args)
    return h.attribution
  },
}))
vi.mock('@/db/adsSnapshots', () => ({ readCreativeForAd: async () => h.creative }))

import LeadAdAttribution from '@/components/clients/LeadAdAttribution'

const ATTR = {
  campaignId: '120200',
  campaignName: 'קמפיין סתיו',
  adsetName: 'תל אביב',
  adId: '555',
  adName: 'וידאו 1',
  formId: '9',
  platform: 'ig',
  isOrganic: false,
}

beforeEach(() => {
  vi.stubEnv('FACEBOOK_ADS_REPORTING_ENABLED', '1')
  vi.stubEnv('FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST', '103')
  h.user = { id: 7, agencyId: 103, role: 'ADMIN' }
  h.attribution = ATTR
  h.calls = []
  h.creative = null
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const renderIt = async () => {
  const el = await LeadAdAttribution({ leadId: 42 })
  return render(<>{el}</>)
}

describe('lead page attribution', () => {
  it('shows campaign · ad set · ad and the platform, reading with the SESSION agency', async () => {
    await renderIt()
    expect(h.calls).toEqual([[103, 42]])
    expect(screen.getByText('הגיע ממודעה ב-Meta · אינסטגרם')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'קמפיין סתיו' })).toHaveAttribute('href', '/sum_sales/ads?campaign=120200')
    expect(screen.getByText(/תל אביב/)).toBeInTheDocument()
    expect(screen.getByText(/וידאו 1/)).toBeInTheDocument()
  })

  it('renders nothing when the lead has no Meta attribution — never a guess', async () => {
    h.attribution = null
    const { container } = await renderIt()
    expect(container).toBeEmptyDOMElement()
  })

  it('an organic form lead says so', async () => {
    h.attribution = { ...ATTR, campaignId: null, campaignName: null, adsetName: null, adId: null, adName: null, isOrganic: true }
    await renderIt()
    expect(screen.getByText(/הגיע מטופס לידים אורגני/)).toBeInTheDocument()
  })

  it('no link for someone who cannot open the ads report', async () => {
    h.user = { id: 8, agencyId: 103, role: 'AGNT' } // a rep (נציג)
    await renderIt()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('קמפיין סתיו')).toBeInTheDocument()
  })

  it('shows the cached creative thumbnail when there is one', async () => {
    h.creative = { payload: { imageUrl: 'https://cdn/ad.jpg', isVideo: false }, fetchedAt: new Date() }
    const { container } = await renderIt()
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn/ad.jpg')
  })
})
