import type { Metadata } from 'next'
import AgentWorkspace from '@/components/agent/AgentWorkspace'

export const metadata: Metadata = {
  title: 'הסוכן שלך',
  description: 'העוזר החכם של העסק שלך',
}

/**
 * "הסוכן שלך" — the AI workspace, as a first-class destination.
 *
 * UI SHELL ONLY. This route reads nothing and calls nothing: no user lookup, no
 * DB query, no AI request. Authentication, onboarding, the trial gate and the
 * entitlement teaser are all decided upstream in `app/(app)/layout.tsx`, which
 * is the same boundary every other page in this group relies on, so there is
 * nothing for this page to re-check and no reason for it to touch the server.
 *
 * The workspace below is a Client Component holding local conversation state
 * seeded from sample data. Nothing here reaches the agent backend that already
 * exists (`app/api/ai/agent`, `lib/agent/**`) — wiring it is the next change,
 * and it is deliberately not this one.
 */
export default function AgentPage() {
  return <AgentWorkspace />
}
