import ConsentDecisionForm from './ConsentDecisionForm'
import { SCOPE_LABELS_HE, type McpScopeName } from '@/lib/oauth/server/config'

type Props = {
  clientName: string
  /** Host only (e.g. chatgpt.com, claude.ai) — shown so the user sees where access goes. */
  redirectHost: string
  userName: string
  agencyName: string
  scopes: McpScopeName[]
  csrf: string
}

/**
 * The MCP client consent screen (ChatGPT, Claude, …). Every client-specific word
 * comes from the validated clientName in the signed pending request — never from
 * browser input. Card container copied from CalendarConnect so it
 * is the product's existing card, not a new one. The form itself (native POST,
 * hidden csrf + decision, single-submission guard) is ConsentDecisionForm.
 */
export default function ConsentCard({ clientName, redirectHost, userName, agencyName, scopes, csrf }: Props) {
  return (
    <div className='mx-auto mt-16 max-w-md px-4'>
      <ConsentDecisionForm clientName={clientName} csrf={csrf}>
        <h1 className='text-lg font-bold'>חיבור {clientName} ל-SocialCRM</h1>
        <p className='text-sm text-gray-600'>
          {clientName} · <span className='font-medium text-gray-800'>{redirectHost}</span>
        </p>
        <p className='text-sm text-gray-600'>
          מחובר בתור <span className='font-medium text-gray-800'>{userName}</span>
          {agencyName ? (
            <>
              {' · '}
              <span className='font-medium text-gray-800'>{agencyName}</span>
            </>
          ) : null}
        </p>
        <div>
          <h2 className='text-sm font-bold'>{clientName} יוכל:</h2>
          <ul className='mt-1 list-disc ps-5 text-sm text-gray-700'>
            {scopes.map((s) => (
              <li key={s}>{SCOPE_LABELS_HE[s]}</li>
            ))}
          </ul>
        </div>
        <p className='text-sm text-gray-600'>
          {clientName} לא יקבל מספרי טלפון או כתובות אימייל, לא יוכל לשנות נתונים ולא ישלח הודעות WhatsApp.
        </p>
      </ConsentDecisionForm>
    </div>
  )
}
