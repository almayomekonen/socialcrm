import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isAgentEnabled } from '@/lib/ai/flags'
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
 * GATED BY THE SAME FLAG AS THE API. `POST /api/ai/agent/stream` already returns
 * 404 for an agency outside `AGENT_AGENCY_IDS`, so without this the page would
 * render, accept a question, and fail on every send — a dead end that looks like
 * a bug rather than a feature that is not on yet. `notFound()` rather than a
 * disabled state: an agency that is not in the rollout has no agent, and saying
 * so with a 404 matches what the route already says.
 *
 * `isAgentEnabled` is the EXISTING mechanism, reused unchanged — absence blocks,
 * because `parseAgencyAllowlist(undefined)` returns an empty list. No new flag.
 */
export default async function AgentPage() {
  const user = await getUser()
  if (!isAgentEnabled(user?.agencyId)) notFound()
  return <AgentWorkspace />
}
