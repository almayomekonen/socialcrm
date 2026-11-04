import type { EmbeddedSignupCancel, EmbeddedSignupSession } from '@/lib/facebook/embeddedSignupMessages'

export {
  isFacebookOrigin,
  parseEmbeddedSignupCancel,
  parseEmbeddedSignupMessage,
  parseEmbeddedSignupShape,
  type EmbeddedSignupCancel,
  type EmbeddedSignupMessageShape,
  type EmbeddedSignupSession,
} from '@/lib/facebook/embeddedSignupMessages'

/**
 * Embedded Signup completion is two independent browser events:
 *   1. `WA_EMBEDDED_SIGNUP` postMessage (session-info) carrying the account id
 *   2. `FB.login` callback carrying the OAuth code
 *
 * Meta does not document a guaranteed order. Reading the session ref inside
 * the login callback therefore loses a successful Meta onboarding whenever
 * the code arrives first. This gate settles only when BOTH are present.
 */

/** What one launch of Embedded Signup resolved to. Re-exported by useEmbeddedSignup. */
export type EmbeddedSignupResult = {
  ok: boolean
  error?: string
  messagingReady?: boolean
  reason?: string
  /** Meta's own account of a cancel: the screen left, or the error shown. */
  cancel?: EmbeddedSignupCancel
  /** Meta finished and the server kept the connection details: finishing needs no new Meta flow. */
  resumable?: boolean
  /**
   * Set on `error: 'pending'`: no outcome yet, the window may still be open.
   * Resolves with the real outcome if one ever arrives.
   */
  late?: Promise<EmbeddedSignupResult>
}

/** A cancelled launch, carrying Meta's reason only when Meta gave one. */
export function cancelledResult(detail?: EmbeddedSignupCancel): EmbeddedSignupResult {
  return detail ? { ok: false, error: 'cancelled', cancel: detail } : { ok: false, error: 'cancelled' }
}

/**
 * Stops waiting after `ms` WITHOUT inventing an outcome.
 *
 * `FB.login` gives no handle on its window and no signal when it closes through
 * browser chrome, so after a while we cannot tell a blocked popup from a customer
 * still working through Meta's screens. Agency 149 finished 28 seconds after the
 * old timer had told them it failed. So the button is released and the state is
 * reported as unknown, and the real outcome stays attached as `late`.
 */
export function pendingAfter(
  outcome: Promise<EmbeddedSignupResult>,
  ms: number,
  onPending: () => void,
): Promise<EmbeddedSignupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      onPending()
      resolve({ ok: false, error: 'pending', late: outcome })
    }, ms)
    void outcome.then((result) => {
      clearTimeout(timer)
      resolve(result)
    })
  })
}

/** The embedded-signup routes' response, as a launch result. */
export async function signupResponseResult(res: Response): Promise<EmbeddedSignupResult> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string
    messagingReady?: boolean
    reason?: string
    resumable?: boolean
  }
  if (!res.ok) return { ok: false, error: body.error ?? 'server', resumable: body.resumable === true }
  return { ok: true, messagingReady: body.messagingReady, reason: body.reason }
}

export type EmbeddedSignupOutcome =
  | { kind: 'ready'; code: string; session: EmbeddedSignupSession }
  | { kind: 'cancelled'; detail?: EmbeddedSignupCancel }
  | { kind: 'error'; error: string }

export type EmbeddedSignupGate = {
  acceptSession: (session: EmbeddedSignupSession) => void
  acceptCode: (code: string) => void
  /** Meta's CANCEL or ERROR message. Order relative to the login callback is not guaranteed. */
  acceptCancel: (detail: EmbeddedSignupCancel) => void
  /**
   * The login callback came back without a code. Settles as cancelled — at once
   * if Meta already said why, otherwise after `graceMs` so a CANCEL message
   * arriving just behind the callback is not lost.
   */
  cancel: (graceMs?: number) => void
  /** Safety valve after the OAuth code exists but session-info never arrived. */
  expire: () => void
  outcome: Promise<EmbeddedSignupOutcome>
}

export function hasUsableWaba(session: EmbeddedSignupSession | null | undefined): boolean {
  if (typeof session?.waba_id === 'string' && session.waba_id.length > 0) return true
  return (session?.wabaCandidates?.length ?? 0) > 0
}

/**
 * A later message adds to what Meta already said and never erases it: a customer
 * who reports an error and then closes the window sends ERROR, then CANCEL.
 */
function mergeCancel(previous: EmbeddedSignupCancel | null, next: EmbeddedSignupCancel): EmbeddedSignupCancel {
  if (!previous) return next
  return { ...previous, ...next, errorReported: previous.errorReported || next.errorReported }
}

export function createEmbeddedSignupGate(): EmbeddedSignupGate {
  let session: EmbeddedSignupSession | null = null
  let code: string | null = null
  let cancelDetail: EmbeddedSignupCancel | null = null
  let cancelPending = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let settle!: (outcome: EmbeddedSignupOutcome) => void
  const outcome = new Promise<EmbeddedSignupOutcome>((resolve) => {
    settle = (next) => {
      if (settled) return
      settled = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      resolve(next)
    }
  })
  const settleCancelled = () => settle(cancelDetail ? { kind: 'cancelled', detail: cancelDetail } : { kind: 'cancelled' })

  const tryReady = () => {
    if (code && session && hasUsableWaba(session)) {
      settle({ kind: 'ready', code, session })
    }
  }

  return {
    acceptSession(next) {
      if (settled) return
      session = next
      tryReady()
    },
    acceptCode(next) {
      if (settled) return
      if (!next) {
        settle({ kind: 'cancelled' })
        return
      }
      code = next
      tryReady()
    },
    acceptCancel(detail) {
      if (settled) return
      cancelDetail = mergeCancel(cancelDetail, detail)
      if (cancelPending) settleCancelled()
    },
    cancel(graceMs = 0) {
      if (settled) return
      if (cancelDetail || graceMs <= 0) return settleCancelled()
      cancelPending = true
      graceTimer = setTimeout(settleCancelled, graceMs)
    },
    expire() {
      if (settled) return
      // The popup is still open — login callback has not fired. Do not invent
      // a failure; cancel/code remain the authority for that path.
      if (!code) return
      settle({ kind: 'error', error: 'missing_details' })
    },
    outcome,
  }
}
