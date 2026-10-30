/**
 * Admin namespace (Phase E5) — the (admin_settings) pages: the layout's
 * refusal and tab titles (`page`), users / invitations / teams, the campaign
 * editor and task templates (`promos`, `taskTmplts`), quote templates
 * (`quotes`) and the auto-response chrome (`autoResponse`); Phase E5b: the
 * automations workspace (`automations`), the sheet (`automationSheet`), the
 * catalog's words by code (`automationCatalog`), the template gallery
 * (`automationTemplates`) and the website connectors (`connections`).
 */
import { users, invitations, teams } from './users'
import { promos, taskTmplts } from './promos'
import { quotes } from './quotes'
import { autoResponse } from './autoResponse'
import { automations } from './automations'
import { automationSheet } from './automationSheet'
import { automationCatalog } from './automationCatalog'
import { automationTemplates } from './automationTemplates'
import { connections } from './connections'

const page = {
  denied: 'אין לך הרשאה לצפות בדף זה',
  title: { group: 'הגדרות אדמין' },
}

export const admin = { page, users, invitations, teams, promos, taskTmplts, quotes, autoResponse, automations, automationSheet, automationCatalog, automationTemplates, connections } as const
