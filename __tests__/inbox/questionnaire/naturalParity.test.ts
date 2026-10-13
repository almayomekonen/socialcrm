import { describe, expect, it } from 'vitest'
import { decideQuestionnaireTurn, type SessionSnapshot } from '@/lib/inbox/autoresponse/questionnaire/transition'
import { naturalDefinition, PARITY_INPUTS } from './fixtures/naturalDefinition'

/**
 * FLAG OFF IS TODAY.
 *
 * The snapshot was captured on origin/main BEFORE any natural-answer code
 * existed. Every input the natural-answers spec names is decided here with the
 * flag absent; a diff means a change leaked past the flag. Do not update this
 * snapshot to make a natural-answers change pass.
 */
const session = (stepId: string): SessionSnapshot => ({
  id: 1,
  status: 'active',
  currentStepId: stepId,
  answers: { needs: ['leads'] },
  invalidCount: 0,
  lastConsumedSequence: 1,
  lastPromptAt: '2026-10-13T06:00:00.000Z',
  version: 0,
})

describe('flag-off parity', () => {
  it('decides every spec input exactly as origin/main does', () => {
    const results = PARITY_INPUTS.map(({ step, texts }) =>
      decideQuestionnaireTurn({
        definition: naturalDefinition(),
        session: session(step),
        inputs: texts.map((text, i) => ({ sequence: 2 + i, kind: 'text' as const, text })),
        now: new Date('2026-10-13T06:05:00.000Z'),
        routedToQuestionnaire: true,
        aiState: 'ai_qualifying',
        humanTookOver: false,
        hasPriorOutbound: true,
        leadStatusTerminal: false,
      }),
    )
    expect(results).toMatchSnapshot()
  })
})
