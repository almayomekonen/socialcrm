// @vitest-environment jsdom
/**
 * The Meta ↔ SocialCRM sections of the ads report, as a business owner sees them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sum_sales/ads',
  useSearchParams: () => new URLSearchParams('account=act_1'),
}))

import AdsIntelligence from '@/modules/adsReporting/components/AdsIntelligence'
import AdsReportShell from '@/modules/adsReporting/components/AdsReportShell'
import AdsCrmOnlySection from '@/modules/adsReporting/components/AdsCrmOnlySection'
import { metricsOf } from '@/lib/facebook/ads/metrics'
import { rowResult } from '@/lib/facebook/ads/results'
import { EMPTY_OUTCOME } from '@/lib/facebook/ads/crmOutcomes'
import type { AdsCampaignRow } from '@/lib/facebook/ads/report'
import type { AdsIntelligenceData } from '@/lib/facebook/ads/intelligence'

afterEach(() => cleanup())

const campaign = (id: string, name: string, row: Record<string, unknown>): AdsCampaignRow => {
  const metrics = metricsOf(row)
  return { id, name, objective: 'OUTCOME_LEADS', status: 'ACTIVE', metrics, result: rowResult('OUTCOME_LEADS', metrics) }
}
const CAMPAIGNS = [
  campaign('111', 'קמפיין א', { spend: '1240', impressions: '50000', actions: [{ action_type: 'lead', value: '43' }] }),
  campaign('222', 'קמפיין ב', { spend: '830', impressions: '30000', actions: [{ action_type: 'lead', value: '31' }] }),
]
const data = (over: Partial<AdsIntelligenceData> = {}): AdsIntelligenceData => ({
  outcomes: {
    campaign: { '111': { ...EMPTY_OUTCOME, captured: 38, contacted: 16, interested: 6, closed: 3, untouched: 13 } },
    adset: {},
    ad: { '901': { ...EMPTY_OUTCOME, captured: 5, contacted: 5 } },
  },
  signals: [{ kind: 'untouched', campaignId: '111', text: '13 לידים מהקמפיין "קמפיין א" עדיין לא טופלו' }],
  topAds: [
    {
      id: '901',
      name: 'מודעת תמונה',
      campaignId: '111',
      campaignName: 'קמפיין א',
      adsetId: null,
      adsetName: null,
      ...((m) => ({ metrics: m, result: rowResult('OUTCOME_LEADS', m) }))(
        metricsOf({ spend: '300', impressions: '1000', actions: [{ action_type: 'lead', value: '10' }] }),
      ),
    },
    {
      id: '902',
      name: 'מודעת וידאו',
      campaignId: '111',
      campaignName: 'קמפיין א',
      adsetId: null,
      adsetName: null,
      ...((m) => ({ metrics: m, result: rowResult('OUTCOME_LEADS', m) }))(metricsOf({ spend: '200', impressions: '800' })),
    },
    {
      id: '903',
      name: 'בלי קריאייטיב',
      campaignId: '222',
      campaignName: 'קמפיין ב',
      adsetId: null,
      adsetName: null,
      ...((m) => ({ metrics: m, result: rowResult('OUTCOME_LEADS', m) }))(metricsOf({ spend: '100' })),
    },
  ],
  creatives: {
    '901': { imageUrl: 'https://cdn/ad.jpg', isVideo: false },
    '902': { imageUrl: 'https://cdn/video-thumb.jpg', isVideo: true },
  },
  freshness: { fetchedAt: '2026-10-06T07:00:00.000Z', stale: false },
  outsideReport: 0,
  ...over,
})

const renderIntel = (d = data()) =>
  render(
    <AdsReportShell rendered={{ account: 'act_1' }} renderedLabel='Main · 30 ימים אחרונים' controls={null}>
      <AdsIntelligence data={d} campaigns={CAMPAIGNS} breakdown={null} currency='ILS' />
    </AdsReportShell>,
  )

describe('Meta and SocialCRM, side by side and labelled apart', () => {
  it('each campaign card carries a "לפי Meta" line and a "ב-SocialCRM" line', () => {
    renderIntel()
    const card = screen.getByRole('heading', { name: 'קמפיין א' }).closest('li')!
    const meta = within(card).getByText('לפי Meta').parentElement!
    const crm = within(card).getByText('ב-SocialCRM').parentElement!
    expect(meta).toHaveTextContent('43')
    expect(meta).toHaveTextContent('עלות לליד (Meta)')
    expect(crm).toHaveTextContent('נקלטו38')
    expect(crm).toHaveTextContent('לא טופלו13')
    expect(crm).toHaveTextContent('נסגרו3')
  })

  it('the CRM-based cost is labelled as such, never as Meta CPL', () => {
    renderIntel()
    const card = screen.getByRole('heading', { name: 'קמפיין א' }).closest('li')!
    expect(within(card).getByText(/עלות לליד שנקלט ב-SocialCRM/)).toBeInTheDocument()
  })

  it('a campaign with no captured leads says so — it does not show zeros for unknown work', () => {
    renderIntel()
    const card = screen.getByRole('heading', { name: 'קמפיין ב' }).closest('li')!
    expect(within(card).getByText('לא נקלטו לידים עם זיהוי של הקמפיין הזה בתקופה.')).toBeInTheDocument()
    expect(within(card).queryByText(/עלות לליד שנקלט/)).not.toBeInTheDocument()
  })

  it("opens each campaign's ad sets through the report (URL keeps the drill-down)", () => {
    renderIntel()
    fireEvent.click(screen.getAllByRole('button', { name: 'קבוצות המודעות בקמפיין' })[0])
    expect(push).toHaveBeenCalledWith(expect.stringContaining('campaign=111'), { scroll: false })
  })
})

describe('signals and freshness', () => {
  it('shows factual signals under "שימו לב", and nothing when there are none', () => {
    const { unmount } = renderIntel()
    expect(screen.getByRole('region', { name: 'שימו לב' })).toHaveTextContent('13 לידים מהקמפיין "קמפיין א" עדיין לא טופלו')
    unmount()
    renderIntel(data({ signals: [] }))
    expect(screen.queryByRole('region', { name: 'שימו לב' })).not.toBeInTheDocument()
  })

  it('stale Meta data says so, with its time', () => {
    renderIntel(data({ freshness: { fetchedAt: '2026-10-06T07:00:00.000Z', stale: true } }))
    expect(screen.getByText(/Meta לא זמינה כרגע/)).toHaveAttribute('role', 'status')
  })

  it('leads from campaigns outside the selected account are counted, not hidden or merged', () => {
    renderIntel(data({ outsideReport: 4 }))
    expect(screen.getByText(/עוד 4 לידים מ-Meta נקלטו/)).toBeInTheDocument()
  })
})

describe('ad creatives', () => {
  it('shows the real creative, a video thumbnail labelled "סרטון", and a fallback when there is none', () => {
    const { container } = renderIntel()
    expect(container.querySelector('[data-ad-id="901"] img')).toHaveAttribute('src', 'https://cdn/ad.jpg')
    const video = container.querySelector('[data-ad-id="902"]')!
    expect(video.querySelector('img')).toHaveAttribute('src', 'https://cdn/video-thumb.jpg')
    expect(within(video as HTMLElement).getByText('סרטון')).toBeInTheDocument()
    const none = container.querySelector('[data-ad-id="903"]')!
    expect(none.querySelector('img')).toBeNull()
    expect(within(none as HTMLElement).getByText('אין תמונה זמינה למודעה')).toBeInTheDocument()
  })

  it('an expired creative URL falls back instead of a broken image', () => {
    const { container } = renderIntel()
    fireEvent.error(container.querySelector('[data-ad-id="901"] img')!)
    expect(
      within(container.querySelector('[data-ad-id="901"]') as HTMLElement).getByText('אין תמונה זמינה למודעה'),
    ).toBeInTheDocument()
  })

  it('ad cards carry their own SocialCRM outcome by ad id', () => {
    const { container } = renderIntel()
    expect(container.querySelector('[data-ad-id="901"]')).toHaveTextContent('נקלטו5')
  })

  it('the creative image keeps its aspect ratio (contained, never stretched)', () => {
    const { container } = renderIntel()
    expect(container.querySelector('[data-ad-id="901"] img')!.className).toContain('object-contain')
  })
})

describe('SocialCRM-only view (no ad account connected)', () => {
  it('shows captured leads per campaign with the exact dates, and no Meta numbers', () => {
    render(
      <AdsCrmOnlySection
        groups={[{ id: '111', name: 'קמפיין א', outcome: { ...EMPTY_OUTCOME, captured: 7, untouched: 2, contacted: 5 } }]}
        period={{ since: '2026-09-06', until: '2026-10-05' }}
      />,
    )
    const section = screen.getByRole('region', { name: 'לידים ממודעות Meta ב-SocialCRM' })
    expect(section).toHaveTextContent('7 לידים שנקלטו')
    expect(section).toHaveTextContent('לא טופלו2')
    expect(within(section).queryByText('לפי Meta')).not.toBeInTheDocument()
  })

  it('renders nothing without attributed leads', () => {
    const { container } = render(<AdsCrmOnlySection groups={[]} period={{ since: '2026-09-06', until: '2026-10-05' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
