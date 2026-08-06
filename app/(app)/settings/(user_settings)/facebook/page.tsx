import { redirect } from 'next/navigation'

/**
 * `/settings/facebook` → `/settings/integrations`, query string intact.
 *
 * A redirect rather than a deletion, because this URL is not ours to retire:
 *
 *  · The Facebook OAuth callback returns here with `?select=1` (the page
 *    picker) and `?error=<reason>`; the WhatsApp callback with
 *    `?wa_error=<reason>`. Dropping the query would silently swallow the
 *    page-selection step and every connect failure.
 *  · `?section=templates` is a hardcoded absolute link in an announcement email
 *    that has ALREADY been delivered to customers
 *    (`lib/emailAutomations/announcements/whatsappTemplates.ts`). Those inboxes
 *    cannot be edited; the URL has to keep working for as long as the mail does.
 *
 * Section ids are unchanged on the destination, so every forwarded `?section=`
 * opens exactly the section it always did.
 *
 * Temporary (307), not permanent: browsers cache permanent redirects
 * aggressively, and this mapping should stay cheap to revise.
 */
export default async function FacebookSettingsRedirect({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = (searchParams ? await searchParams : {}) || {}

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string') params.append(key, value)
    else if (Array.isArray(value)) for (const v of value) params.append(key, v)
  }

  const qs = params.toString()
  redirect(`/settings/integrations${qs ? `?${qs}` : ''}`)
}
