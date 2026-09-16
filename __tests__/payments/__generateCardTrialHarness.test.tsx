// @vitest-environment jsdom
//
// NOT AN ASSERTION SUITE. Renders the REAL card-trial surfaces through jsdom and
// writes the resulting DOM to static pages, so a browser can show the actual
// Hebrew screens against the real compiled stylesheet at desktop and phone
// widths. Everything here is LOCAL AND MOCKED — no Grow call, no database, no
// verification: a screen shown here proves layout and copy, never that the
// provider integration works.
//
// Skipped unless GENERATE_CARD_HARNESS=1, so it never runs in CI.
//
//   npx @tailwindcss/cli -i lib/css/main.css -o /tmp/card-harness/app.css --minify
//   GENERATE_CARD_HARNESS=1 NODE_ENV=test VITEST_NO_DB=1 npx vitest run __tests__/payments/__generateCardTrialHarness.test.tsx

import React from 'react'
import { describe, test, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/actions/paymentMethod', () => ({ startCardSetup: async () => ({ ok: true, url: '#' }), getCardSetupStatus: async () => ({ state: 'verifying', callbackReceived: false, firstChargeAt: null, chargesEnabled: false, sandbox: false }) }))
vi.mock('@/actions/trial', () => ({
  startTrial: async () => ({ ok: true, started: true }),
  trackTrialStartClicked: async () => {},
  trackTrialStartFailed: async () => {},
  trackWelcomeModalSeen: async () => ({ ok: true }),
}))
vi.mock('@/actions/subscription', () => ({ cancelRenewal: async () => ({ ok: true }), resumeRenewal: async () => ({ ok: true }) }))
vi.mock('@/lib/facebook/pixelEvents', () => ({ trackStartTrial: () => {} }))
vi.mock('@/components/trial/ActivationCelebrationContext', () => ({ useActivationCelebration: () => ({ markActivated: () => {} }) }))

const ENABLED = process.env.GENERATE_CARD_HARNESS === '1'
const OUT = process.env.CARD_HARNESS_OUT || '/tmp/card-harness'
const FIRST_CHARGE = new Date('2026-09-23T09:00:00.000Z')

describe.skipIf(!ENABLED)('generate card-trial harness', () => {
  test('writes one page per surface', async () => {
    const WelcomeTrialModal = (await import('@/components/trial/WelcomeTrialModal')).default
    const CardSetupVerifier = (await import('@/components/billing/CardSetupVerifier')).default
    const CardOnFileSummary = (await import('@/components/trial/CardOnFileSummary')).default
    const TrialStatusCard = (await import('@/components/trial/TrialStatusCard')).default
    const TrialExpiredScreen = (await import('@/components/trial/TrialExpiredScreen')).default
    type View = Parameters<typeof CardOnFileSummary>[0]['view']
    const view = (over: Partial<View> = {}): View => ({
      hasActiveCard: true,
      setup: 'confirmed',
      payment: 'none',
      card: { suffix: '3253', brand: 'Visa' },
      cancelAtPeriodEnd: false,
      firstChargeAt: FIRST_CHARGE,
      cardBilled: true,
      ...over,
    })

    fs.mkdirSync(OUT, { recursive: true })
    const dump = async (name: string, node: React.ReactElement) => {
      cleanup()
      render(node)
      await new Promise((r) => setTimeout(r, 30))
      const page = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="./app.css"></head><body class="bg-gray-50">${document.body.innerHTML}</body></html>`
      fs.writeFileSync(path.join(OUT, `${name}.html`), page)
    }

    await dump('1-welcome-card', <WelcomeTrialModal cardSetup={{ defaultFullName: 'ישראל ישראלי', canManageBilling: true, stage: 'setup' }} />)
    await dump('2-success-verifying', <CardSetupVerifier purpose='card_trial' poll={async () => ({ state: 'verifying', callbackReceived: true, firstChargeAt: null, chargesEnabled: false, sandbox: false })} />)
    await dump(
      '3-success-confirmed',
      <CardSetupVerifier purpose='card_trial' poll={async () => ({ state: 'confirmed', callbackReceived: true, firstChargeAt: FIRST_CHARGE.toISOString(), chargesEnabled: false, sandbox: false })} />,
    )
    await dump(
      '4-billing-active',
      <div className='p-6 flex flex-col'>
        <CardOnFileSummary view={view()} />
        <TrialStatusCard startedAt={new Date('2026-09-16T09:00:00Z')} endsAt={FIRST_CHARGE} daysRemaining={5} cardBilled />
      </div>,
    )
    await dump(
      '5-billing-cancelled',
      <div className='p-6 flex flex-col'>
        <CardOnFileSummary view={view({ cancelAtPeriodEnd: true })} />
        <TrialStatusCard startedAt={new Date('2026-09-16T09:00:00Z')} endsAt={FIRST_CHARGE} daysRemaining={5} cardBilled cancelAtPeriodEnd />
      </div>,
    )
    await dump('6-billing-unknown-charge', <div className='p-6'><CardOnFileSummary view={view({ payment: 'unknown' })} /></div>)
    await dump('7-expired-reactivate', <TrialExpiredScreen leadCount={12} cardReactivation={{ reason: 'declined' }} />)
  })
})
