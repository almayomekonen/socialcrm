/**
 * THE billing destination, in one place.
 *
 * Every renewal affordance in the product points here: the expired states, the
 * billing card, the manage-plan modal and the Pro toast. It is the EXISTING
 * upgrade route, not a new mechanism — this module only stops the same URL from
 * being spelled out at a dozen call sites, so `source` attribution stays
 * consistent and the destination can never drift apart between surfaces.
 *
 * `source` is analytics attribution on the existing route, nothing more.
 */
export function upgradeHref(source: string): string {
  return `/api/payments/upgrade?source=${encodeURIComponent(source)}`
}
