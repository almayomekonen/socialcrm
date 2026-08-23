/**
 * "May this session render the real workspace while its subscription is
 * expired?" — a QA affordance, and nothing else.
 *
 * WHY THIS IS NOT `isPlatformOwner`. The layout already had exactly one way to
 * see the workspace while expired: be a platform owner. But platform ownership
 * is an admin authority — it also unlocks /admin (every agency on the platform,
 * their trial states and invites) and the cross-tenant support inbox. Using it
 * to let someone test the expired UX would hand a tester visibility into every
 * customer on the platform to solve a rendering problem. These are two
 * different questions and they now have two different answers.
 *
 * WHAT THIS GRANTS. One thing: the `(app)` layout renders the workspace instead
 * of `WorkspaceTeaser`. It grants NO product access. `getAgencyProductAccess`
 * is untouched, so `hasAccess` stays false, `requireProductAccess` still refuses
 * every paid server action, the automation and notification engine gates still
 * refuse, the AI router still refuses, and every expired-UX surface — the AI
 * teaser, the follow-up notice, the Pro toast — renders exactly as it does for
 * any expired customer. That is the entire point: the tester sees precisely
 * what a real expired customer sees, from inside the product.
 *
 * WHAT IT DOES NOT COVER. `NEVER_STARTED` is deliberately excluded. That branch
 * belongs to onboarding, not to expired-state testing, and the layout keeps
 * showing the teaser for it.
 *
 * Configure via EXPIRED_WORKSPACE_PREVIEW_EMAILS (comma-separated). UNSET BY
 * DEFAULT, and an empty list matches nobody — so with no configuration this
 * file changes the behaviour of exactly zero sessions, in production or
 * anywhere else. Deny-by-default, like the owner allowlist it deliberately
 * avoids reusing.
 */

export function expiredWorkspacePreviewEmails(): string[] {
  return (process.env.EXPIRED_WORKSPACE_PREVIEW_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function canPreviewExpiredWorkspace(email?: string | null): boolean {
  if (!email) return false
  const allow = expiredWorkspacePreviewEmails()
  if (allow.length === 0) return false
  return allow.includes(email.trim().toLowerCase())
}
