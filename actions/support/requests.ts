'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireAgencyUser } from '@/lib/requireUser'
import { getDisplayName } from '@/lib/users/displayName'
import { getAgencyPlan } from '@/lib/quota'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import {
  createSupportRequestSystem,
  countRequestsByUserSince,
  getSupportRequestSystem,
} from '@/db/support/requests'
import { appendSupportMessageSystem } from '@/db/support/messages'
import { canReplyToSupportRequest } from '@/lib/support/permissions'
import { validateNewRequest, validateReplyBody } from '@/lib/support/validation'
import { buildDiagnostics } from '@/lib/support/diagnostics'
import { isOverRequestLimit, rateLimitWindowStart } from '@/lib/support/rateLimit'
import { toPersistedContext, type SupportContext } from '@/lib/support/supportContext'
import { coerceSupportKind, type SupportErrorCode } from '@/lib/support/vocabulary'

/**
 * THE SESSION BOUNDARY for first-party product support.
 *
 * This is the only file in the support domain that reads a session. It resolves
 * the tenant from the server-trusted cookie and passes it down; `agencyId` and
 * `userId` are NEVER accepted from the wire, whatever the client sends.
 *
 * `requireAgencyUser` — NOT `requireProductAccess`. Support must stay reachable
 * for an expired trial or a never-activated workspace, which is exactly when a
 * customer most needs to reach us. That exemption is scoped to this file and the
 * (support) route group; it is not a general-purpose bypass, and
 * lib/requireUser.ts names support explicitly alongside activation and billing.
 *
 * Results are typed machine codes, never thrown errors — the house convention.
 * Callers narrow with `'reason' in res`, because under strictNullChecks:false a
 * boolean discriminant does not narrow.
 */

export type SupportActionResult =
  | { ok: true; requestId: number }
  | { ok: false; reason: SupportErrorCode }

export async function createSupportRequestAction(input: {
  subject: string
  category: string
  body: string
  kind?: string
  clientRoute?: string
}): Promise<SupportActionResult> {
  const user = await requireAgencyUser()

  // PHASE 4 SEAM — resolveSupportContext(parseContextRef(input.ctx), user)
  // replaces these two lines. Until then no context is resolved, so nothing is
  // persisted and the body stays required. The client's own `context`, if it
  // sends one, is never read — here or in Phase 4.
  const resolvedContext: SupportContext | null = null
  const hasContext = resolvedContext != null

  const validated = validateNewRequest({
    subject: input.subject,
    category: input.category,
    body: input.body,
    hasContext,
  })
  // `'reason' in validated`, not `!validated.ok`: this repo compiles with
  // strictNullChecks off, under which a boolean discriminant does not narrow.
  // The house convention, and the same reason actions/billing/send.ts tests
  // `'error' in result`.
  if ('reason' in validated) return { ok: false, reason: validated.reason }

  const since = rateLimitWindowStart(new Date())
  const recent = await countRequestsByUserSince(user.id, since)
  if (isOverRequestLimit(recent)) return { ok: false, reason: 'rate_limited' }

  // Diagnostics are built AFTER context resolution, on purpose: a resolver
  // cannot observe clientRoute because it does not exist while resolvers run.
  const hdrs = await headers()
  let trialStatus: string | null = null
  try {
    const trialRow = await getAgencyTrial(user.agencyId)
    if (trialRow) trialStatus = getTrialState(trialRow, new Date()).status
  } catch {
    // Diagnostics are a convenience for whoever answers, never a precondition.
    // Support must not fail because a trial read failed.
    trialStatus = null
  }

  const diagnostics = buildDiagnostics({
    agencyId: user.agencyId,
    userId: user.id,
    plan: await getAgencyPlan(user.agencyId).catch(() => null),
    trialStatus,
    userAgent: hdrs.get('user-agent'),
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    clientRoute: input.clientRoute ?? null,
    now: new Date(),
  })

  const { requestId } = await createSupportRequestSystem({
    agencyId: user.agencyId,
    createdByUserId: user.id,
    requesterName: getDisplayName(user),
    requesterEmail: user.email ?? '',
    subject: validated.value.subject,
    kind: coerceSupportKind(input.kind),
    category: validated.value.category,
    body: validated.value.body,
    // Projected onto the five persisted keys. A resolver returning more cannot
    // leak it: the projection never reads the extra fields.
    context: toPersistedContext(resolvedContext),
    diagnostics,
  })

  revalidatePath('/support')
  revalidatePath('/support/requests')
  return { ok: true, requestId }
}

export async function replyToSupportRequestAction(
  requestId: number,
  body: string,
): Promise<SupportActionResult> {
  const user = await requireAgencyUser()

  const validated = validateReplyBody(body)
  // See the note above: `'reason' in …`, never `!validated.ok`.
  if ('reason' in validated) return { ok: false, reason: validated.reason }

  // Scoped read FIRST: a request id from the wire can only ever address this
  // tenant's rows.
  const request = await getSupportRequestSystem({ agencyId: user.agencyId, requestId })
  if (!request) return { ok: false, reason: 'not_found' }

  // `not_found` rather than `forbidden`, deliberately: a colleague probing ids
  // must not be able to distinguish "exists but not yours" from "does not
  // exist".
  if (!canReplyToSupportRequest(user as any, request)) return { ok: false, reason: 'not_found' }

  const res = await appendSupportMessageSystem({
    agencyId: user.agencyId,
    requestId,
    authorKind: 'customer',
    authorUserId: user.id,
    body: validated.value,
  })
  if ('reason' in res) return { ok: false, reason: 'not_found' }

  revalidatePath(`/support/requests/${requestId}`)
  revalidatePath('/support')
  return { ok: true, requestId }
}
