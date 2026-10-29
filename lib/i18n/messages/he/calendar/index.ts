/**
 * Calendar namespace (Phase E1) — `/calendar` (desktop): the page, the grid,
 * the new / edit / details dialogs and their feedback. One file per surface.
 */
import { page, pro, reschedule, sync } from './page'
import { form, success } from './form'
import { details, outcome, badge } from './details'

export const calendar = { page, pro, reschedule, sync, form, success, details, outcome, badge } as const
