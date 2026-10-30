/**
 * Performance namespace (Phase E2) — /sum_sales (overview, report tables, ad
 * performance) and /promotion. One file per surface, each under 250 lines.
 */
import { page, nav, overview, report } from './overview'
import { promotion } from './promotion'
import { ads } from './ads'
import { adsIntel } from './adsIntel'
import { adsNotices } from './adsNotices'

export const performance = { page, nav, overview, report, promotion, ads, adsIntel, adsNotices } as const
