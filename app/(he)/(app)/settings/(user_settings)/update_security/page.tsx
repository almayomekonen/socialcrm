import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import IpsTable from '@/components/settings/security/IpsTable'
import AccordionItem from '@/lib/AccordionItem'
import LogoutMinutesForm from '@/components/settings/security/LogoutMinutesForm'
import ConnectFacebookAccount from '@/components/settings/security/ConnectFacebookAccount'
import { getFullUser } from '@/db/usersNTeams'
import { getRecentLoginActivity } from '@/db/loginActivity'
import { parseUserAgent } from '@/lib/parseUserAgent'
import { canUseFacebookUserAuth } from '@/lib/auth/facebookUserAuthFlags'
import { isMobileWorkspaceRequest } from '@/lib/device'
import LoginActivityMobile from '@/components/settings/mobile/LoginActivityMobile'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function page() {
  const user = await getUser()
  /**
   * Only the login-activity TABLE is device-dependent on this page. The
   * accordions, the logout-minutes form and the connected-accounts block are all
   * already stacked and measured clean on a phone, so they are shared verbatim —
   * this swaps one child, not the screen.
   */
  const mobile = await isMobileWorkspaceRequest(user?.agencyId)
  const res = await getFullUser({
    id: user.id,
    select: [
      'idNum',
      'firstName',
      'lastName',
      'email',
      'phone',
      'fax',
      'officePhone',
      'logoutMinutes',
    ],
  })

  const activity = await getRecentLoginActivity(user.id)
  const ipData = activity.map((a) => {
    const { browser, os } = parseUserAgent(a.userAgent)
    return { device: `${browser} · ${os}`, ip: a.ip, at: a.at }
  })

  const facebookAppId = canUseFacebookUserAuth(user.agencyId) ? process.env.AUTH_FACEBOOK_APP_ID : undefined
  const facebookRow = facebookAppId ? await db('users').where({ id: user.id }).first('facebookSub') : null

  // TODO: future security sections (intentionally not implemented yet — see plan §10):
  //   - אימות דו שלבי (TOTP 2FA): requires users.totp_secret column + verification flow.
  //   - עדכון סיסמה: product uses Google + magic-link only; password auth not in scope.
  //   - ניהול מכשירים פעילים / ביטול סשן: needs a sessions table + JWT revocation.
  // When implementing, add new <AccordionItem> entries below "פעילות התחברות אחרונה".

  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const bodyClass = 'p-6'
  return (
    <div {...regionAttrs(locale)}>
      <h1 className='title'>{t('settings.account.title.security')}</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>{t('settings.account.security.intro')}</p>
      <div className='accordion mb-6 max-w-2xl'>
        {facebookAppId && (
          <AccordionItem bodyClass={bodyClass} title={t('settings.account.security.accounts')}>
            <ConnectFacebookAccount facebookAppId={facebookAppId} linked={!!facebookRow?.facebookSub} />
          </AccordionItem>
        )}
        <AccordionItem bodyClass={bodyClass} title={t('settings.account.security.logout')}>
          <LogoutMinutesForm user={res} />
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title={t('settings.account.security.activity')}>
          {ipData.length === 0 ? (
            <p className='text-sm text-gray-500'>{t('settings.account.security.noActivity')}</p>
          ) : mobile ? (
            // Device names and IP addresses are data; the dates follow the interface language (Phase F2).
            <LoginActivityMobile rows={ipData} locale={locale} />
          ) : (
            <IpsTable data={ipData} />
          )}
        </AccordionItem>
      </div>
    </div>
  )
}
