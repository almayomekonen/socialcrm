/**
 * Hebrew — the SOURCE catalog. Every other locale is typed against this shape.
 *
 * One file per namespace (`<namespace>.ts`, each under the 250-line soft limit);
 * keys are `namespace.surface.element`. Strings that existed before i18n are
 * copied byte-for-byte from the components they came from — changing one here
 * changes what every existing customer reads.
 *
 * Translated so far: the desktop shell, settings navigation, the language page
 * and shared defaults (`common`). Everything else is still hard-coded Hebrew —
 * see claude/i18n.md.
 */
import { shell } from './shell'
import { roles } from './roles'
import { settingsNav } from './settingsNav'
import { language } from './language'
import { common } from './common'
import { today } from './today'
import { leads } from './leads'
import { leadDetail } from './leadDetail'
import { entitlement } from './entitlement'

export const he = { shell, roles, settingsNav, language, common, today, leads, leadDetail, entitlement } as const
