'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * One-shot signal for the Pro trial activation celebration.
 *
 * IN-MEMORY ONLY — no sessionStorage / localStorage / URL / DB. This is
 * deliberate: the celebration must appear exactly once, immediately after a
 * genuine NEVER_STARTED → TRIAL_ACTIVE activation, and NEVER on refresh,
 * re-login, navigation, or for started:false. Because the state lives only in
 * React memory, a refresh or new session wipes it — so those paths can never
 * re-show it.
 *
 * The provider is mounted ABOVE the trialStatus conditional in the (app)
 * layout, so it survives the RSC revalidation that swaps WorkspaceTeaser →
 * real workspace and unmounts WelcomeTrialModal. WelcomeTrialModal (rendered
 * for NEVER_STARTED) calls markActivated() on started:true; ProActivationSuccess
 * (rendered for TRIAL_ACTIVE) reads justActivated during render and clears it on
 * dismiss.
 */
type ActivationCelebration = {
  justActivated: boolean
  markActivated: () => void
  dismiss: () => void
}

const ActivationCelebrationContext = createContext<ActivationCelebration | null>(null)

export function ActivationCelebrationProvider({ children }: { children: ReactNode }) {
  const [justActivated, setJustActivated] = useState(false)
  const markActivated = useCallback(() => setJustActivated(true), [])
  const dismiss = useCallback(() => setJustActivated(false), [])
  const value = useMemo(
    () => ({ justActivated, markActivated, dismiss }),
    [justActivated, markActivated, dismiss],
  )
  return <ActivationCelebrationContext.Provider value={value}>{children}</ActivationCelebrationContext.Provider>
}

export function useActivationCelebration(): ActivationCelebration {
  const ctx = useContext(ActivationCelebrationContext)
  if (!ctx) throw new Error('useActivationCelebration must be used within an ActivationCelebrationProvider')
  return ctx
}

/** True only inside the celebration provider, immediately after a real activation. */
export function useJustActivated(): boolean {
  return useContext(ActivationCelebrationContext)?.justActivated === true
}
