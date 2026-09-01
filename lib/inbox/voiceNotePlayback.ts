/**
 * "At most one WhatsApp voice note plays at a time."
 *
 * Deliberately a module-level registry of pause callbacks rather than a React
 * store or a context: the invariant is about DOM elements that already exist,
 * not about rendered state, and every voice note in a thread is a sibling with
 * no common ancestor worth threading a provider through.
 *
 * Scope is exactly the voice notes that registered themselves. Nothing here can
 * reach an <audio> element belonging to any other part of the product.
 */

type PauseFn = () => void

const players = new Set<PauseFn>()

/** Register a player for the lifetime of the component. Returns the unregister. */
export function registerVoiceNote(pause: PauseFn): () => void {
  players.add(pause)
  return () => {
    players.delete(pause)
  }
}

/**
 * Called by a player that is about to start. Pauses every OTHER registered
 * voice note, leaving each one at its own position — the caller is untouched, so
 * it resumes from wherever it was.
 */
export function claimVoiceNotePlayback(self: PauseFn): void {
  for (const pause of players) {
    if (pause !== self) pause()
  }
}

/** Test-only: the registry is module state and must not leak between cases. */
export function resetVoiceNoteRegistry(): void {
  players.clear()
}
