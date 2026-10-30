/**
 * Admin namespace (Phase E5) — the (admin_settings) pages: the layout's
 * refusal and tab titles (`page`), users / invitations / teams, the campaign
 * editor and task templates (`promos`, `taskTmplts`), quote templates
 * (`quotes`) and the auto-response chrome (`autoResponse`).
 */
import { users, invitations, teams } from './users'
import { promos, taskTmplts } from './promos'
import { quotes } from './quotes'
import { autoResponse } from './autoResponse'

const page = {
  denied: 'אין לך הרשאה לצפות בדף זה',
  title: { group: 'הגדרות אדמין' },
}

export const admin = { page, users, invitations, teams, promos, taskTmplts, quotes, autoResponse } as const
