'use client'
import { useRef, useState } from 'react'
import { whatsappLaunchNoticeCode } from '@/lib/connections/connectFailure'
import type { EmbeddedSignupResult } from '@/lib/facebook/embeddedSignupSession'

type Signup = {
  launch: () => Promise<EmbeddedSignupResult>
  resume: () => Promise<EmbeddedSignupResult>
  discardKept: () => void
}

/**
 * What one click on the connect button does, and what its outcome means on screen:
 * finish a signup the server kept, or open Meta's flow, and apply an outcome that
 * arrives late. WhatsappConnect renders; this decides.
 */
export function useWhatsappSignupFlow(args: {
  signup: Signup
  signupResumable: boolean
  connected: boolean
  setError: (code: string | null) => void
  setMetaMessage: (message: string | null) => void
  onConnected: () => void
}) {
  const { signup, signupResumable, connected, setError, setMetaMessage, onConnected } = args
  const [resumable, setResumable] = useState(signupResumable)
  // The server may hold a kept signup, even after this click stopped offering it.
  const mayHoldKept = useRef(signupResumable)
  // A late outcome only updates the screen if no newer click has happened since.
  const latestLaunch = useRef(0)

  const apply = (result: EmbeddedSignupResult) => {
    setResumable(result.resumable === true)
    if (result.resumable || result.ok) mayHoldKept.current = result.resumable === true
    if (result.ok) {
      setError(null)
      setMetaMessage(null)
      onConnected()
      return
    }
    setMetaMessage(result.cancel?.errorMessage ?? null)
    setError(whatsappLaunchNoticeCode(result, connected))
  }

  /** Runs synchronously up to `launch`, so FB.login stays inside the click task. */
  const start = async () => {
    const launchId = ++latestLaunch.current
    if (resumable) {
      const resumed = await signup.resume()
      // One try per click sequence: a kept signup that cannot finish must not
      // stand between the customer and Meta's flow.
      apply({ ...resumed, resumable: false })
      mayHoldKept.current = !resumed.ok
      return
    }
    if (mayHoldKept.current) {
      // Meta's flow replaces a kept signup: it must not come back after a cancel.
      mayHoldKept.current = false
      signup.discardKept()
    }
    const result = await signup.launch()
    apply(result)
    void result.late?.then((outcome) => {
      if (latestLaunch.current === launchId) apply(outcome)
    })
  }

  const forgetKept = () => {
    setResumable(false)
    mayHoldKept.current = false
  }

  return { start, forgetKept }
}
