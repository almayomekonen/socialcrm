// @vitest-environment jsdom
//
// NOT AN ASSERTION SUITE. This file renders the REAL Phase-1 mobile components
// through jsdom and writes the resulting DOM to a static harness page, so
// Playwright can measure actual layout (overflow, clipping, tap-target size) at
// every required viewport against the REAL compiled stylesheet.
//
// Why generate rather than hand-write the harness: hand-authored markup drifts
// from the components it claims to represent, and a viewport QA run against
// drifted markup proves nothing. This dumps what the components actually render.
//
// Skipped unless GENERATE_MOBILE_HARNESS=1, so it never runs in CI or in
// `npm run test:a11y`.

import { describe, test } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {} }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/trial', () => ({
  startTrial: async () => ({ ok: true, started: true }),
  trackWelcomeModalSeen: async () => ({ ok: true }),
}))
vi.mock('@/lib/facebook/pixelEvents', () => ({
  trackStartTrial: () => {},
  trackCompleteRegistration: () => {},
  trackSubscribe: () => {},
  trackPixelEvent: () => {},
}))
vi.mock('@/components/trial/ActivationCelebrationContext', () => ({
  useActivationCelebration: () => ({ markActivated: () => {} }),
}))
// actions/auth pulls the Resend client transitively; the harness only needs a
// reference for the <form action> attribute, never a working sign-out.
vi.mock('@/actions/auth', () => ({ logout: async () => {} }))

const ENABLED = process.env.GENERATE_MOBILE_HARNESS === '1'
const OUT = process.env.MOBILE_HARNESS_OUT || '/tmp/mobile-harness'

describe.skipIf(!ENABLED)('generate mobile viewport harness', () => {
  test('writes one harness page per surface', async () => {
    const WelcomeTrialModal = (await import('@/components/trial/WelcomeTrialModal')).default
    const WorkspaceTeaser = (await import('@/components/trial/WorkspaceTeaser')).default
    const BottomSheet = (await import('@/components/mobile/BottomSheet')).default
    const MobileTabBar = (await import('@/components/mobile/MobileTabBar')).default
    const MobileHeader = (await import('@/components/mobile/MobileHeader')).default
    const MobileListRowMod = await import('@/components/mobile/MobileListRow')
    const MobileListRow = MobileListRowMod.default
    const MobileList = MobileListRowMod.MobileList
    const MobileStickyActions = (await import('@/components/mobile/MobileStickyActions')).default

    fs.mkdirSync(OUT, { recursive: true })

    function dump(name: string, node: React.ReactElement, wrap = (h: string) => h) {
      // cleanup() unmounts React roots properly; clearing innerHTML underneath a
      // mounted portal makes React fail to find its own nodes on the next unmount.
      cleanup()
      render(node)
      // Portalled dialogs live on body, so take the whole body.
      const html = document.body.innerHTML
      const page = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="./app.css"></head><body>${wrap(html)}</body></html>`
      fs.writeFileSync(path.join(OUT, `${name}.html`), page)
    }

    dump('welcome-trial-modal', <WelcomeTrialModal />)
    dump('workspace-teaser', <WorkspaceTeaser />)
    dump(
      'bottom-sheet',
      <BottomSheet open onClose={() => {}} title='סינון לידים'>
        <div className='flex flex-col gap-2'>
          <button className='min-h-11 rounded-md border px-4 text-start'>חדש</button>
          <button className='min-h-11 rounded-md border px-4 text-start'>נוצר קשר</button>
          <button className='min-h-11 rounded-md border px-4 text-start'>מעוניין</button>
        </div>
      </BottomSheet>,
    )
    // ---- Phase 2 surfaces ----
    const MobileWorkspaceShell = (await import('@/components/mobile/MobileWorkspaceShell')).default
    const MobileToday = (await import('@/modules/today/mobile/MobileToday')).default
    const MobileSectionHandoff = (await import('@/components/mobile/MobileSectionHandoff')).default
    const MobileMoreView = (await import('@/components/mobile/MobileMoreView')).default
    const { visibleMoreItems } = await import('@/components/mobile/moreDestinations')

    const row = (i: number) => ({
      id: i,
      name: `דני לוי ${i}`,
      phone: '0540000000',
      reason: i % 2 ? 'מעקב באיחור' : 'ליד חדש מהבוקר',
      href: `/clients/${i}/summary`,
    })
    const model = {
      hero: row(1),
      nextUp: [row(2), row(3)],
      rest: Array.from({ length: 6 }, (_, i) => row(i + 4)),
      remaining: 9,
      restTotal: 24,
      doneToday: 3,
      meetings: 2,
      newLeadsCount: 4,
      source: 'worklist_v1' as const,
    }

    // Today inside the real shell — the actual Phase 2 mobile workspace.
    dump(
      'p2-today',
      <MobileWorkspaceShell notificationCount={3}>
        <MobileToday model={model} />
      </MobileWorkspaceShell>,
    )

    // Long-name / no-phone stress: the row and hero must not overflow.
    dump(
      'p2-today-stress',
      <MobileWorkspaceShell>
        <MobileToday
          model={{
            ...model,
            hero: { id: 1, name: 'אברהם־יצחק בן־שלמה הכהן־רוזנבלט', phone: null, reason: 'ממתין לתשובה שלך מאז שלשום', href: '/clients/1/summary' },
            nextUp: [],
            rest: [{ id: 9, name: 'ישראלה־מרים אבן־חיים־גולדשטיין', phone: null, reason: 'משימה באיחור', href: '/clients/9/summary' }],
          }}
        />
      </MobileWorkspaceShell>,
    )

    // Empty / all-clear state.
    dump(
      'p2-today-clear',
      <MobileWorkspaceShell>
        <MobileToday model={{ ...model, hero: null, nextUp: [], rest: [], remaining: 0, restTotal: 0 }} />
      </MobileWorkspaceShell>,
    )

    // The Leads tab handoff.
    dump(
      'p2-leads-handoff',
      <MobileWorkspaceShell>
        <MobileSectionHandoff
          icon='image-polaroid-user'
          title='רשימת הלידים מגיעה בקרוב לנייד'
          body='המסך הזה בבנייה. בינתיים, "היום" מציג את הלידים שדורשים טיפול עכשיו — וזו רוב העבודה היומית.'
          action={{ href: '/dashboard' as never, label: 'מה צריך לעשות היום' }}
        />
      </MobileWorkspaceShell>,
    )

    // The More tab.
    dump(
      'p2-more',
      <MobileWorkspaceShell>
        <MobileMoreView name='אלמוג מקונן' email='alamayo274@gmail.com' items={visibleMoreItems({ role: 'ADMIN', inspectorEnabled: true })} />
      </MobileWorkspaceShell>,
    )

    // Lead detail chrome inside the mobile shell — the Phase 2 tap target from
    // Today. `full-bleed` + the 4-tab ClientNav are the two overflow suspects.
    const ClientNav = (await import('@/components/clientPage/ClientNav')).default
    dump(
      'p2-lead-detail-chrome',
      <MobileWorkspaceShell>
        <div>
          <div className='bg-[#e8ecf4] px-12 full-bleed'>
            <div className='overflow-x-auto'>
              <div className='flex min-w-max items-center justify-between gap-8 py-2.5 font-medium'>
                <p className='max-w-[14rem] truncate font-bold'>דני לוי</p>
                <span className='h-8 w-40 rounded-full bg-white' />
              </div>
            </div>
          </div>
          <ClientNav id={1} />
          <div className='p-4'>תוכן הליד</div>
        </div>
      </MobileWorkspaceShell>,
    )

    // ---- Phase A: mobile lead list ----
    const LeadListMobile = (await import('@/modules/leads/mobile/LeadListMobile')).default
    const lead = (i: number, over = {}) => ({
      id: i,
      name: i === 3 ? 'אברהם־יצחק בן־שלמה הכהן־רוזנבלט' : `דני לוי ${i}`,
      phone: i === 4 ? null : '054-000-0000',
      waPhone: i === 4 ? null : '972540000000',
      email: `lead${i}@example.com`,
      status: (['new', 'contacted', 'interested', 'closed', 'lost'] as const)[i % 5],
      sourceLabel: 'Facebook Lead Ads',
      sourceChannel: 'facebook' as const,
      nextFollowUpAt: i % 3 === 0 ? new Date(Date.now() - 864e5).toISOString() : null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      nextAction: i % 2 ? 'התקשר עכשיו' : null,
      severity: i % 4 === 0 ? 3 : null,
      isNewBadge: i === 1,
      handlerName: 'אלמוג',
      ...over,
    })
    const NOW = Date.parse('2026-08-13T09:00:00Z')

    dump(
      'pa-leads',
      <MobileWorkspaceShell>
        <LeadListMobile
          rows={Array.from({ length: 8 }, (_, i) => lead(i + 1))}
          filters={{ q: '', status: [] }}
          hasMore
          page={1}
          workspaceEmpty={false}
          nowMs={NOW}
        />
      </MobileWorkspaceShell>,
    )

    dump(
      'pa-leads-filtered',
      <MobileWorkspaceShell>
        <LeadListMobile
          rows={[lead(1), lead(2)]}
          filters={{ q: 'דני', status: ['new', 'contacted'] }}
          hasMore={false}
          page={2}
          workspaceEmpty={false}
          nowMs={NOW}
        />
      </MobileWorkspaceShell>,
    )

    dump(
      'pa-leads-filtered-empty',
      <MobileWorkspaceShell>
        <LeadListMobile
          rows={[]}
          filters={{ q: 'לא קיים', status: ['lost'] }}
          hasMore={false}
          page={1}
          workspaceEmpty={false}
          nowMs={NOW}
        />
      </MobileWorkspaceShell>,
    )

    dump(
      'pa-leads-empty-workspace',
      <MobileWorkspaceShell>
        <LeadListMobile rows={[]} filters={{ q: '', status: [] }} hasMore={false} page={1} workspaceEmpty nowMs={NOW} />
      </MobileWorkspaceShell>,
    )

    // ---- Hardening: שיחות + 5-tab bar + More ----
    const ConversationListMobile = (await import('@/modules/inbox/mobile/ConversationListMobile')).default
    const conv = (i: number, over = {}) => ({
      conversationId: i, leadId: i, channel: 'whatsapp' as const,
      displayName: i === 2 ? 'אברהם־יצחק בן־שלמה הכהן־רוזנבלט' : `שירה פרץ ${i}`,
      leadName: null, leadStatus: 'new', lastMessageAt: new Date(Date.now() - i * 6e5).toISOString(),
      lastDirection: (i % 2 ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      lastMessagePreview: i === 3 ? 'היי, רציתי לשאול על המחיר ועל זמני האספקה שלכם לאזור המרכז' : 'תודה, אחזור אליך',
      unread: i % 3 === 0, attention: null, temperature: null, intent: null, suggestedAction: null, ...over,
    })
    dump(
      'ph-conversations',
      <MobileWorkspaceShell notificationCount={2}>
        <ConversationListMobile items={Array.from({length:7},(_,i)=>conv(i+1))} q='' formatWhen={() => 'לפני 4 דקות'} />
      </MobileWorkspaceShell>,
    )
    dump(
      'ph-conversations-empty',
      <MobileWorkspaceShell>
        <ConversationListMobile items={[]} q='' formatWhen={() => ''} />
      </MobileWorkspaceShell>,
    )
    dump(
      'mobile-shell',
      <div className='flex h-dvh flex-col'>
        <MobileHeader title='דני לוי' subtitle='Facebook Lead Ads' onBack={() => {}} />
        <div className='flex-1 overflow-y-auto'>
          <MobileList>
            {Array.from({ length: 8 }).map((_, i) => (
              <MobileListRow
                key={i}
                onClick={() => {}}
                title={`דני לוי ${i + 1}`}
                subtitle='054-000-0000 · Facebook Lead Ads'
                meta='לפני 2 דקות'
                unread={i === 0}
              />
            ))}
          </MobileList>
        </div>
        <MobileStickyActions aboveTabBar>
          <button className='h-11 flex-1 rounded-md bg-solid px-5 text-white'>הוסף ליד</button>
        </MobileStickyActions>
        <MobileTabBar notificationCount={3} />
      </div>,
    )
  })
})
