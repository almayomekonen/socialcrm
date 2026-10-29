import type { Messages } from '../../../translate'
import { tasks } from './tasks'
import { files, drive } from './files'
import { billing } from './billing'

export const leadTabs: Messages['leadTabs'] = { tasks, files, drive, billing }
