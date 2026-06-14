'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { useRouter, unstable_rethrow } from 'next/navigation'
import { jwtDecode } from 'jwt-decode'
import { checkUser } from '../../actions/auth'
import { toast } from '@/lib/toast'
import { normalizeEmail } from '@/lib/normalizeEmail'

declare global {
  const google: any
}

export default function Login({ user }: { user?: { name?: string; gglName?: string } | null }) {
  const router = useRouter()
  const client_id = process.env.NEXT_PUBLIC_GGLID
  const mounted = useRef(true)

  // A login that is still in flight when the screen goes away must not toast
  // against a dead screen. The timers themselves are cleared per-attempt below.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function callback(gglUser) {
    let user = null
    let timedOut = false
    // Closure-local so concurrent/re-fired callbacks never clear each other's timers.
    let slowTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      console.log('[AUTH_DEBUG] clear timers')
      clearTimeout(slowTimer)
      clearTimeout(retryTimer)
    }

    try {
      user = jwtDecode(gglUser.credential)

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

      const res = await checkUser({
        email: normalizeEmail(user.email),
        gglName: user.name,
        picture: user.picture,
        gglSub: user.sub,
      })

      if (timedOut) return

      if (res.fail) {
        if (res.msg === 'המשתמש מושהה') return toast('error', res.msg)
        router.push(`/auth/register?email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name)}`)
        return
      }

      router.push('/dashboard')
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
    })
  }

  return (
    <div className=''>
      {user && <p className='text-sm text-gray-600 mb-1'>כניסה בשם {user.name || user.gglName}</p>}
      <Script src='https://accounts.google.com/gsi/client' onLoad={initGoogle} strategy='lazyOnload' />

      <div id='gglBtn'></div>
    </div>
  )
}
