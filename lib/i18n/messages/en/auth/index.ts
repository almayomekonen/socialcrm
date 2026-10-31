import type { Messages } from '../../../translate'
import { signIn, magic, wait, social, register, server } from './signIn'
import { activation, handoff } from './activation'
import { oauth, root } from './oauth'

export const auth: Messages['auth'] = { signIn, magic, wait, social, register, server, activation, handoff, oauth, root }
