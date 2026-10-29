import { getUser } from '@/db/auth'
import { getIssuer } from '@/db/billing/issuer'
import EditAgency from '@/components/settings/agency/EditAgency'
import BusinessProfileArt from '@/components/settings/agency/BusinessProfileArt'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function page() {
  const user = await getUser()
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  if (!user || user.role != 'ADMIN') {
    return <div {...regionAttrs(locale)}>{t('settings.account.denied')}</div>
  }

  const issuer = await getIssuer(user.agencyId)
  if (!issuer) {
    return <div {...regionAttrs(locale)}>{t('settings.account.business.loadFailed')}</div>
  }

  return (
    <div {...regionAttrs(locale)}>
      {/*
        The frame is 10px of breathing room around a 940×280 scene, which is
        the reference's 300px band at full width and keeps that proportion as
        the column narrows. `mb-8` is the reference's 32px gap to the title;
        nothing below this line changed.

        Hidden on phones: the scene would scale to about a third of its size
        there, where the labels stop being readable and it would only push the
        form itself further down.
      */}
      <div className='mb-8 flex justify-center overflow-hidden rounded-[14px] bg-[#f7f8fa] py-2.5 mobile:hidden'>
        {/* Only Google sign-in fills `picture`; the art falls back to the
            drawn avatar when it is empty. */}
        <BusinessProfileArt photoUrl={user.picture} locale={locale} />
      </div>
      <h1 className='title mb-8'>{t('settings.account.title.business')}</h1>
      <div className='mb-6 max-w-2xl'>
        <EditAgency issuer={issuer} />
      </div>
    </div>
  )
}
