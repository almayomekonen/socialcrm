import { screenKindFor, type ActivationMachine } from '@/lib/activation/activationState'
import { activationCopyIn } from '@/lib/activation/localizedCopy'
import type { UiLocale } from '@/lib/i18n/config'
import WaitingScreen from '@/components/activation/screens/WaitingScreen'
import SelectPageScreen from '@/components/activation/screens/SelectPageScreen'
import WorkingScreen from '@/components/activation/screens/WorkingScreen'
import CompletedScreen from '@/components/activation/screens/CompletedScreen'
import RetryScreen from '@/components/activation/screens/RetryScreen'

type Props = {
  machine: ActivationMachine
  onCta: () => void
  onSelect: (id: string) => void
  onRetry: () => void
  onContinue: () => Promise<boolean>
  /** Interface language for the copy (Phase F4); Hebrew by default. */
  locale?: UiLocale
}

/**
 * Pure renderer: maps state → screen via screenKindFor. No business decisions,
 * no progress indicator (cinematic, not a wizard) — the FSM decides the state,
 * the copy module owns the words.
 */
export default function ActivationScreen({ machine, onCta, onSelect, onRetry, onContinue, locale = 'he' }: Props) {
  const copy = activationCopyIn(machine.status, machine.context, locale)

  switch (screenKindFor(machine.status)) {
    case 'waiting':
      return <WaitingScreen copy={copy} onCta={onCta} />
    case 'working':
      return <WorkingScreen copy={copy} />
    case 'select':
      return <SelectPageScreen copy={copy} pages={machine.context.pages} onSelect={onSelect} />
    case 'completed':
      return <CompletedScreen copy={copy} onContinue={onContinue} />
    case 'retry':
      return <RetryScreen copy={copy} onRetry={onRetry} />
  }
}
