'use client'

import Script from 'next/script'
import { jwtDecode } from 'jwt-decode'
import { checkUser } from '../../actions/auth'
import { toast } from '@/lib/toast'

declare global {
  const google: any
}

export default function Login() {
  // GOOGLE LOGIN
  const client_id = process.env.NEXT_PUBLIC_GGLID

  async function callback(gglUser) {
    let user = null
    try {
      user = jwtDecode(gglUser.credential)

      const res = await checkUser({
        email: user.email,
        gglName: user.name,
        picture: user.picture,
        gglSub: user.sub,
      })

      if (res.fail) return toast('error', res.msg)
    } catch (error) {}
  }

  function initGoogle() {
    google.accounts.id.initialize({
      client_id,
      callback,
    })

    // google.accounts.id.prompt()
    google.accounts.id.renderButton(document.getElementById('gglBtn'), {
      width: 250,
    })
  }

  return (
    <div className=''>
      <Script src='https://accounts.google.com/gsi/client' onLoad={initGoogle} strategy='lazyOnload' />

      <div id='gglBtn'></div>
    </div>
  )
}
