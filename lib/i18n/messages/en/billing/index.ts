import type { Messages } from '../../../translate'
import { editor } from './editor'
import { issued } from './issued'
import { send } from './send'
import { issuer } from './issuer'
import { paymentMethod, issueError, picker } from './labels'

export const billing: Messages['billing'] = { editor, issued, send, issuer, paymentMethod, issueError, picker }
