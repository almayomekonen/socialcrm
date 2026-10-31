import { CATALOGS } from '@/lib/i18n/messages'
import type { MessageKey, Translator } from '@/lib/i18n/translate'

/**
 * Display wording for the sign-in / registration status lines and toasts
 * (Phase F4). The forms keep their messages as the Hebrew sentences they always
 * held — the server actions (`actions/auth.ts`, `actions/agencies.ts`) return
 * Hebrew with no code, and the forms compare against those sentences
 * (`res.msg === 'המשתמש מושהה'`) — so the wording happens only at render: an
 * EXACT Hebrew sentence the catalog knows is shown in the interface language;
 * anything else is shown as received, inside a Hebrew-declared element.
 * Hebrew returns the message untouched.
 */
const KEYS = [
  'auth.server.suspended',
  'auth.server.facebookNoEmail',
  'auth.server.facebookTaken',
  'auth.server.facebookUnavailable',
  'auth.server.sendFailed',
  'auth.server.emailInvalid',
  'auth.server.emailTaken',
  'auth.server.generic',
  'auth.social.failed',
  'auth.magic.sent',
  'auth.magic.linkInvalid',
  'auth.magic.network',
] as const satisfies readonly MessageKey[]

const HE = CATALOGS.he.auth as unknown as Record<string, Record<string, string>>
const BY_SENTENCE = new Map<string, MessageKey>(
  KEYS.map((key) => {
    const [, group, leaf] = key.split('.')
    return [HE[group][leaf], key]
  }),
)

export function authMessageText(message: string, t: Translator): { text: string; known: boolean } {
  if (t.locale === 'he') return { text: message, known: true }
  const key = BY_SENTENCE.get(message)
  return key ? { text: t(key), known: true } : { text: message, known: false }
}
