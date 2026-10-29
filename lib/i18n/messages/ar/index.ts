import type { Messages } from '../../translate'
import { shell } from './shell'
import { roles } from './roles'
import { settingsNav } from './settingsNav'
import { language } from './language'
import { common } from './common'
import { today } from './today'
import { leads } from './leads'
import { leadDetail } from './leadDetail'
import { entitlement } from './entitlement'
import { leadTabs } from './leadTabs'
import { inbox } from './inbox'
import { tasks } from './tasks'
import { calendar } from './calendar'

/** Arabic (Modern Standard, Latin digits) — pilot draft; native review is recorded in lib/i18n/review.ts. */
export const ar: Messages = { shell, roles, settingsNav, language, common, today, leads, leadDetail, entitlement, leadTabs, inbox, tasks, calendar }
