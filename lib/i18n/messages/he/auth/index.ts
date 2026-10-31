/**
 * Pre-login and public screens namespace (Phase F4): sign-in, registration,
 * `/activate`, the MCP OAuth consent screen, and the root `ChunkReloader`. The
 * language there comes from the `ui_locale` cookie (see claude/i18n.md "Phase F4").
 */
import { signIn, magic, wait, social, register, server } from './signIn'
import { activation, handoff } from './activation'
import { oauth, root } from './oauth'

export const auth = { signIn, magic, wait, social, register, server, activation, handoff, oauth, root } as const
