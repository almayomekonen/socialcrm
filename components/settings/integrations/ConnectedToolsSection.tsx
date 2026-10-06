import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import CalendarConnect from '@/components/settings/CalendarConnect'
import AiConnections from '@/components/settings/AiConnections'
import { canUseMcp } from '@/lib/flags/mcpFlags'
import { listAiConnections } from '@/lib/oauth/server/connections'
import { mcpResource } from '@/lib/oauth/server/config'
import { INTEGRATIONS } from './catalog'
import IntegrationCard from './IntegrationCard'

/**
 * כלים מחוברים — external services that enrich לידים but never create one.
 *
 * The dividing line against מקורות לידים, and the reason Google Calendar is no
 * longer a top-level nav item: connecting Calendar or Drive does not, by
 * itself, cause a single ליד to appear. Connecting Facebook, WhatsApp or the
 * website does. Same connect gesture, different job — so they sit in the same
 * page under different headings, and each system appears exactly once.
 *
 * Calendar is hand-rolled because it predates the integrations catalog; every
 * catalog entry renders itself. Both use the same card shell, so the section
 * reads as one grid. When Calendar is eventually described as a catalog
 * descriptor, its bespoke branch here disappears and nothing else changes.
 *
 * OAuth needs nothing from this file: `CalendarConnect` and `IntegrationCard`
 * both build their `returnTo` from `window.location` at click time, so the
 * round-trip returns to whatever page mounted them.
 */

export default async function ConnectedToolsSection({ user }: { user: { id: number; agencyId: number } }) {
  const conn = await getCalendarConnectionByUserId(user.id)
  // AI connections appear only where MCP is enabled for this agency, and list
  // only the session user's own active grants.
  const aiConnections = canUseMcp(user.agencyId) ? await listAiConnections(user.id, user.agencyId) : null
  const mcpUrl = aiConnections ? safeMcpUrl() : null

  const calendarState: 'not_connected' | 'connected' | 'reauth_required' = !conn
    ? 'not_connected'
    : conn.sync_status === 'reauth_required'
      ? 'reauth_required'
      : conn.sync_status === 'disabled'
        ? 'not_connected'
        : 'connected'

  return (
    <div className='grid max-w-3xl grid-cols-2 gap-4 mobile:grid-cols-1'>
      <CalendarConnect state={calendarState} email={conn?.google_email ?? null} lastError={conn?.last_error ?? null} />
      {INTEGRATIONS.map((integration) => (
        <IntegrationCard key={integration.id} integration={integration} />
      ))}
      {/* Last, spanning both columns: Calendar and Drive share the row above it. */}
      {aiConnections && <AiConnections connections={aiConnections} mcpUrl={mcpUrl} />}
    </div>
  )
}

/** The configured MCP endpoint for the "how to connect" steps; never breaks the page if the origin is misconfigured. */
function safeMcpUrl(): string | null {
  try {
    return mcpResource()
  } catch {
    return null
  }
}
