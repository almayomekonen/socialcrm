import type { Messages } from '../../../translate'
import { category, panel, center, filters, toast } from './chrome'
import { provider, title, body } from './content'

export const notifications: Messages['notifications'] = { category, panel, center, filters, toast, content: { provider, title, body } }
