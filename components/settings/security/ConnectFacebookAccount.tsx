'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { useRouter, unstable_rethrow } from 'next/navigation'
import { linkFacebookAccount } from '@/actions/linkFacebookAccount'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'

type FacebookUserLoginSdk = {
  init: (params: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void
  login: (
    cb: (response: { status?: string; authResponse?: { accessToken?: string } }) => void,
    opts: { scope: string },
  ) => void
}

function facebookUserLoginSdk(): FacebookUserLoginSdk | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { FB?: FacebookUserLoginSdk }).FB
}

export default function ConnectFacebookAccount({
  facebookAppId,
  linked,
}: {
  facebookAppId: string
  linked: boolean
}) {
  const t = useT()
  const router = useRouter()
  const mounted = useRef(true)
  const fbReady = useRef(false)

  useEffect(() => {
    mounted.current = true
    if (facebookAppId && facebookUserLoginSdk()) initFacebook()
    return () => {
      mounted.current = false
    }
  }, [facebookAppId])

  function initFacebook() {
    const fb = facebookUserLoginSdk()
    if (!facebookAppId || !fb) return
    fb.init({
      appId: facebookAppId,
      cookie: true,
      xfbml: false,
      version: 'v19.0',
    })
    fbReady.current = true
  }

  async function handleFacebookResponse(response: {
    status?: string
    authResponse?: { accessToken?: string }
  }) {
    if (response.status !== 'connected' || !response.authResponse?.accessToken) {
      return
    }

    try {
      const res = await linkFacebookAccount({ accessToken: response.authResponse.accessToken })
      if (!mounted.current) return
      if ('fail' in res) {
        toast('error', res.msg)
        return
      }
      toast('success')
      router.refresh()
    } catch (error) {
      unstable_rethrow(error)
      console.error('[AUTH] route=facebook_link client_error', error)
      if (mounted.current) toast('error', t('settings.account.security.facebook.failed'))
    }
  }

  function onFacebookClick() {
    const fb = facebookUserLoginSdk()
    if (!fbReady.current || !fb) {
      toast('error', t('settings.account.security.facebook.failed'))
      return
    }

    fb.login(
      (response: { status?: string; authResponse?: { accessToken?: string } }) => {
        void handleFacebookResponse(response)
      },
      { scope: 'public_profile,email' },
    )
  }

  return (
    <div>
      <p className='text-sm text-gray-600 leading-relaxed'>
        {t('settings.account.security.facebook.intro')}
      </p>
      {linked ? (
        <p className='mt-4 text-sm text-gray-600'>{t('settings.account.security.facebook.linked')}</p>
      ) : (
        <>
          <Script src='https://connect.facebook.net/he_IL/sdk.js' onLoad={initFacebook} strategy='lazyOnload' />
          <Btn type='button' lbl={t('settings.account.security.facebook.connect')} className='w-full mt-4' onClick={onFacebookClick} />
        </>
      )}
    </div>
  )
}
