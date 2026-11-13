import Link from 'next/link'
import Login from '@/components/auth/Login'
import LoginMagicLink from '@/components/auth/LoginMagicLink'
import { getUser } from '@/db/auth'
import { canUseFacebookUserAuth, isFacebookUserAuthPubliclyAvailable } from '@/lib/auth/facebookUserAuthFlags'
import { Metadata } from 'next'
import { isMobileRequest } from '@/lib/device'
import Logo from '@/components/lumen/layout/logo'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { getPreLoginLocale } from '@/lib/i18n/preLoginServer'
import { rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'
import { translatorFor } from '@/lib/i18n/translators'

const METADATA: Metadata = {
  title: 'התחברות | SocialCRM — מערכת ניהול לידים',
  description:
    'התחבר ל-SocialCRM — מערכת ניהול הלידים לעסקים קטנים. כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.',
  alternates: {
    canonical: 'https://getsocialcrm.com/auth',
  },
  // A login screen should not hold a search result a marketing page could
  // (144 impressions, Search Console 11.2026). Not blocked in robots.txt on
  // purpose: Google has to crawl the page to see this tag.
  robots: { index: false, follow: true },
  openGraph: {
    title: 'SocialCRM כל הלידים שלך במקום אחד',
    description: 'נהל את כל הלידים מפייסבוק, אינסטגרם ווואטסאפ ממקום אחד. התחל עכשיו בחינם.',
    url: 'https://getsocialcrm.com/auth',
  },
}

/** Hebrew is the page's SEO metadata, unchanged; another interface language only re-words the tab title. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPreLoginLocale()
  return locale === 'he' ? METADATA : { ...METADATA, title: translatorFor(locale)('auth.signIn.title') }
}

export default async function AuthPage({ searchParams }) {
  const { error } = await searchParams
  const locale = await getPreLoginLocale()
  const t = translatorFor(locale)
  const user = await getUser()
  const facebookLoginEnabled = user
    ? canUseFacebookUserAuth(user.agencyId)
    : isFacebookUserAuthPubliclyAvailable()
  const phoneLogin = await isMobileRequest()

  return (
    <I18nProvider locale={locale} persistLocale={false}>
      <div className='relative min-h-screen bg-white'>
        {/*
          Reproduces Lumen `/signin`
          (`_reference/lumen-nextjs-template-1.0.0/src/app/signin/page.tsx`)
          element for element:

            grid min-h-svh lg:grid-cols-2
            └ container w-full max-w-sm self-center justify-self-center
              └ flex flex-col py-20 lg:py-0
                ├ flex flex-col items-center gap-6 text-center
                │   ├ <Logo onlyLogo />
                │   └ flex flex-col items-center gap-2
                │       ├ h1  text-2xl font-bold
                │       └ p   text-muted-foreground text-sm
                ├ mt-6 grid gap-4
                │   ├ field(s) + submit  (mt-2 w-full shadow-none)
                │   └ grid gap-4  ← social buttons
                └ mt-8 text-center text-sm  ← secondary nav

          Lumen's order is fields → submit → social; it ships no divider. Only
          the copy is ours. An outer <div> replaces Lumen's <form> because the
          magic-link component owns its own <form> and forms cannot nest.
          `auth.jpg` replaces Lumen's gradient panel, untouched.
        */}
        <div className='lumen auth-surface grid min-h-svh lg:grid-cols-2' {...rtlOrRegionAttrs(locale)}>
          <div className='container w-full max-w-sm self-center justify-self-center'>
            <div className='flex flex-col py-20 lg:py-0'>
              <div className='flex flex-col items-center gap-6 text-center'>
                <Logo onlyLogo />
                <div className='flex flex-col items-center gap-2'>
                  <h1 className='text-2xl font-bold'>{t('auth.signIn.heading')}</h1>
                  <p className='text-muted-foreground text-sm'>{t('auth.signIn.subtitle')}</p>
                </div>
              </div>
              <div className='mt-6 grid gap-4'>
                <LoginMagicLink error={error} />
                <div className='grid gap-4 [&>div]:items-center'>
                  <Login
                    user={user}
                    facebookAppId={facebookLoginEnabled ? process.env.AUTH_FACEBOOK_APP_ID : undefined}
                    matchSocialButtons={phoneLogin}
                  />
                  <p className='text-muted-foreground text-center text-xs'>{t('auth.signIn.worksWith')}</p>
                </div>
              </div>
              <div className='mt-8 text-center text-sm'>
                {t('auth.signIn.noAccount')}{' '}
                <Link href='/auth/register' className='font-medium hover:underline'>
                  {t('auth.signIn.join')}
                </Link>
              </div>
            </div>
          </div>
          <img src='/media/auth.jpg' alt={t('auth.signIn.imageAlt')} className='w-full h-screen object-cover hidden lg:block' />
        </div>
      </div>
    </I18nProvider>
  )
}
