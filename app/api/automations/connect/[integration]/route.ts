import { NextResponse } from 'next/server'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { listIntegrations } from '@/lib/automations/catalog/registry'
import { providerFor } from '@/lib/automations/connectors/registry'

/**
 * THE generic provider-hosted connect entry point.
 *
 * `oauth2` and `embedded_signup` both mean "the provider hosts the flow", so
 * the Connections page sends the browser here and this route hands off. One
 * route for every integration, resolved by path segment — the page contains no
 * route table and no branch.
 *
 * An integration whose hand-off is not implemented yet gets an HONEST answer
 * rather than a dead link or a blank page: the button works, and it tells the
 * user plainly that this particular connection is not open yet. Silence would
 * be worse than a "not yet" — the user would think they had done it wrong.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ integration: string }> }) {
  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) return NextResponse.redirect(new URL('/settings/connections', process.env.APP_URL ?? 'http://localhost:3000'))

  const { integration: key } = await ctx.params
  const integration = listIntegrations().find((i) => i.key === key)
  const provider = providerFor(key)

  // Unknown to the catalog, or registered without a connector: both are
  // "there is nothing to hand off to", and both say so.
  if (!integration || !provider) return notReady('החיבור המבוקש אינו קיים.')

  // Provider hand-off is per-integration by nature. The moment an integration
  // implements one, it is reached from here — this file does not change.
  return notReady(`החיבור ל${integration.title} עדיין לא נפתח. נעדכן אתכם ברגע שיהיה זמין.`)
}

function notReady(message: string) {
  return new NextResponse(
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>חיבורים</title></head>` +
      `<body style="font-family:system-ui;padding:2rem;color:#374151">` +
      `<p>${message}</p><p><a href="/settings/connections">חזרה לחיבורים</a></p></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}
