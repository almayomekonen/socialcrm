import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isAgentAvailable } from '@/lib/ai/agentAvailability'
import { layoutProbeRequested } from '@/lib/agent/layoutProbeGate'
import AgentWorkspace from '@/components/agent/AgentWorkspace'
import AgentLayoutProbe from '@/components/agent/AgentLayoutProbe'

export const metadata: Metadata = {
  title: 'הסוכן שלך',
  description: 'העוזר החכם של העסק שלך',
}

/**
 * "הסוכן שלך" — the AI workspace, as a first-class destination.
 *
 * THE PAGE ITSELF IS SYNCHRONOUS, and that is the whole point of its shape.
 *
 * The rollout gate needs `getUser()`, which is request-specific, uncached IO.
 * Awaiting it in the page component made the ENTIRE route uncacheable: under
 * Cache Components there was no prerenderable shell left, so instant navigation
 * had nothing to show and the route logged a prerender blocker on every visit.
 *
 * Moving the await into a child behind `<Suspense>` fixes that without changing
 * what is checked. The page shell prerenders, the boundary streams, and the user
 * lookup happens exactly once per request as before. This is the same two-layer
 * shape `app/(app)/layout.tsx` already uses for the same reason — a sync outer
 * component whose async work lives one level down — so it is the established
 * pattern here rather than a new one.
 *
 * `cache()` is deliberately NOT the fix. The value being read is the identity of
 * the person making this request; caching it across requests is how one rep ends
 * up looking at another's workspace. Suspense defers the read, it does not share
 * the result.
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
export default function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<AgentCanvasFallback />}>
      <AgentGate searchParams={searchParams} />
    </Suspense>
  )
}

/**
 * The rollout check, and the only part of this route that touches the database.
 * Isolated here so its await cannot block the shell above it.
 *
 * TEMPORARY: `?agentdebug=1` adds the real-device layout probe, for platform
 * owners only (deny-by-default email allowlist). Everyone else, and every
 * request without the parameter, gets exactly the page as before.
 */
async function AgentGate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser()
  if (!(await isAgentAvailable(user?.agencyId))) notFound()
  const probe = layoutProbeRequested(await searchParams, user?.email)
  return (
    <>
      <AgentWorkspace />
      {probe && <AgentLayoutProbe build={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'local'} />}
    </>
  )
}

/**
 * The empty shell, and nothing else.
 *
 * It carries the SAME root classes as `AgentWorkspace`, so the boundary resolves
 * into an identically-sized region on the ordinary app background — no flash of
 * a different surface, because there is no longer a different surface.
 * Deliberately empty of content: the composer and intro arrive together a moment
 * later, and half-drawing them would be a worse frame than none.
 */
function AgentCanvasFallback() {
  return (
    <div
      aria-busy='true'
      className='flex min-h-full flex-1 flex-col'
    />
  )
}
