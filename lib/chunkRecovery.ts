// Shared client-side recovery for JS chunk-load failures (ChunkLoadError).
//
// After a deploy, a browser may be running an older HTML document than the chunk
// hashes now on the CDN. The old hashes 404, a dynamic import rejects, and
// hydration/render throws. This is RECOVERABLE: reloading the document once
// fetches the current build (whose hashes exist) and the page renders normally.
//
// This module is the single source of truth for that recovery so the root
// error boundary (app/global-error.tsx) and the post-mount listener
// (lib/ChunkReloader.tsx) share ONE loop guard and cannot fight each other:
//   - detection: isChunkError()
//   - a single, loop-guarded reload decision: markChunkReloadAttempt()
//   - clearing the guard once a healthy render proves recovery: clearChunkReloadFlag()

const RELOAD_FLAG = '__chunk_reload_attempted_at__'

// A prior attempt only counts as "recent" within this window. This bounds the
// guard both ways: within the window a persistent failure NEVER reloads twice
// (no loops); after it, a genuinely new chunk error (e.g. a later deploy in a
// long-lived tab) can still auto-recover once.
const ATTEMPT_WINDOW_MS = 30_000

const CHUNK_ERROR_PATTERNS = [
  'ChunkLoadError',
  'Loading chunk',
  'Loading CSS chunk',
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
]

function messageMatches(msg: string): boolean {
  return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p))
}

/** True only for recoverable chunk-load failures. Accepts an Error, an
 *  ErrorEvent's `.error`/`.message`, a rejection reason, or a raw string. */
export function isChunkError(input: unknown): boolean {
  if (!input) return false
  if (typeof input === 'string') return messageMatches(input)
  if (typeof input === 'object') {
    const err = input as { name?: unknown; message?: unknown }
    if (err.name === 'ChunkLoadError') return true
    return typeof err.message === 'string' && messageMatches(err.message)
  }
  return false
}

function attemptedRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_FLAG)
    if (!raw) return false
    const at = Number(raw)
    return Number.isFinite(at) && Date.now() - at < ATTEMPT_WINDOW_MS
  } catch {
    return false
  }
}

/**
 * Records a reload attempt and returns whether the caller SHOULD reload now.
 *
 *   true  → no reload attempted within the window; the flag is now set and the
 *           caller should perform exactly one window.location.reload().
 *   false → a reload was already attempted within the window (persistent
 *           failure), OR sessionStorage is unavailable so a loop can't be
 *           guarded. Either way the caller MUST show a manual recovery UI
 *           instead of reloading. This is what prevents reload loops.
 */
export function markChunkReloadAttempt(): boolean {
  if (typeof window === 'undefined') return false
  if (attemptedRecently()) return false
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  } catch {
    // Without a durable flag we cannot guarantee a single reload → refuse to
    // auto-reload rather than risk a loop.
    return false
  }
  return true
}

/**
 * Clears the guard. Call this only from a component that mounts on a HEALTHY
 * render — a successful mount proves the document and its chunks are in sync,
 * so a later (different-deploy) chunk error is allowed to auto-recover once
 * more. Never call this on the error path (it would re-enable looping).
 */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {}
}
