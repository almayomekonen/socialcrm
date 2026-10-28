import type { Messages } from '../../translate'
import { shell } from './shell'
import { roles } from './roles'
import { settingsNav } from './settingsNav'
import { language } from './language'
import { common } from './common'

/** English — pilot draft; native review is recorded in lib/i18n/review.ts. */
export const en: Messages = { shell, roles, settingsNav, language, common }
