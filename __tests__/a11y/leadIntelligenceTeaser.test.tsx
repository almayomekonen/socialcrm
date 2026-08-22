// @vitest-environment jsdom
//
// DON'T HIDE THE VALUE, HIDE THE COST.
//
// An expired customer used to reach the lead page and find the summary card
// simply gone, which taught them the product contained less than it does. It now
// renders a teaser: the real card's shape, blurred, with nothing real behind the
// blur and no AI touched to produce it.
//
// The load-bearing assertions here are the negative ones. The teaser is only
// honest if producing it costs nothing: no `getLeadIntelligence`, no provider,
// no tokens, no cached summary, and nothing derived from the lead.
//
// No DB: runs in the no-DB suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

/** `vi.mock` is hoisted, so the doubles have to be hoisted with it. */
const { requireAgencyUser, getAgencyProductAccess, getLeadIntelligence, proToast } = vi.hoisted(() => ({
  requireAgencyUser: vi.fn(async () => ({ id: 3, agencyId: 7 })),
  getAgencyProductAccess: vi.fn(async () => ({ status: 'TRIAL_EXPIRED', hasAccess: false })),
  getLeadIntelligence: vi.fn(async () => ({
    ok: true as const,
    data: {
      summary: 'דוד ביקש הצעת מחיר לשיפוץ מטבח.',
      keyInsights: ['תקציב עד 40 אלף', 'פנוי לשיחה בערב', 'הגיע מפייסבוק'],
      suggestedNextAction: { title: 'להתקשר היום', reason: 'הליד ביקש הצעה ומחכה לתשובה.' },
      sources: ['שיחות WhatsApp', 'הערות'],
      confidence: 'high',
    },
  })),
  proToast: vi.fn(),
}))

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess }))
vi.mock('@/actions/ai/leadIntelligence', () => ({ getLeadIntelligence }))
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: vi.fn() }))
vi.mock('@/lib/toast', () => ({ proToast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceTeaser from '@/components/ai/LeadIntelligenceTeaser'

/** The card is an async Server Component: resolve it, then render the element. */
async function renderCard(hasAccess: boolean) {
  getAgencyProductAccess.mockResolvedValue(
    (hasAccess ? { status: 'PAID', hasAccess: true } : { status: 'TRIAL_EXPIRED', hasAccess: false }) as never,
  )
  return render(await LeadIntelligenceCard({ leadId: 7 }))
}

beforeEach(() => {
  getLeadIntelligence.mockClear()
  proToast.mockClear()
})
afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * 1. The expired customer sees the value.
 * ------------------------------------------------------------------ */

describe('an expired customer sees the summary card, not an absence', () => {
  it('the card renders instead of disappearing', async () => {
    const { container } = await renderCard(false)
    expect(container.firstChild).not.toBeNull()
    expect(screen.getByText('תקציר חכם')).toBeTruthy()
  })

  it('it is recognisably the same card, with the same chrome', () => {
    render(<LeadIntelligenceTeaser />)
    const card = screen.getByLabelText(/תקציר חכם/).className
    // The real card's shell, character for character.
    for (const cls of ['rounded-lg', 'border', 'border-gray-200', 'bg-white', 'p-5', 'mb-8']) {
      expect(card, cls).toContain(cls)
    }
  })

  it('the capability is named in the customer facing copy', () => {
    render(<LeadIntelligenceTeaser />)
    expect(screen.getByText('התקציר החכם מנתח את הליד ומציע את הצעד הבא.')).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ *
 * 2. Producing it costs nothing. These are the assertions that matter.
 * ------------------------------------------------------------------ */

describe('the teaser costs nothing to produce', () => {
  it('getLeadIntelligence is never executed for an expired customer', async () => {
    await renderCard(false)
    expect(getLeadIntelligence).not.toHaveBeenCalled()
  })

  it('entitlement is resolved BEFORE the AI action is even reachable', () => {
    const src = read('components/ai/LeadIntelligenceCard.tsx')
    const gate = src.indexOf('await getAgencyProductAccess(user.agencyId)')
    const call = src.indexOf('await getLeadIntelligence(leadId)')
    expect(gate).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(call)
  })

  it('the teaser reaches no provider, no token spend and no cache', () => {
    const src = read('components/ai/LeadIntelligenceTeaser.tsx')
    for (const forbidden of [
      'getLeadIntelligence',
      'refreshLeadIntelligence',
      'runStructured',
      'lib/ai/',
      'anthropic',
      'openai',
      'unstable_cache',
      'fetch(',
    ]) {
      expect(src, forbidden).not.toContain(forbidden)
    }
  })

  it('it imports nothing but presentation', () => {
    const imports = read('components/ai/LeadIntelligenceTeaser.tsx')
      .split('\n')
      .filter((l) => l.startsWith('import '))
    expect(imports).toEqual([
      "import { Lightbulb, Sparkles } from 'lucide-react'",
      "import { proToast } from '@/lib/toast'",
    ])
  })

  it('the AI pre provider entitlement check is untouched', () => {
    const router = read('lib/ai/router.ts')
    expect(router.indexOf('const access = await resolveAiAccess')).toBeLessThan(
      router.indexOf('if (!hasAnyProviderConfigured())'),
    )
    expect(read('lib/ai/access.ts')).toContain('getAgencyProductAccess')
  })
})

/* ------------------------------------------------------------------ *
 * 3. Nothing real is behind the blur.
 * ------------------------------------------------------------------ */

describe('what is blurred is not content', () => {
  it('the preview holds no text at all, invented or real', () => {
    render(<LeadIntelligenceTeaser />)
    const preview = document.querySelector('.blur-\\[3px\\]')!
    expect(preview).toBeTruthy()
    expect(preview.textContent).toBe('')
  })

  it('it takes no lead data, because it takes no props', () => {
    const src = read('components/ai/LeadIntelligenceTeaser.tsx')
    expect(src).toContain('export default function LeadIntelligenceTeaser()')
    expect(src).not.toContain('leadId')
  })

  it('it renders identically every time, on every lead', () => {
    const first = render(<LeadIntelligenceTeaser />).container.innerHTML
    cleanup()
    const second = render(<LeadIntelligenceTeaser />).container.innerHTML
    expect(first).toBe(second)
    // Deterministic by construction: no clock, no randomness.
    const src = read('components/ai/LeadIntelligenceTeaser.tsx')
    expect(src).not.toContain('Math.random')
    expect(src).not.toContain('Date.now')
  })

  it('the blurred rows are masked from assistive tech and from copy', () => {
    render(<LeadIntelligenceTeaser />)
    const preview = document.querySelector('.blur-\\[3px\\]')!
    expect(preview.getAttribute('aria-hidden')).toBe('true')
    expect(preview.className).toContain('select-none')
  })

  it('the preview fades into the card rather than being cut off', () => {
    render(<LeadIntelligenceTeaser />)
    expect(document.querySelector('.bg-gradient-to-b')).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ *
 * 4. It is a teaser, not a paywall.
 * ------------------------------------------------------------------ */

describe('it withholds the insight without punishing the customer', () => {
  it('no lock overlay, no grey card, no destructive red', () => {
    const { container } = render(<LeadIntelligenceTeaser />)
    const html = container.innerHTML
    expect(html).not.toMatch(/bg-red|text-error|bg-error|border-error/)
    expect(html).not.toContain('bg-gray-50')
    expect(html).not.toMatch(/inset-0[^"]*z-\d/) // no full cover overlay
    expect(container.querySelector('.bg-white')).toBeTruthy()
  })

  it('the Pro mark wears the subscription tokens', () => {
    render(<LeadIntelligenceTeaser />)
    const cls = screen.getByText('Pro').className
    expect(cls).toContain('bg-warning-bg')
    expect(cls).toContain('border-warning-border')
    expect(cls).toContain('text-warning-text')
  })

  it('it adds no second persistent subscription notice to the page', () => {
    const { container } = render(<LeadIntelligenceTeaser />)
    expect(container.querySelector('[data-testid="subscription-expired-inline"]')).toBeNull()
    expect(read('components/ai/LeadIntelligenceTeaser.tsx')).not.toContain('SubscriptionExpiredState')
    // The page's single standing notice still belongs to the follow up control.
    expect(read('components/leads/FollowUpControl.tsx')).toContain("source='lead_followup'")
  })

  it('the subscription sentence appears only when the customer reaches for it', () => {
    render(<LeadIntelligenceTeaser />)
    expect(screen.queryByText(/המנוי/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'לצפייה בתקציר' }))
    expect(proToast).toHaveBeenCalledTimes(1)
    expect(proToast.mock.calls[0][0]).toMatchObject({
      title: 'התקציר החכם זמין עם Pro',
      body: 'חידוש המנוי יחזיר את התקציר החכם.',
      source: 'lead_intelligence',
    })
  })

  it('it reuses the existing Pro toast and its single billing destination', () => {
    expect(read('components/ai/LeadIntelligenceTeaser.tsx')).toContain("import { proToast } from '@/lib/toast'")
    expect(read('lib/toast.tsx')).toContain('href={upgradeHref(pop.pro.source)}')
    // No second mechanism, no hand rolled URL.
    expect(read('components/ai/LeadIntelligenceTeaser.tsx')).not.toContain('/api/payments/upgrade')
  })
})

/* ------------------------------------------------------------------ *
 * 5. The paying customer is unaffected.
 * ------------------------------------------------------------------ */

describe('an active subscription is completely unchanged', () => {
  it('the real summary still renders, from the real action', async () => {
    await renderCard(true)
    expect(getLeadIntelligence).toHaveBeenCalledWith(7)
    expect(screen.getByText('דוד ביקש הצעת מחיר לשיפוץ מטבח.')).toBeTruthy()
    expect(screen.getByText('להתקשר היום')).toBeTruthy()
  })

  it('the teaser never appears for a paying customer', async () => {
    const { container } = await renderCard(true)
    expect(container.querySelector('[aria-label*="זמין עם Pro"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'לצפייה בתקציר' })).toBeNull()
  })

  it('the refresh control belongs to the real card alone', async () => {
    const { container } = render(<LeadIntelligenceTeaser />)
    expect(container.innerHTML).not.toContain('רענן')
    const src = read('components/ai/LeadIntelligenceCard.tsx')
    const teaserReturn = src.indexOf('return <LeadIntelligenceTeaser />')
    for (const at of [...src.matchAll(/<RefreshLeadIntelligenceButton/g)].map((m) => m.index!)) {
      expect(at).toBeGreaterThan(teaserReturn)
    }
  })

  it('the retry line survives for genuine AI failures', () => {
    expect(read('components/ai/LeadIntelligenceCard.tsx')).toContain('העוזר החכם לא זמין כרגע. נסו שוב בעוד דקה.')
  })

  it('AI off and not allowlisted still render nothing, as before', () => {
    expect(read('components/ai/LeadIntelligenceCard.tsx')).toContain(
      "if (res.reason === 'disabled' || res.reason === 'forbidden') return null",
    )
  })
})

/* ------------------------------------------------------------------ *
 * 6. Nothing moved from the server to the client.
 * ------------------------------------------------------------------ */

describe('no server guard was weakened to build this', () => {
  it('the gate that decides the teaser runs on the server', () => {
    const src = read('components/ai/LeadIntelligenceCard.tsx')
    expect(src).not.toContain("'use client'")
    expect(src).toContain('await requireAgencyUser()')
    expect(src).toContain('await getAgencyProductAccess(user.agencyId)')
    // The client component is presentation only and decides nothing.
    expect(read('components/ai/LeadIntelligenceTeaser.tsx')).not.toContain('useAccessDenied')
  })

  it('the canonical resolver is still the single source of entitlement', () => {
    expect(read('lib/access/productAccess.ts')).toContain('export const getAgencyProductAccess')
    expect(read('lib/requireUser.ts')).toContain('export async function requireProductAccess')
  })

  it.each([
    ['AI refresh', 'actions/ai/leadIntelligenceRefresh.ts'],
    ['outbound WhatsApp', 'actions/whatsapp/sendWhatsappReply.ts'],
    ['meeting create', 'actions/calendar/create.ts'],
  ])('%s still requires product access', (_l, file) => {
    expect(read(file)).toContain('requireProductAccess')
  })

  it('the automation engine gate is intact', () => {
    expect(read('lib/automations/emit.ts')).toContain("blocked: 'no_product_access'")
  })

  it('the notification engine gate is intact', () => {
    const emit = read('lib/notifications/emit.ts')
    expect(emit).toContain('if (!(await deps.entitled(event.agencyId))) {')
    expect(emit).toContain("return { enqueued: false, reason: 'no_product_access' }")
  })
})

/* ------------------------------------------------------------------ *
 * 7. House style.
 * ------------------------------------------------------------------ */

describe('the teaser follows the product rules', () => {
  it('the new copy joins no words with a dash or maqaf', () => {
    for (const line of [
      'תקציר חכם, זמין עם Pro',
      'התקציר החכם מנתח את הליד ומציע את הצעד הבא.',
      'לצפייה בתקציר',
      'התקציר החכם זמין עם Pro',
      'חידוש המנוי יחזיר את התקציר החכם.',
    ]) {
      expect(line, line).not.toMatch(/[-–—־]/)
    }
  })

  it('carries no emoji', () => {
    expect(read('components/ai/LeadIntelligenceTeaser.tsx')).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('the card has an accessible name and its icons are decorative', () => {
    const { container } = render(<LeadIntelligenceTeaser />)
    expect(screen.getByLabelText('תקציר חכם, זמין עם Pro')).toBeTruthy()
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('the only control is a real button, reachable by keyboard', () => {
    render(<LeadIntelligenceTeaser />)
    const btn = screen.getByRole('button', { name: 'לצפייה בתקציר' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.className).toContain('focus-visible:ring-2')
  })

  /**
   * Caught in viewport QA: the CTA measured 34px, below a comfortable tap
   * target, on a card that renders on both the lead page and the inbox aside.
   * It now carries the same geometry as the renewal CTA in
   * SubscriptionExpiredState, which is the same job on the same plan boundary.
   */
  it('the CTA is a comfortable tap target, like every other renewal control', () => {
    render(<LeadIntelligenceTeaser />)
    const btn = screen.getByRole('button', { name: 'לצפייה בתקציר' })
    for (const cls of ['min-h-11', 'inline-flex', 'items-center', 'justify-center']) {
      expect(btn.className, cls).toContain(cls)
    }
    expect(read('components/entitlement/SubscriptionExpiredState.tsx')).toContain('min-h-11')
  })

  it('stays well inside the file size rules', () => {
    expect(read('components/ai/LeadIntelligenceTeaser.tsx').split('\n').length).toBeLessThan(250)
  })
})
