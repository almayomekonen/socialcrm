import type { Messages } from '../../../translate'
import { shell, center, kind, requests, newRequest, form, reply, status, category, author, error, search, guides } from './chrome'
import { kb1 } from './kb1'
import { kb2 } from './kb2'

export const support: Messages['support'] = { shell, center, kind, requests, newRequest, form, reply, status, category, author, error, search, guides, kb: { ...kb1, ...kb2 } }
