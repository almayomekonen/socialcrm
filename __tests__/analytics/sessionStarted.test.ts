import { readFileSync } from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RecordedEvent = {
  agencyId: number
  userId: number | null
  event: string
  props: Record<string, unknown>
}

const h = vi.hoisted(() => {
  const events: RecordedEvent[] = []
  const raw = vi.fn(async (_sql: string, params: unknown[]) => {
    const [agencyId, userId, event, rawProps] = params as [number, number | null, string, string]
    events.push({ agencyId, userId, event, props: JSON.parse(rawProps) })
  })

  const db = Object.assign(
    (_table: string) => {
      let where: Record<string, unknown> = {}
      let date = ''
      const query = {
        where(next: Record<string, unknown>) {
          where = next
          return query
        },
        whereRaw(_sql: string, bindings: [string]) {
          date = bindings[0]
          return query
        },
        first: async () =>
          events.find(
            (row) =>
              row.userId === where.userId &&
              row.event === where.event &&
              row.props.date === date,
          ),
      }
      return query
    },
    { raw },
  )

  return { events, raw, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))

import { trackSessionStartedOncePerDay } from '@/lib/analytics/track'

const AGENCY = 69
const USER = 298

beforeEach(() => {
  h.events.length = 0
  h.raw.mockClear()
})

describe('session_started', () => {
  it('records the first authenticated workspace entry with the user, agency, day, and surface', async () => {
    await trackSessionStartedOncePerDay({
      agencyId: AGENCY,
      userId: USER,
      surface: 'desktop',
      now: new Date('2026-09-04T09:00:00.000Z'),
    })

    expect(h.events).toEqual([
      {
        agencyId: AGENCY,
        userId: USER,
        event: 'session_started',
        props: { date: '2026-09-04', surface: 'desktop' },
      },
    ])
  })

  it('does not record reloads or navigation again on the same SocialCRM calendar day', async () => {
    await trackSessionStartedOncePerDay({ agencyId: AGENCY, userId: USER, now: new Date('2026-09-04T09:00:00.000Z') })
    await trackSessionStartedOncePerDay({ agencyId: AGENCY, userId: USER, now: new Date('2026-09-04T18:00:00.000Z') })

    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ event: 'session_started', props: { date: '2026-09-04' } })
  })

  it('allows one new session event on the next Asia/Jerusalem calendar day', async () => {
    await trackSessionStartedOncePerDay({ agencyId: AGENCY, userId: USER, now: new Date('2026-09-04T20:30:00.000Z') })
    await trackSessionStartedOncePerDay({ agencyId: AGENCY, userId: USER, now: new Date('2026-09-04T21:30:00.000Z') })

    expect(h.events.map((event) => event.props.date)).toEqual(['2026-09-04', '2026-09-05'])
  })

  it('is scheduled only after the authenticated real-workspace gate, never on auth redirects or the teaser', () => {
    const layout = readFileSync(path.resolve(process.cwd(), 'app/(app)/layout.tsx'), 'utf8')
    const sessionCall = layout.lastIndexOf('trackSessionStartedOncePerDay')
    const unauthenticatedRedirect = layout.indexOf("if (!user) redirect('/api/auth/clear')")
    const onboardingRedirect = layout.indexOf("if (!(await isOnboarded(user.agencyId))) redirect('/activate')")
    const workspaceGate = layout.indexOf("if (!trialExpired && trialStatus !== 'NEVER_STARTED')")

    expect(sessionCall).toBeGreaterThan(unauthenticatedRedirect)
    expect(sessionCall).toBeGreaterThan(onboardingRedirect)
    expect(sessionCall).toBeGreaterThan(workspaceGate)
  })
})
