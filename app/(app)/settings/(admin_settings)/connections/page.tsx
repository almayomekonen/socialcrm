import { redirect } from 'next/navigation'

/**
 * `/settings/connections` → the website connector on the merged integrations
 * page.
 *
 * חיבורים is gone as a category. It never held more than one card — the
 * catalog registers exactly one `IntegrationDefinition` (האתר שלי) — while
 * sitting beside a separate אינטגרציות item that held exactly one other card.
 * Two nav entries, one card each, near-synonymous Hebrew names and the same
 * `plug` icon. A website form creates לידים the same way a Facebook lead form
 * does, so it now lives with the other lead sources.
 *
 * DELIBERATELY still inside `(admin_settings)`: that layout enforces ADMIN
 * before this file runs, so a non-admin hitting the old URL keeps getting the
 * same permission response as before rather than being forwarded. The
 * destination section carries its own ADMIN + allowlist gate — see
 * `components/settings/integrations/WebsiteConnection.tsx`.
 *
 * The allowlist check that used to live here is not repeated: it now guards the
 * section itself, so a non-allowlisted agency lands on the page and simply has
 * no website section, exactly as it had no nav item.
 */
export default async function ConnectionsSettingsRedirect() {
  redirect('/settings/integrations?section=website')
}
