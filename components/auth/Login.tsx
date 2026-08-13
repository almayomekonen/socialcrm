'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { useRouter, unstable_rethrow } from 'next/navigation'
import { checkFacebookUser, checkUser } from '../../actions/auth'
import { toast } from '@/lib/toast'
import { getDisplayName } from '@/lib/users/displayName'

declare global {
  const google: any
  const FB: any
}

export default function Login({
  user,
  facebookAppId,
}: {
  user?: { name?: string; gglName?: string } | null
  facebookAppId?: string
}) {
  const router = useRouter()
  const client_id = process.env.NEXT_PUBLIC_GGLID
  const mounted = useRef(true)
  const fbReady = useRef(false)

  // A login that is still in flight when the screen goes away must not toast
  // against a dead screen. The timers themselves are cleared per-attempt below.
  useEffect(() => {
    mounted.current = true
    if (facebookAppId && typeof FB !== 'undefined') initFacebook()
    return () => {
      mounted.current = false
    }
  }, [facebookAppId])

  async function finishSocialLogin(
    res: { fail?: boolean; msg?: string; email?: string; name?: string; register?: boolean } | void,
    timedOut: boolean,
    route: 'google_check' | 'facebook_check',
  ) {
    if (timedOut || !res) return
    if (res.fail) {
      if (res.msg === 'המשתמש מושהה') return toast('error', res.msg)
      if (route === 'facebook_check') {
        if (!res.register) return toast('error', res.msg ?? 'ההתחברות נכשלה, נסה שוב')
        const email = res.email ?? ''
        const name = res.name ?? ''
        router.push(`/auth/register?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`)
        return
      }
      const email = res.email ?? ''
      const name = res.name ?? ''
      router.push(`/auth/register?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`)
      return
    }
    router.push('/dashboard')
  }

  async function callback(gglUser) {
    let timedOut = false
    let slowTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      console.log('[AUTH_DEBUG] clear timers')
      clearTimeout(slowTimer)
      clearTimeout(retryTimer)
    }

    try {
      console.log('[AUTH_DEBUG] start timers')
      slowTimer = setTimeout(() => {
        if (!mounted.current) return
        console.log('[AUTH_DEBUG] slow timer fired')
        toast('loading', 'הפעולה לוקחת יותר זמן מהרגיל...')
      }, 10000)
      retryTimer = setTimeout(() => {
        timedOut = true
        if (!mounted.current) return
        console.log('[AUTH_DEBUG] retry timer fired')
        toast('error', 'לוקח זמן רב מהרגיל, נסה שוב')
      }, 20000)

      const res = await checkUser({ credential: gglUser.credential })
      await finishSocialLogin(res, timedOut, 'google_check')
    } catch (error) {
      unstable_rethrow(error)
      console.error('[AUTH] route=google_check client_error', error)
      if (!timedOut) toast('error', 'ההתחברות נכשלה, נסה שוב')
    } finally {
      cleanup()
    }
  }

  function initGoogle() {
    google.accounts.id.initialize({
      client_id,
      callback,
    })

    google.accounts.id.renderButton(document.getElementById('gglBtn'), {
      width: 250,
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      locale: 'he',
      shape: 'rectangular',
    })
  }

  function initFacebook() {
    if (!facebookAppId || typeof FB === 'undefined') return
    FB.init({
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

    let timedOut = false
    let slowTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(slowTimer)
      clearTimeout(retryTimer)
    }

    try {
      slowTimer = setTimeout(() => {
        if (!mounted.current) return
        toast('loading', 'הפעולה לוקחת יותר זמן מהרגיל...')
      }, 10000)
      retryTimer = setTimeout(() => {
        timedOut = true
        if (!mounted.current) return
        toast('error', 'לוקח זמן רב מהרגיל, נסה שוב')
      }, 20000)

      const res = await checkFacebookUser({ accessToken: response.authResponse.accessToken })
      await finishSocialLogin(res, timedOut, 'facebook_check')
    } catch (error) {
      unstable_rethrow(error)
      console.error('[AUTH] route=facebook_check client_error', error)
      if (!timedOut) toast('error', 'ההתחברות נכשלה, נסה שוב')
    } finally {
      cleanup()
    }
  }

  function onFacebookClick() {
    if (!fbReady.current || typeof FB === 'undefined') {
      toast('error', 'ההתחברות נכשלה, נסה שוב')
      return
    }

    FB.login(
      (response: { status?: string; authResponse?: { accessToken?: string } }) => {
        void handleFacebookResponse(response)
      },
      { scope: 'public_profile,email' },
    )
  }

  return (
    <div className='flex w-full flex-col items-center lg:items-start'>
      {user && <p className='text-sm text-gray-600 mb-1'>כניסה בשם {getDisplayName(user)}</p>}
      <Script src='https://accounts.google.com/gsi/client' onLoad={initGoogle} strategy='lazyOnload' />
      {facebookAppId && (
        <Script src='https://connect.facebook.net/he_IL/sdk.js' onLoad={initFacebook} strategy='lazyOnload' />
      )}

      <div id='gglBtn' className='flex w-[250px] justify-center'></div>
      {facebookAppId && (
        <button
          type='button'
          dir='rtl'
          className='mt-3 flex h-10 w-[250px] items-center justify-center gap-2.5 rounded border border-[#747775] bg-white text-[14px] font-medium text-[#1f1f1f] hover:bg-gray-50'
          onClick={onFacebookClick}
        >
          <svg width='18' height='18' viewBox='0 0 24 24' className='shrink-0' aria-hidden='true'>
            <rect width='24' height='24' rx='6' fill='#1877F2' />
            <path
              fill='#fff'
              d='M13.4 21v-6.5h2.2l.4-2.6h-2.6v-1.6c0-.7.2-1.2 1.3-1.2h1.4V6.8c-.2 0-1.1-.1-2-.1-2.1 0-3.5 1.3-3.5 3.6v1.6H8.5v2.6h2.1V21h2.8z'
            />
          </svg>
          <span>כניסה באמצעות Facebook</span>
        </button>
      )}
    </div>
  )
}
