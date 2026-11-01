import type { Metadata } from 'next'
import Link from 'next/link'
import AddAgencyForm from '@/components/agencies/AddAgencyForm'
import Login from '@/components/auth/Login'
import Logo from '@/components/lumen/layout/logo'
import { isFacebookUserAuthOpenToNewAgencies } from '@/lib/auth/facebookUserAuthFlags'
import { isMobileRequest } from '@/lib/device'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { getPreLoginLocale } from '@/lib/i18n/preLoginServer'
import { rtlOrRegionAttrs } from '@/lib/i18n/preLoginLocale'
import { translatorFor } from '@/lib/i18n/translators'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translatorFor(await getPreLoginLocale())('auth.register.title') }
}

export default async function page({ searchParams }) {
  const { email, name } = await searchParams
  const locale = await getPreLoginLocale()
  const t = translatorFor(locale)
  return (
    /* Reproduces Lumen `/signup`
       (`_reference/lumen-nextjs-template-1.0.0/src/app/signup/page.tsx`):
       the same container, the same logo + greeting + subtitle cluster, the
       field stack in `mt-6 grid gap-4` with the submit inside it, social
       buttons AFTER the submit (Lumen ships no divider), and the secondary
       nav at `mt-8 text-center text-sm`. Only the copy is ours.
       `auth.jpg` replaces Lumen's gradient panel and is untouched. */
    <I18nProvider locale={locale} persistLocale={false}>
      <div className='lumen auth-surface grid min-h-svh lg:grid-cols-2' {...rtlOrRegionAttrs(locale)}>
        <div className='container w-full max-w-sm self-center justify-self-center'>
          <div className='flex flex-col py-20 lg:py-0'>
            <div className='flex flex-col items-center gap-6 text-center'>
              <Logo onlyLogo />
              <div className='flex flex-col items-center gap-2'>
                <h1 className='text-2xl font-bold'>{t('auth.register.heading')}</h1>
                <p className='text-muted-foreground text-sm'>{t('auth.register.subtitle')}</p>
              </div>
            </div>
            <div className='mt-6 grid gap-4'>
              <AddAgencyForm defaultEmail={email} defaultName={name} />
              <div className='grid gap-4 [&>div]:items-center'>
                <Login
                  facebookAppId={isFacebookUserAuthOpenToNewAgencies() ? process.env.AUTH_FACEBOOK_APP_ID : undefined}
                  matchSocialButtons={await isMobileRequest()}
                />
              </div>
            </div>
            <div className='mt-8 text-center text-sm'>
              {t('auth.register.haveAccount')}{' '}
              <Link href='/auth' className='font-medium hover:underline'>
                {t('auth.register.signIn')}
              </Link>
            </div>
          </div>
        </div>
        <img src='/media/auth.jpg' alt='' className='w-full h-screen hidden lg:block' />
      </div>
    </I18nProvider>
  )
}
