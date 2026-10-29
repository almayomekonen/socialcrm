/**
 * Lead tabs namespace (Phase C) — `/clients/[clientId]/{tasks,files,billing}`
 * (billing: the list only), one file per tab. Hebrew copied verbatim.
 */
import { tasks } from './tasks'
import { files, drive } from './files'
import { billing } from './billing'

export const leadTabs = { tasks, files, drive, billing } as const
