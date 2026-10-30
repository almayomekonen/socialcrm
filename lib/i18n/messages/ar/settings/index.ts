import type { Messages } from '../../../translate'
import { account } from './account'
import { payment } from './payment'
import { integrations } from './integrations'
import { fb, wa, waAction, metaShown } from './notices'
import { metaSteps } from './metaSteps'
import { templates } from './templates'
import { messenger } from './messenger'

export const settings: Messages['settings'] = { account, payment, integrations, fb, wa, waAction, metaShown, metaSteps, templates, messenger }
