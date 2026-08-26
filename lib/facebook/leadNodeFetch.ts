import { LEAD_ATTRIBUTION_GRAPH_FIELDS } from '@/lib/facebook/leadAttribution'

/**
 * One timeout-bounded read of a Meta lead node.
 *
 * Extracted from the webhook route so the recovery worker reads a lead exactly
 * the way ingestion does — same Graph version, same field set, same 6-second
 * ceiling. A second, subtly different implementation is how a retry path drifts
 * from the path it is supposed to be recovering.
 *
 * The route keeps its own retry/timeout ORCHESTRATION (one retry on abort, the
 * widened→minimal field ladder, the 401/403 disconnect branch); only this
 * primitive is shared, so the critical ingestion path is unchanged.
 */

/** Matches the pinned version used across the OAuth callback and ingestion. */
const GRAPH_LEAD_VERSION = 'v19.0'

export const LEAD_FETCH_TIMEOUT_MS = 6000

export async function fetchLeadWithTimeout(
  leadId: string,
  accessToken: string,
  fields: string = LEAD_ATTRIBUTION_GRAPH_FIELDS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LEAD_FETCH_TIMEOUT_MS)
  try {
    return await fetch(`https://graph.facebook.com/${GRAPH_LEAD_VERSION}/${leadId}?fields=${fields}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } finally {
    clearTimeout(timeout)
  }
}
