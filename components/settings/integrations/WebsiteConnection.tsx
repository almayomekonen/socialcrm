import { integrationOverview } from '@/lib/automations/connectors/overview'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import ConnectionsSettings from '@/components/settings/connections/ConnectionsSettings'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The website / form connectors, as one section of Settings → אינטגרציות.
 *
 * This used to be the whole `/settings/connections` page. Moving it here does
 * NOT relax who may see it, and that is the only subtle thing in this file:
 * the old page sat inside the `(admin_settings)` route group, so its layout
 * enforced ADMIN before the page ever rendered. The merged page lives in
 * `(user_settings)`, which has no such guard — so the guard has to be carried
 * explicitly, here, or an admin-only surface would silently become visible to
 * every נציג.
 *
 * Gate = ADMIN **and** the automations allowlist, exactly the two conditions
 * that governed the old page and its nav item.
 *
 * Everything below the gate is unchanged: `integrationOverview` assembles one
 * view per registered `IntegrationDefinition` and `ConnectionsSettings` draws
 * them. Registering a connector still makes a card appear with no edit here.
 */

type Viewer = { role: string; agencyId: number }

/**
 * Whether the section renders at all — exported so the caller can decide
 * whether to draw the accordion header. A header that opens onto nothing is
 * worse than no header, so visibility is answered once, before rendering.
 */
export function isWebsiteSectionVisible(user: Viewer): boolean {
  return user.role === 'ADMIN' && isAutomationsAgencyAllowlisted(user.agencyId)
}

/** `locale`: the interface language (Phase E5b); Hebrew by default. */
export default async function WebsiteConnection({ user, locale = 'he' }: { user: Viewer; locale?: UiLocale }) {
  if (!isWebsiteSectionVisible(user)) return null

  const views = await integrationOverview(user.agencyId)

  return (
    <>
      <p className='mb-4 text-sm text-gray-600 leading-relaxed' {...regionAttrs(locale)}>
        {translatorFor(locale)('admin.connections.intro')}
      </p>
      <ConnectionsSettings views={views} />
    </>
  )
}
