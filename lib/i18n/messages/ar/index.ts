import type { Messages } from '../../translate'
import { shell } from './shell'
import { roles } from './roles'
import { settingsNav } from './settingsNav'
import { language } from './language'
import { common } from './common'

/** Arabic (Modern Standard, Latin digits) — pilot draft; native review is recorded in lib/i18n/review.ts. */
export const ar: Messages = { shell, roles, settingsNav, language, common }
