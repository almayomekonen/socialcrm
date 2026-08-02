// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import PilotDashboard from '@/components/settings/automations/PilotDashboard'
import type { PilotMetrics } from '@/db/automations/pilotMetrics'

// The internal pilot dashboard (ADR-014). It exists to answer "is the engine
// behaving?" — so the assertions here are about honesty and alerting, not looks.

afterEach(cleanup)

const metrics = (over: Partial<PilotMetrics> = {}): PilotMetrics => ({
  windowDays: 30,
  observation: { wouldSend: 12, sent: 0, skipped: 3, failed: 0 },
  skipReasons: [{ reason: 'no_email', count: 2 }],
  identityFailures: [],
  delivery: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
  bounces: 0,
  blockedAddresses: 0,
  suppressions: { total: 0, unsubscribe: 0, complaint: 0 },
  queue: { pending: 0, processing: 0, dead: 0, oldestPendingAt: null },
  ...over,
})

describe('PilotDashboard', () => {
  it('states the mode plainly so nobody misreads observation as live', () => {
    render(<PilotDashboard metrics={metrics()} mode='log' />)
    expect(screen.getByText(/מצב תצפית — לא נשלחים אימיילים בפועל/)).toBeInTheDocument()
  })

  it('separates would-sends from real sends', () => {
    render(<PilotDashboard metrics={metrics()} mode='log' />)
    expect(screen.getByText('היו נשלחים (תצפית)')).toBeInTheDocument()
    expect(screen.getByText('נשלחו בפועל')).toBeInTheDocument()
  })

  it('translates skip reasons into the same Hebrew the customer sees', () => {
    render(<PilotDashboard metrics={metrics()} mode='log' />)
    expect(screen.getByText('לא נשלח — אין כתובת אימייל לליד')).toBeInTheDocument()
  })

  it('flags identity failures as blocked real sends', () => {
    render(<PilotDashboard metrics={metrics({ identityFailures: [{ problem: 'no_reply_to', count: 2 }] })} mode='live' />)
    expect(screen.getByRole('alert')).toHaveTextContent('שליחה אמיתית שנמנעה')
    expect(screen.getByText(/חסרה כתובת אימייל לתשובות/)).toBeInTheDocument()
  })

  it('escalates a spam complaint to SEV-2 on the page itself', () => {
    render(<PilotDashboard metrics={metrics({ suppressions: { total: 1, unsubscribe: 0, complaint: 1 } })} mode='live' />)
    expect(screen.getByText(/SEV-2/)).toBeInTheDocument()
  })

  it('warns when the queue has stalled beyond two cron cycles', () => {
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    render(<PilotDashboard metrics={metrics({ queue: { pending: 4, processing: 0, dead: 0, oldestPendingAt: stale } })} mode='log' />)
    expect(screen.getByText(/ייתכן שהניקוז אינו פועל/)).toBeInTheDocument()
  })

  it('stays quiet when everything is healthy', () => {
    render(<PilotDashboard metrics={metrics()} mode='log' />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('אין כשלי זהות')).toBeInTheDocument()
  })
})
