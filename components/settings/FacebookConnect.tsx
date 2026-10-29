'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import { wait } from '@/lib/funcs'
import type { FacebookHealthStatus } from '@/lib/facebook/health'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import { FACEBOOK_NOTICES, SHARED, facebookNotice } from '@/lib/connections/messages'
import { useInAppWarning, type InAppBrowser } from '@/lib/connections/useInAppWarning'
import { useFacebookDiscoveryFailures } from '@/components/settings/hooks/useFacebookDiscoveryFailures'

/** Display data only — the Page token stays server-side (lib/facebook/pendingPages.ts). */
type Page = { id: string; name: string }
type Connection = { pageId: string; pageName: string }

type Props = {
  connection: Connection | null
  pendingPages: Page[] | null
  health: FacebookHealthStatus | null
  /**
   * True only when the Comments feature is live for this agency AND the
   * connected Page's recorded grant is missing `pages_read_user_content`.
   * Resolved server-side; absent/false renders nothing, so an agency without
   * the feature is never told about a permission it cannot use.
   */
  commentsNeedReconnect?: boolean
  /** Server-detected Instagram/Facebook in-app browser (lib/device.ts). */
  inAppBrowser?: InAppBrowser
}

export default function FacebookConnect({
  connection,
  pendingPages,
  health,
  commentsNeedReconnect = false,
  inAppBrowser,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  // Set by the OAuth callback after it refreshed this admin's connected Page.
  const reconnected = searchParams.get('reconnected') === '1'
  const [selectedPageId, setSelectedPageId] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const { loading, error, setError, run } = useAction()

  const repeatCount = useFacebookDiscoveryFailures(urlError, !!(connection || pendingPages))

  const { warned: inAppWarned, intercept } = useInAppWarning(inAppBrowser)
  const redirectToOAuth = () => {
    if (intercept()) return
    run(async () => {
      window.location.href = '/api/auth/facebook'
      await wait(30_000)
    })
  }

  const disconnectPage = () => {
    if (!connection) return
    setConfirmDisconnect(true)
  }

  const performDisconnect = () => {
    setConfirmDisconnect(false)
    run(async () => {
      const res = await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
      if (!res.ok) {
        toast('error', 'שגיאה בניתוק הדף')
        return
      }
      toast('success', 'הדף נותק בהצלחה')
      router.refresh()
    })
  }

  const connectPage = (page: Page) => {
    setError(null)
    run(async () => {
      const res = await fetch('/api/auth/facebook/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        // Pass the server's notice code straight through (subscription_failed,
        // resource_claimed, …); fall back to a neutral save error.
        setError(typeof errData.error === 'string' ? errData.error : 'save_failed')
        return
      }
      toast('success', `הדף "${page.name}" חובר בהצלחה`)
      router.refresh()
    })
  }

  // State C: Already connected
  if (connection) {
    const needsReconnect = health?.needsReconnect ?? false
    const subscriptionIssue = health && !health.needsReconnect && !health.subscribed
    const isHealthy = health && health.tokenValid && health.permissionsOk && health.subscribed
    const reconnectNotice = inAppWarned ? FACEBOOK_NOTICES.in_app_browser : FACEBOOK_NOTICES.expired

    return (
      <div className='grid gap-4'>
        <p className='text-sm text-gray-600' data-edu={needsReconnect ? undefined : 'facebook-connect'}>
          מחובר לדף: <strong>{connection.pageName}</strong>
        </p>
        {reconnected && !needsReconnect && <p role='status' className='text-sm text-green-600'>החיבור לפייסבוק חודש</p>}
        {isHealthy && <p className='text-sm text-green-600'>החיבור תקין  לידים מגיעים אוטומטית</p>}
        {needsReconnect && <ConnectionNotice notice={reconnectNotice} />}
        {subscriptionIssue && <ConnectionNotice notice={FACEBOOK_NOTICES.repairing} />}
        {/*
          The comment-text notice and its reconnect CTA are deliberately NOT
          rendered. Suppressed, not deleted.

          `pages_read_user_content` is unapproved, so the capability check reports
          the permission missing and this notice fired — while comments arrive
          with their text, the Page is connected, and לידים keep coming. It told
          customers something was broken that demonstrably works, and its CTA sent
          them through a reconnect that fixes nothing. A notice that is wrong in
          production is worse than no notice.

          The detection stays wired end to end — `getFacebookCommentTextCapability`
          in LeadSourcesSection, the `commentsNeedReconnect` prop, and this branch
          — so restoring it is a JSX change here, once the permission is approved
          AND its absence genuinely degrades what the customer sees.
        */}
        {needsReconnect && (
          <div data-edu='facebook-connect' className='w-fit'>
          <Btn
            lbl={loading ? 'מעביר לפייסבוק...' : (reconnectNotice.action ?? SHARED.reconnect)}
            icon={loading ? 'spinner' : 'facebook'}
            iconClassName={loading ? 'animate-spin' : undefined}
            disabled={loading}
            className='w-fit'
            onClick={redirectToOAuth}
          />
          </div>
        )}
        <Btn
          lbl={loading ? 'מנתק...' : 'נתק דף'}
          icon={loading ? 'spinner' : undefined}
          iconClassName={loading ? 'animate-spin' : undefined}
          variant='destructive'
          size='small'
          className='w-fit'
          disabled={loading}
          onClick={disconnectPage}
        />
        <ConfirmPop
          open={confirmDisconnect}
          destructive
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={performDisconnect}
          msg={`לנתק את הדף "${connection.pageName}"?`}
        />
      </div>
    )
  }

  // State B: OAuth done, page not yet selected
  if (pendingPages) {
    const selected = pendingPages.find((p) => p.id === selectedPageId)
    const notice = facebookNotice(error)

    return (
      <div className='grid gap-4'>
        {notice && <ConnectionNotice notice={notice} />}
        <p className='text-sm text-gray-600'>בחר את הדף שברצונך לחבר:</p>
        <FormField lbl='דף פייסבוק'>
          <select
            className='h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'
            value={selectedPageId}
            onChange={(e) => setSelectedPageId(e.target.value)}
          >
            <option value=''>בחר דף...</option>
            {pendingPages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>
        <div data-edu='facebook-connect' className='w-fit'>
        <Btn
          lbl={loading ? 'מחבר דף...' : (notice?.action ?? 'חבר דף')}
          icon={loading ? 'spinner' : 'facebook'}
          iconClassName={loading ? 'animate-spin' : undefined}
          size='medium'
          disabled={!selectedPageId || loading}
          className='w-fit'
          onClick={() => selected && connectPage(selected)}
        />
        </div>
      </div>
    )
  }

  // State A: Not connected
  const isPageDiscoveryError = urlError === 'no_pages' || urlError === 'pages_permission'
  const escalated = isPageDiscoveryError && repeatCount >= 2
  // After a repeated identical discovery failure, swap to the escalated notice
  // and de-emphasize the retry (secondary style, recovery-framed label). Retry
  // stays available — the user is guided to fix the prerequisite first, not locked out.
  const urlNotice = inAppWarned
    ? FACEBOOK_NOTICES.in_app_browser
    : escalated
      ? FACEBOOK_NOTICES.no_pages_repeat
      : facebookNotice(urlError)

  return (
    <div className='grid gap-4'>
      {urlNotice && <ConnectionNotice notice={urlNotice} />}
      {!urlNotice && <p className='text-sm text-gray-500'>חבר את דף הפייסבוק שלך כדי לקבל לידים אוטומטית.</p>}
      <div data-edu='facebook-connect' className='w-fit'>
      <Btn
        lbl={loading ? 'מעביר לפייסבוק...' : (urlNotice?.action ?? 'חבר חשבון פייסבוק')}
        icon={loading ? 'spinner' : 'facebook'}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant={escalated ? 'outline' : undefined}
        disabled={loading}
        className='w-fit'
        onClick={redirectToOAuth}
      />
      </div>
    </div>
  )
}
