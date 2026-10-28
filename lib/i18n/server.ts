import 'server-only'
import { cache } from 'react'
import { getUser } from '@/db/auth'
import { getUiLocalePrefs } from '@/db/uiLocale'
import { canUseUiLocales } from '@/lib/flags/uiLocaleFlags'
import { createTranslator, type Translator } from './translate'
import { resolveUiLocale, type ResolvedLocale } from './resolve'
import { CATALOGS } from './messages'

export type UiLocaleState = ResolvedLocale & {
  /** The agency is in the rollout: the language page exists and preferences apply. */
  enabled: boolean
  userLocale: string | null
  agencyLocale: string | null
}

const HEBREW_STATE: UiLocaleState = {
  locale: 'he',
  source: 'default',
  enabled: false,
  userLocale: null,
  agencyLocale: null,
}

/**
 * The effective interface language for THIS request, computed once on the
 * server (request-memoised) and handed to the client as data.
 *
 * Outside the rollout no query runs at all — non-pilot agencies pay nothing and
 * cannot be affected by a stored value. A failed read (for example the
 * migration not yet applied where the flag is on) degrades to Hebrew, the
 * language the user already had, rather than breaking the workspace.
 */
export const getUiLocaleState = cache(async (): Promise<UiLocaleState> => {
  const user = await getUser()
  if (!user?.agencyId || !canUseUiLocales(user.agencyId)) return HEBREW_STATE
  try {
    const prefs = await getUiLocalePrefs(user.id, user.agencyId)
    return { ...resolveUiLocale({ enabled: true, ...prefs }), enabled: true, ...prefs }
  } catch (err) {
    console.error('[i18n] ui locale read failed, using Hebrew', { reason: (err as Error)?.message })
    return HEBREW_STATE
  }
})

export async function getServerT(): Promise<Translator> {
  const { locale } = await getUiLocaleState()
  return createTranslator(locale, CATALOGS[locale])
}
