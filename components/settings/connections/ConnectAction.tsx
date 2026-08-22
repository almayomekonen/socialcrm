'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import ModalPop from '@/lib/modals/ModalPop'
import { proToast, toast } from '@/lib/toast'
import { provisionApiKeyConnection } from '@/actions/automations/connections'
import type { AuthStrategy } from '@/lib/automations/catalog/vocabularies'
import { STRATEGY, errorMessage } from './copy'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'

/**
 * The connect / reconnect affordance — ONE component, one entry per auth
 * strategy, no integration anywhere.
 *
 * Each strategy in the closed set gets its own generic flow:
 *
 *   api_key → we cannot call them, so they call us: mint a URL and a secret
 *       and show them once.
 *   oauth2 / embedded_signup / none → no button. The first two are
 *       provider-hosted flows that are not implemented, and copy.ts says so;
 *       `none` needs no connection at all. All three are `needsConnection:
 *       false`, so the early return below covers them without a branch.
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
  /** Connection credentials are Pro: provisioning mints a live API key. */
  const expired = useAccessDenied()
  const promptConnection = () =>
    proToast({
      title: 'ניהול חיבורים זמין עם Pro',
      body: 'חידוש המנוי יחזיר את ניהול החיבורים.',
      source: 'connection_manage',
    })
  const [siteUrl, setSiteUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [issued, setIssued] = useState<{ webhookUrl: string; secret: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      if (expired) return promptConnection()
      const res = await provisionApiKeyConnection({ integrationKey, siteUrl, displayName })
      if (res.ok === false) return setError(errorMessage(res.reason))
      setIssued({ webhookUrl: res.webhookUrl, secret: res.secret })
      toast('success', 'החיבור נוצר')
      onDone()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='middle' label={`חיבור ${integrationTitle}`} className='w-[460px] max-w-[92vw]'>
      {/* The house dialog shape (SendInvoiceModal, MeetingFormDialog, …):
          width on ModalPop, centred, `grid gap-4 pt-2` inside. The `pt-2` is
          what gives the close button its breathing room. */}
      <div className='grid gap-4 pt-2'>
        <h2 className='text-lg font-semibold text-dark'>חיבור {integrationTitle}</h2>
        {!issued && (
          <>
            <p className='text-sm text-gray-600 leading-relaxed'>{STRATEGY.api_key.how}</p>
            <Input
              lbl='כתובת האתר או המערכת'
              value={siteUrl}
              dir='ltr'
              placeholder='https://example.com'
              onChange={(e) => setSiteUrl(e.target.value)}
            />
            <Input lbl='שם לתצוגה (לא חובה)' value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            {error && (
              <p className='text-sm text-red-600' role='alert'>
                {error}
              </p>
            )}
            {/* Action sits at the end of the row, not stretched across it. */}
            <div className='flex justify-end mt-2'>
              <Btn
                lbl={pending ? 'יוצר…' : 'יצירת חיבור'}
                icon={pending ? 'spinner' : 'plug'}
                iconClassName={pending ? 'animate-spin' : undefined}
                disabled={pending || !siteUrl.trim()}
                onClick={submit}
              />
            </div>
          </>
        )}

        {issued && (
          <>
            <p className='text-sm text-gray-600 leading-relaxed'>
              הזינו את שני הפרטים האלה במערכת שלכם. הקוד הסודי מוצג פעם אחת בלבד — שמרו אותו עכשיו.
            </p>
            <CopyRow label='כתובת לשליחה' value={issued.webhookUrl} />
            <CopyRow label='קוד סודי' value={issued.secret} />
            <div className='flex justify-end mt-2'>
              <Btn lbl='סיימתי' onClick={onClose} />
            </div>
          </>
        )}
      </div>
    </ModalPop>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='grid gap-1.5 min-w-0'>
      <span className='text-sm text-gray-500'>{label}</span>
      {/* `break-all`, not `truncate`: a secret shown once must be readable and
          selectable in full. `items-start` keeps the button pinned to the first
          line when the value wraps. */}
      <div className='flex items-start gap-2 min-w-0'>
        <code
          className='min-w-0 flex-1 break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-800'
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
