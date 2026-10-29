'use client'

import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { wait } from '@/lib/funcs'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import { useInAppWarning, type InAppBrowser } from '@/lib/connections/useInAppWarning'
import { metaInboxNotice } from '@/lib/connections/metaNoticeCopy'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { noticeReasonsLabel } from '@/lib/inbox/whatsappComposerDecision'

/**
 * Starts Meta's consent screen for one feature's permissions. Same mechanics as
 * the connect button in FacebookConnect: a full-page navigation to the OAuth
 * route (never a client fetch — the route redirects to facebook.com), the
 * pending state held while the browser leaves, and the same first-tap warning
 * inside Instagram's in-app browser, where Meta's dialog often never returns.
 */
export default function MetaPermissionButton({
  href,
  lbl,
  variant,
  inAppBrowser,
  locale = 'he',
}: {
  href: string
  lbl: string
  variant?: 'outline'
  /** Server-detected in-app browser (lib/device.ts#getInAppBrowser). */
  inAppBrowser?: InAppBrowser
  /** The caller's interface language when its screen is translated; Hebrew otherwise. */
  locale?: UiLocale
}) {
  const { loading, run } = useAction()
  const { warned, intercept } = useInAppWarning(inAppBrowser)
  const inAppNotice = metaInboxNotice('in_app_browser', locale)

  return (
    <div className='grid gap-2'>
      {warned && <ConnectionNotice notice={inAppNotice} reasonsLabel={noticeReasonsLabel(locale)} />}
      <Btn
        lbl={loading ? translatorFor(locale)('inbox.metaNotice.prompt.redirecting') : warned ? (inAppNotice.action ?? lbl) : lbl}
        icon={loading ? 'spinner' : 'facebook'}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant={variant}
        size='small'
        className='w-fit'
        disabled={loading}
        onClick={() => {
          if (intercept()) return
          run(async () => {
            window.location.href = href
            await wait(30_000)
          })
        }}
      />
    </div>
  )
}
