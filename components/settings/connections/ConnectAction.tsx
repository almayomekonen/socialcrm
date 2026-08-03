'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import ModalPop from '@/lib/modals/ModalPop'
import { toast } from '@/lib/toast'
import { provisionApiKeyConnection } from '@/actions/automations/connections'
import type { AuthStrategy } from '@/lib/automations/catalog/vocabularies'
import { STRATEGY, errorMessage } from './copy'

/**
 * The connect / reconnect affordance — ONE component, one entry per auth
 * strategy, no integration anywhere.
 *
 * Each strategy in the closed set gets its own generic flow:
 *
 *   oauth2 / embedded_signup → hand off to the provider at a conventional
 *       path derived from the integration key. Both are "the provider hosts
 *       the flow"; only the wording differs, and the wording is data.
 *   api_key → we cannot call them, so they call us: mint a URL and a secret
 *       and show them once.
 *   none → nothing to connect. The button is simply absent.
 *
 * `Record<AuthStrategy, …>` in copy.ts means a new strategy is a compile error
 * here rather than a card that silently offers no way in.
 */

type Props = {
  integrationKey: string
  integrationTitle: string
  auth: AuthStrategy
  /** A healthy connection already exists — the label becomes "reconnect". */
  connected: boolean
  onDone: () => void
}

export default function ConnectAction({ integrationKey, integrationTitle, auth, connected, onDone }: Props) {
  const strategy = STRATEGY[auth]
  const [open, setOpen] = useState(false)

  if (!strategy.needsConnection) return null
  const label = connected ? strategy.reconnect : strategy.connect

  // Provider-hosted flows are a navigation, not a form. The path is derived
  // from the key, so a new integration needs no route table here.
  if (auth === 'oauth2' || auth === 'embedded_signup') {
    return (
      <Btn
        variant={connected ? 'outline' : 'solid'}
        size='small'
        lbl={label}
        href={`/api/automations/connect/${integrationKey}`}
      />
    )
  }

  return (
    <>
      <Btn variant={connected ? 'outline' : 'solid'} size='small' lbl={label} onClick={() => setOpen(true)} />
      {open && (
        <ApiKeyDialog
          integrationKey={integrationKey}
          integrationTitle={integrationTitle}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </>
  )
}

/**
 * The `api_key` flow: the customer tells us where their system lives, we hand
 * back the address it should call and the secret it should sign with.
 *
 * The secret is shown EXACTLY ONCE. Saying so plainly is the honest thing —
 * a value the user can never see again must be labelled as such before they
 * close the dialog, not after.
 */
function ApiKeyDialog({
  integrationKey,
  integrationTitle,
  onClose,
  onDone,
}: {
  integrationKey: string
  integrationTitle: string
  onClose: () => void
  onDone: () => void
}) {
  const [siteUrl, setSiteUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [issued, setIssued] = useState<{ webhookUrl: string; secret: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const res = await provisionApiKeyConnection({ integrationKey, siteUrl, displayName })
      if (res.ok === false) return setError(errorMessage(res.reason))
      setIssued({ webhookUrl: res.webhookUrl, secret: res.secret })
      toast('success', 'החיבור נוצר')
      onDone()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={`חיבור ${integrationTitle}`}>
      <div className='flex flex-col gap-4 w-[min(90vw,520px)] max-h-[calc(90dvh-4rem)] min-h-0 pt-2'>
        <h2 className='text-lg font-semibold text-gray-800 shrink-0'>חיבור {integrationTitle}</h2>
        <div className='flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden grid gap-5 content-start scrollbar-slim'>
          {!issued && (
            <>
              <p className='text-sm text-gray-600 leading-relaxed'>{STRATEGY.api_key.how}</p>
              <Input
                lbl='כתובת האתר או המערכת'
                value={siteUrl}
                placeholder='https://example.com'
                onChange={(e) => setSiteUrl(e.target.value)}
              />
              <Input lbl='שם לתצוגה (לא חובה)' value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <Btn
                lbl={pending ? 'יוצר…' : 'יצירת חיבור'}
                icon={pending ? 'spinner' : 'plug'}
                iconClassName={pending ? 'animate-spin' : undefined}
                disabled={pending || !siteUrl.trim()}
                className='w-full'
                onClick={submit}
              />
              {error && (
                <p className='text-sm text-red-600 ms-1' role='alert'>
                  {error}
                </p>
              )}
            </>
          )}

          {issued && (
            <>
              <p className='text-sm text-gray-600 leading-relaxed'>
                הזינו את שני הפרטים האלה במערכת שלכם. הקוד הסודי מוצג פעם אחת בלבד — שמרו אותו עכשיו.
              </p>
              <CopyRow label='כתובת לשליחה' value={issued.webhookUrl} />
              <CopyRow label='קוד סודי' value={issued.secret} />
              <Btn lbl='סיימתי' className='w-full' onClick={onClose} />
            </>
          )}
        </div>
      </div>
    </ModalPop>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='grid gap-1'>
      <span className='text-sm text-gray-500'>{label}</span>
      <div className='flex items-center gap-2'>
        <code
          className='min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800'
          dir='ltr'
        >
          {value}
        </code>
        <Btn
          variant='outline'
          size='small'
          lbl='העתקה'
          icon='copy'
          onClick={() => {
            navigator.clipboard?.writeText(value)
            toast('success', 'הועתק')
          }}
        />
      </div>
    </div>
  )
}
