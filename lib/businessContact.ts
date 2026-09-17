/**
 * The business details published on the site, in one place.
 *
 * Grow's site-approval checklist (grow.business/Site_check) requires a contact
 * phone shown clearly on the homepage or a dedicated contact page, and the
 * business address on the site or in the תקנון. Both are rendered from here so
 * the footers and /terms cannot drift apart — an address that differs between
 * two pages is worse than one that appears on neither.
 *
 * EVERY VALUE HERE WAS APPROVED FOR PUBLICATION BY THE OWNER, VERBATIM.
 * Nothing is inferred and nothing is completed: there is deliberately no postal
 * code, no company number and no second address, because none was given. If a
 * field is needed and absent, ask — do not fill it in.
 */

/** As the owner wrote it. Displayed LTR so RTL context cannot reorder it. */
export const BUSINESS_PHONE_DISPLAY = '053-531-7356'

/**
 * E.164 for the dial link. This is a mechanical rewrite of the number above
 * (Israeli national 0 → +972), not an additional detail: it is what makes the
 * link dial correctly from a phone that is not roaming on an Israeli network.
 */
export const BUSINESS_PHONE_HREF = 'tel:+972535317356'

/** As the owner wrote it, including the spelling of the street name. */
export const BUSINESS_ADDRESS = 'רחוב יצחק גרינבויים 12, נתניה'

export const BUSINESS_EMAIL = 'alamayo274@gmail.com'

/** Already published on /terms and in the marketing footer before this change. */
export const BUSINESS_OPERATOR = 'אלמיהו מקונן (עוסק פטור)'
export const BUSINESS_TRADE_NAME = 'SocialCRM'
