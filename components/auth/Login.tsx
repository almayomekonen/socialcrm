'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { useRouter, unstable_rethrow } from 'next/navigation'
import { checkFacebookUser, checkUser } from '../../actions/auth'
import { toast } from '@/lib/toast'
import { getDisplayName } from '@/lib/users/displayName'

declare global {
  const google: any
}

function facebookSdk(): any {
  return typeof window === 'undefined' ? undefined : (window as any).FB
}

export default function Login({
  user,
  facebookAppId,
  matchSocialButtons = false,
}: {
  user?: { name?: string; gglName?: string } | null
  facebookAppId?: string
  /** Phone login: Google and Facebook share one LTR icon+label structure. Desktop GIS is unchanged. */
  matchSocialButtons?: boolean
}) {
  const router = useRouter()
  const client_id = process.env.NEXT_PUBLIC_GGLID
  const mounted = useRef(true)
  const fbReady = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const gisWidth = useRef(0)

  // A login that is still in flight when the screen goes away must not toast
  // against a dead screen. The timers themselves are cleared per-attempt below.
  useEffect(() => {
    mounted.current = true
    if (facebookAppId && facebookSdk()) initFacebook()
    return () => {
      mounted.current = false
    }
  }, [facebookAppId])

  // The GIS button is a fixed-width iframe, so it has to be re-rendered when
  // the column it sits in changes width. Guarded for SSR and jsdom.
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => renderGoogleButton())
    ro.observe(el)
    return () => ro.disconnect()
  }, [matchSocialButtons])

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

  /* GIS only accepts a PIXEL width (max 400), so a fluid button has to be
     measured and re-rendered. Everything else about the button — theme, size,
     text, locale, shape, the initialize() call and the callback — is byte for
     byte what it was; only the width number changes. */
  function renderGoogleButton() {
    const el = document.getElementById('gglBtn')
    if (!el || typeof google === 'undefined') return
    const measured = Math.round(rootRef.current?.getBoundingClientRect().width ?? 0)
    const width = measured > 0 ? Math.min(measured, 400) : 250
    if (width === gisWidth.current) return
    gisWidth.current = width

    google.accounts.id.renderButton(el, {
      width,
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      locale: 'he',
      shape: 'rectangular',
      ...(matchSocialButtons ? { logo_alignment: 'left' } : {}),
    })
  }

  function initGoogle() {
    google.accounts.id.initialize({
      client_id,
      callback,
    })

    renderGoogleButton()
  }

  function initFacebook() {
    const FB = facebookSdk()
    if (!facebookAppId || !FB) return
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
    const FB = facebookSdk()
    if (!fbReady.current || !FB) {
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
    <div ref={rootRef} className='flex w-full flex-col items-center lg:items-start'>
      {user && <p className='text-sm text-gray-600 mb-1'>כניסה בשם {getDisplayName(user)}</p>}
      <Script src='https://accounts.google.com/gsi/client' onLoad={initGoogle} strategy='lazyOnload' />
      {facebookAppId && (
        <Script src='https://connect.facebook.net/he_IL/sdk.js' onLoad={initFacebook} strategy='lazyOnload' />
      )}

      {matchSocialButtons ? (
        <div className='flex w-full flex-col gap-3' dir='ltr' data-testid='social-auth-buttons'>
          <div className='relative h-11 w-full'>
            <div aria-hidden className={SOCIAL_BTN}>
              <GoogleMark />
              <span>כניסה באמצעות Google</span>
            </div>
            <div id='gglBtn' className='absolute inset-0 flex items-center overflow-hidden opacity-0' dir='ltr' />
          </div>
          {facebookAppId && (
            <button type='button' dir='ltr' className={SOCIAL_BTN} onClick={onFacebookClick}>
              <FacebookMark />
              <span>כניסה באמצעות Facebook</span>
            </button>
          )}
        </div>
      ) : (
        <>
          <div id='gglBtn' className='flex w-full justify-center' dir='ltr'></div>
          {facebookAppId && (
            <button
              type='button'
              dir='ltr'
              className='relative mt-3 flex h-10 w-full items-center justify-center rounded border border-input bg-white px-12 text-[14px] font-medium leading-none text-[#1f1f1f] hover:bg-gray-50'
              onClick={onFacebookClick}
            >
              <FacebookMark />
              <span>כניסה באמצעות Facebook</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Border only: `border-input` is the token Lumen's own `Button variant="outline"`
 * uses for the equivalent auth controls, replacing Google's `#747775`. Width,
 * height, radius, padding, type, background and hover are untouched.
 */
const SOCIAL_BTN =
  'relative flex h-11 w-full items-center justify-center rounded border border-input bg-white px-12 text-[14px] font-medium leading-none text-[#1f1f1f] hover:bg-gray-50'

function FacebookMark() {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 24 24'
      className='absolute left-3 top-1/2 shrink-0 -translate-y-1/2'
      aria-hidden='true'
    >
      <circle cx='12' cy='12' r='12' fill='#1877F2' />
      <path
        fill='#fff'
        d='M13.4 21v-6.5h2.2l.4-2.6h-2.6v-1.6c0-.7.2-1.2 1.3-1.2h1.4V6.8c-.2 0-1.1-.1-2-.1-2.1 0-3.5 1.3-3.5 3.6v1.6H8.5v2.6h2.1V21h2.8z'
      />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 24 24'
      className='absolute left-3 top-1/2 shrink-0 -translate-y-1/2'
      aria-hidden='true'
    >
      <path
        fill='#4285F4'
        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
      />
      <path
        fill='#34A853'
        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
      />
      <path
        fill='#FBBC05'
        d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
      />
      <path
        fill='#EA4335'
        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
      />
    </svg>
  )
}
