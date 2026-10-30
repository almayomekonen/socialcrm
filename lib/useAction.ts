'use client'

import { useState } from 'react'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

/** Recognisable by callers that want to render the locked state instead of a toast. */
export const ENTITLEMENT_ERROR = 'ENTITLEMENT_EXPIRED'

/**
 * Shared Server Action runner.
 *
 * WHY IT NOW KNOWS ABOUT ENTITLEMENT. Every consumer of this hook — leadless
 * conversation actions, comment conversion, task actions, the connect flows —
 * showed "משהו השתבש, נסה שוב" when a Server Action failed. For a lapsed
 * subscription that sentence is wrong twice: nothing is broken, and retrying can
 * never succeed. The audit caught it on `+ צור ליד` inside a conversation.
 *
 * The guard on the server THROWS, and Next masks that as an opaque 500, so the
 * failure itself carries no reason. But the client already knows the entitlement
 * state (seeded once by EntitlementProvider), so the reason can be recovered
 * here — in ONE place — rather than in each of the seven call sites.
 *
 * A failure while access is denied is attributed to the subscription; any other
 * failure keeps the existing generic message, so a genuine bug is still reported
 * as a bug and still offers a retry.
 *
 * `translated` (Phase E6): the caller's screen follows the interface language,
 * so the generic line does too. Off by default — a Hebrew screen keeps Hebrew.
 * Only the shown sentence changes; `error` is still the entitlement CODE when
 * access is denied.
 */
export function useAction({ translated = false }: { translated?: boolean } = {}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const accessDenied = useAccessDenied()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      await fn()
    } catch {
      setError(accessDenied ? ENTITLEMENT_ERROR : t('common.actionFailed'))
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, setError, run, accessDenied }
}
