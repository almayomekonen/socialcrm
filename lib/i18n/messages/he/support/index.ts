/**
 * Support centre namespace (Phase F5): `/support/**` — chrome, statuses and
 * categories by code, and the knowledge-base articles (product copy we wrote).
 * Customer request text and our team's replies are data and never live here.
 */
import { shell, center, kind, requests, newRequest, form, reply, status, category, author, error, search, guides } from './chrome'
import { kb1 } from './kb1'
import { kb2 } from './kb2'

export const support = { shell, center, kind, requests, newRequest, form, reply, status, category, author, error, search, guides, kb: { ...kb1, ...kb2 } } as const
