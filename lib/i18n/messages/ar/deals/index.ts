/**
 * Deals namespace (Phase E2) — /deals, the deal form, the import dialog and the
 * shared sales filter. One file per surface, each under the 250-line soft limit.
 */
import { status, branch, company, productType, product, action, dateRange, leadSource } from './labels'
import { page, table, group } from './page'
import { form } from './form'
import { importer } from './importer'
import { filter } from './filter'

import type { Messages } from '../../../translate'

export const deals: Messages['deals'] = { status, branch, company, productType, product, action, dateRange, leadSource, page, table, group, form, importer, filter }
