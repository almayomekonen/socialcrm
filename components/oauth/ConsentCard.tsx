import ConsentDecisionForm from './ConsentDecisionForm'
import { SCOPE_LABELS_HE, type McpScopeName } from '@/lib/oauth/server/config'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

type Props = {
  clientName: string
  /** Host only (e.g. chatgpt.com, claude.ai) — shown so the user sees where access goes. */
  redirectHost: string
  userName: string
  agencyName: string
  scopes: McpScopeName[]
  csrf: string
  /** Interface language of the chrome (Phase F4); Hebrew by default. */
  locale?: UiLocale
}

/** Scope lines outside Hebrew, by scope code (Hebrew = `SCOPE_LABELS_HE`, pinned). */
const SCOPE_KEYS: Record<McpScopeName, MessageKey> = {
  'crm.leads.read': 'auth.oauth.scope.leads',
  'crm.conversations.read': 'auth.oauth.scope.conversations',
}

/**
 * The MCP client consent screen (ChatGPT, Claude, …). Every client-specific word
 * comes from the validated clientName in the signed pending request — never from
 * browser input. Card container copied from CalendarConnect so it
 * is the product's existing card, not a new one. The form itself (native POST,
 * hidden csrf + decision, single-submission guard) is ConsentDecisionForm.
 */
export default function ConsentCard({ clientName, redirectHost, userName, agencyName, scopes, csrf, locale = 'he' }: Props) {
  const t = translatorFor(locale)
  const client = { client: clientName }
  return (
    <div className='mx-auto mt-16 max-w-md px-4' {...regionAttrs(locale)}>
      <ConsentDecisionForm clientName={clientName} csrf={csrf}>
        <h1 className='text-lg font-bold'>{t('auth.oauth.heading', client)}</h1>
        <p className='text-sm text-gray-600'>
          {clientName} · <span className='font-medium text-gray-800'>{redirectHost}</span>
        </p>
        <p className='text-sm text-gray-600'>
          {t('auth.oauth.signedInAs')} <span className='font-medium text-gray-800'>{userName}</span>
          {agencyName ? (
            <>
              {' · '}
              <span className='font-medium text-gray-800'>{agencyName}</span>
            </>
          ) : null}
        </p>
        <div>
          <h2 className='text-sm font-bold'>{t('auth.oauth.can', client)}</h2>
          <ul className='mt-1 list-disc ps-5 text-sm text-gray-700'>
            {scopes.map((s) => (
              <li key={s}>{locale === 'he' ? SCOPE_LABELS_HE[s] : t(SCOPE_KEYS[s])}</li>
            ))}
          </ul>
        </div>
        <p className='text-sm text-gray-600'>{t('auth.oauth.notGranted', client)}</p>
      </ConsentDecisionForm>
    </div>
  )
}
