import { useEffect, useState, type RefObject } from 'react'

/**
 * The test chat's cursor after a turn the owner sent (or a phrase they taught)
 * has been answered: the message box while the conversation continues, the
 * given "done" control once it has ended. Requested by send/teach only and
 * applied once, after the answer has rendered. Never takes the cursor back
 * from something the owner moved to while the turn was being checked.
 */
export function useRefocusAfterTurn(
  scope: RefObject<HTMLElement | null>,
  input: RefObject<HTMLElement | null>,
  done: RefObject<HTMLElement | null>,
) {
  const [target, setTarget] = useState<'input' | 'done' | null>(null)
  useEffect(() => {
    if (!target) return
    setTarget(null)
    const active = document.activeElement
    if (active && active !== document.body && !scope.current?.contains(active)) return
    ;(target === 'done' ? done : input).current?.focus()
  }, [target, scope, input, done])
  return (ended: boolean) => setTarget(ended ? 'done' : 'input')
}
