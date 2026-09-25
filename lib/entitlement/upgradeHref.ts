/**
 * THE billing destination, in one place.
 *
 * Every renewal affordance in the product points here: the expired states, the
 * billing card, the manage-plan modal, the quota paywall and the Pro toast.
 *
 * It used to be `/api/payments/upgrade`, which built a Grow Payment Link and
 * redirected to it. Payment Links are gone, so this is now the billing screen
 * itself, where a card is saved and the subscription starts. That route still
 * exists and still redirects here, for bookmarks and already-sent emails, but
 * nothing in the product should take the extra hop.
 *
 * `source` is analytics attribution, nothing more.
 */
export function upgradeHref(source: string): string {
  return `/settings/update_payment?source=${encodeURIComponent(source)}`
}
