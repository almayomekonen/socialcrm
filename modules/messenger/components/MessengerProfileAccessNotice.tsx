import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Why contacts show initials instead of real names and pictures.
 *
 * Shown ONLY when Meta has actually refused this app profile access (a
 * conversation recorded `profileStatus = 'denied'`) and ONLY to an admin — the
 * person who can do something about it. A rep cannot request a Meta feature, so
 * telling them would be noise they cannot act on (care charter, Law 7).
 *
 * It states a fact and a consequence, and stops. No badge, no count of affected
 * contacts, no "fix this" nag: messaging works perfectly without profile access,
 * and this is a cosmetic gap, not a failure. It is deliberately NOT an error
 * style — nothing is broken.
 *
 * The Meta feature name stays in English in every language (it is what the rep
 * would search for in Meta's settings); only the sentence around it is translated.
 */
export default function MessengerProfileAccessNotice({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <p role='status' className='border-b border-gray-100 px-3 py-2 text-[11px] leading-relaxed text-gray-500'>
      {t('inbox.messenger.profileAccess.before')}
      <span dir='ltr'>Business Asset User Profile Access</span>
      {t('inbox.messenger.profileAccess.after')}
    </p>
  )
}
