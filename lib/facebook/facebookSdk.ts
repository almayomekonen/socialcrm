/**
 * Single owner of the shared `window.FB` lifecycle.
 *
 * WHY THIS EXISTS. `connect.facebook.net/<locale>/sdk.js` is not the SDK — it is
 * a ~12KB loader stub. Reading the shipped stub explains every failure we saw in
 * production on this flow:
 *
 *   1. Its first statement is `if (window.FB || !window.JSON) return`. A second
 *      stub — a different locale, a different Facebook app, any consumer at all —
 *      executes and does NOTHING. It never loads a bundle and never calls
 *      `fbAsyncInit`. Whoever gets there first owns the load.
 *   2. It installs `window.FB` SYNCHRONOUSLY as a buffering shim. Every method in
 *      its list, `login` included, merely pushes `[name, args]` onto
 *      `FB.__buffer.calls` and returns undefined. `init` only stores opts.
 *      Only when the real bundle arrives is that buffer replayed.
 *
 * So `window.FB` being truthy proves nothing, and `FB.login` on the shim opens no
 * popup, invokes no callback, and reports no error — it is silently queued. That
 * is exactly the indefinite "מתחבר..." hang, and why the request never reached
 * `/api/whatsapp/embedded-signup`.
 *
 * `fbAsyncInit` is likewise unreliable as a readiness signal: it is one global
 * slot, and per (1) the bundle that eventually calls it may not be the one we
 * asked for. We therefore treat readiness as an OBSERVABLE PROPERTY of
 * `window.FB` rather than a callback we hope to receive.
 *
 * This app has two Facebook apps sharing that one global:
 *   - `AUTH_FACEBOOK_APP_ID`  — Login.tsx / ConnectFacebookAccount.tsx, he_IL, v19.0
 *   - `META_APP_ID`           — WhatsApp Embedded Signup, en_US
 * They cannot both own `FB.init`, so ownership is asserted per-call instead.
 */

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

type FacebookSdk = {
  /** Present ONLY on the loader's buffering shim. The real SDK has no such field. */
  __buffer?: { calls: unknown[]; opts: unknown }
  init: (params: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void
  login: (
    cb: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
    opts: Record<string, unknown>,
  ) => void
}

const SDK_SCRIPT_ID = 'facebook-jssdk'
const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js'

/** How often to re-check `window.FB` while the real bundle is in flight. */
const POLL_INTERVAL_MS = 50

/**
 * True only when the REAL SDK is present and usable.
 *
 * The discriminator is `__buffer`: the loader stub sets it, the real SDK does
 * not. Checking `typeof FB.login === 'function'` alone is not enough — the shim
 * has a `login` function too, and calling it is the bug.
 */
export function facebookSdkIsReady(): boolean {
  const fb = typeof window === 'undefined' ? undefined : window.FB
  return !!fb && typeof fb.login === 'function' && !('__buffer' in fb)
}

/** Distinguishes "nothing loaded" from "stub loaded, bundle still in flight". */
export function facebookSdkIsBuffering(): boolean {
  const fb = typeof window === 'undefined' ? undefined : window.FB
  return !!fb && '__buffer' in fb
}

/** Set by our script tag's error handler so a dead load fails fast and can retry. */
let scriptFailed = false
/** The tag WE injected, so a foreign or dead one can be told apart from ours in flight. */
let ownScript: HTMLScriptElement | null = null

/**
 * Ensure a loader stub is on the page.
 *
 * Deliberately tolerant: if ANY consumer already installed `window.FB`, the load
 * is already owned and injecting a second stub would be a no-op anyway (see 1).
 * We only inject when nothing has claimed the global.
 */
export function ensureFacebookSdkScript(): void {
  if (typeof document === 'undefined') return
  if (facebookSdkIsReady() || facebookSdkIsBuffering()) return

  const existing = document.getElementById(SDK_SCRIPT_ID)
  if (existing) {
    // Reaching here means nothing owns `window.FB` — and the stub sets that
    // SYNCHRONOUSLY when it executes. So this tag has not run: it is either ours
    // still downloading, or a corpse (blocked, offline, aborted, or left by an
    // earlier mount). Only our own in-flight tag is worth waiting on. Keeping a
    // corpse is what made the old failure permanent — `getElementById` saw it,
    // skipped injection, and every retry timed out identically.
    if (existing === ownScript && !scriptFailed) return
    existing.remove()
  }

  scriptFailed = false
  const s = document.createElement('script')
  s.id = SDK_SCRIPT_ID
  s.src = SDK_SRC
  s.async = true
  s.defer = true
  s.crossOrigin = 'anonymous'
  s.addEventListener('error', () => {
    scriptFailed = true
  })
  ownScript = s
  document.body.appendChild(s)
}

/**
 * Assert OUR Facebook app on the shared SDK.
 *
 * Called synchronously immediately before `FB.login`, never once at mount,
 * because the auth components call `FB.init` with `AUTH_FACEBOOK_APP_ID` from
 * their own effects and whichever ran last would otherwise own the binding.
 * `FB.init` is synchronous and idempotent, so re-asserting costs nothing and
 * removes the ordering dependency entirely.
 */
export function initFacebookApp(appId: string, version: string): void {
  window.FB?.init({ appId, cookie: true, xfbml: false, version })
}

/**
 * Resolve true once the real SDK is usable, false if `timeoutMs` elapses or the
 * script load fails.
 *
 * Polls rather than awaiting `fbAsyncInit`. Polling observes the bundle actually
 * replacing the shim no matter which consumer's stub won the race — a callback
 * we register can simply never be called (see 1), and that is precisely the
 * production failure this replaces.
 */
export function waitForFacebookSdk(timeoutMs: number): Promise<boolean> {
  if (facebookSdkIsReady()) return Promise.resolve(true)
  ensureFacebookSdkScript()

  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(deadline)
      resolve(ok)
    }

    const poll = setInterval(() => {
      if (facebookSdkIsReady()) return finish(true)
      // A failed script is terminal: nothing will change by waiting out the
      // remaining budget, and the user gets the real explanation sooner.
      if (scriptFailed && !facebookSdkIsBuffering()) return finish(false)
    }, POLL_INTERVAL_MS)

    const deadline = setTimeout(() => finish(false), timeoutMs)
  })
}

/** Test seam: clear the module-level load state. */
export function __resetFacebookSdkForTests(): void {
  scriptFailed = false
  ownScript = null
}
