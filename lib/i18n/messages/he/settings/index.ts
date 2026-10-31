/**
 * Settings namespace (Phase E4) — the user-settings pages: account pages
 * (`account`), billing and subscription chrome (`payment`), integrations
 * (`integrations`, the connection notices `fb` / `wa` / `waAction` / `metaShown`
 * / `metaSteps`, `templates`, `messenger`). The settings NAVIGATION is
 * `settingsNav` (Phase A) and the language page `language`.
 */
import { account } from './account'
import { payment } from './payment'
import { integrations } from './integrations'
import { fb, wa, waAction, metaShown } from './notices'
import { metaSteps } from './metaSteps'
import { templates } from './templates'
import { messenger } from './messenger'
import { mobile } from './mobile'

export const settings = { account, payment, integrations, fb, wa, waAction, metaShown, metaSteps, templates, messenger, mobile } as const
