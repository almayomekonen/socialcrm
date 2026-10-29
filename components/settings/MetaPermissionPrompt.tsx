import ConnectionNotice from '@/components/settings/ConnectionNotice'
import MetaPermissionButton from '@/components/settings/MetaPermissionButton'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import type { InAppBrowser } from '@/lib/device'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { noticeReasonsLabel } from '@/lib/inbox/whatsappComposerDecision'

/**
 * A missing Meta permission: the explanation, and the one action that fixes it.
 * Only an agency admin may start a Facebook authorization (the OAuth routes are
 * admin-only), so anyone else is told who can approve it rather than being given
 * a button that ends on a "forbidden" notice.
 */
export default function MetaPermissionPrompt({
  notice,
  href,
  canAuthorize,
  inAppBrowser,
  locale = 'he',
}: {
  notice: Notice
  href: string
  canAuthorize: boolean
  inAppBrowser?: InAppBrowser
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div className='grid gap-2'>
      <ConnectionNotice notice={notice} reasonsLabel={noticeReasonsLabel(locale)} />
      {canAuthorize ? (
        <MetaPermissionButton
          href={href}
          lbl={notice.action ?? t('inbox.metaNotice.prompt.authorize')}
          inAppBrowser={inAppBrowser}
          locale={locale}
        />
      ) : (
        <p className='text-sm text-gray-600'>{t('inbox.metaNotice.prompt.adminOnly')}</p>
      )}
    </div>
  )
}
