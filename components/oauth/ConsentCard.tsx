import { Btn } from '@/lib/btns/Btn'
import { SCOPE_LABELS_HE, type McpScopeName } from '@/lib/oauth/server/config'

type Props = {
  clientName: string
  /** Host only (e.g. chatgpt.com) — shown so the user sees where access goes. */
  redirectHost: string
  userName: string
  agencyName: string
  scopes: McpScopeName[]
  csrf: string
}

/**
 * The ChatGPT consent screen. Card container copied from CalendarConnect so it
 * is the product's existing card, not a new one. One form, two labelled submit
 * buttons; the server reads `decision` and the hidden csrf value.
 */
export default function ConsentCard({ clientName, redirectHost, userName, agencyName, scopes, csrf }: Props) {
  return (
    <div className='mx-auto mt-16 max-w-md px-4'>
      <form
        method='post'
        action='/api/oauth/consent'
        className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'
      >
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
        <input type='hidden' name='csrf' value={csrf} />
        <div className='mt-auto flex items-center justify-end gap-3'>
          <Btn as='submit' name='decision' value='deny' lbl='ביטול' variant='outline' icon='xmark' />
          <Btn as='submit' name='decision' value='approve' lbl={`אשר חיבור ל-${clientName}`} icon='check' />
        </div>
      </form>
    </div>
  )
}
