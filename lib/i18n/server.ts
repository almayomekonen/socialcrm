import 'server-only'
import { cache } from 'react'
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

type SessionUser = { id: number; agencyId?: number | null } | null | undefined

/**
 * Request-memoised by PRIMITIVES (React `cache` compares arguments with
 * Object.is), so the layout, the settings layout and the page share one read.
 * Never `'use cache'`: the result is per user, and a cross-request cache keyed
 * wrongly would show one tenant's preference to another.
 */
const loadPilotState = cache(async (userId: number, agencyId: number): Promise<UiLocaleState> => {
  try {
    const prefs = await getUiLocalePrefs(userId, agencyId)
    return { ...resolveUiLocale({ enabled: true, ...prefs }), enabled: true, ...prefs }
  } catch (err) {
    console.error('[i18n] ui locale read failed, using Hebrew', { reason: (err as Error)?.message })
    return HEBREW_STATE
  }
})

/**
 * The effective interface language for this request, computed on the server
 * and handed to the client as data.
 *
 * Takes the session user the caller ALREADY loaded — it never reads the
 * session itself — so outside the rollout this is a pure function: no session
 * read, no query, Hebrew. A failed read (e.g. the migration not yet applied
 * where the flag is on) degrades to Hebrew rather than breaking the workspace.
 */
export async function getUiLocaleState(user: SessionUser): Promise<UiLocaleState> {
  if (!user?.agencyId || !canUseUiLocales(user.agencyId)) return HEBREW_STATE
  return loadPilotState(user.id, user.agencyId)
}

export async function getServerT(user: SessionUser): Promise<Translator> {
  const { locale } = await getUiLocaleState(user)
  return createTranslator(locale, CATALOGS[locale])
}
