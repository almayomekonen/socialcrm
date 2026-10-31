'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { useRouter, unstable_rethrow } from 'next/navigation'
import { checkFacebookUser, checkUser } from '../../actions/auth'
import { toast } from '@/lib/toast'
import { getDisplayName } from '@/lib/users/displayName'
import SocialButtons from './SocialButtons'

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

      <SocialButtons phone={matchSocialButtons} facebook={!!facebookAppId} onFacebookClick={onFacebookClick} />
    </div>
  )
}
