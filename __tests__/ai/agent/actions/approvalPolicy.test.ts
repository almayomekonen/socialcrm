/**
 * Which domain actions may skip the card, decided by the SHARED policy
 * (`approvalRequiredFor`, the function `evaluatePolicy` uses), not by any caller.
 *
 * The two WhatsApp lead updates are always a card, even for an explicit command.
 * The three earlier actions keep their ladder: an explicit command runs, an
 * Agent proposal waits. This pins both, so neither changes by accident.
 */
import { describe, expect, it } from 'vitest'
import { approvalRequiredFor } from '@/lib/agent/actions/registry'
import { ACTION_INTENTS } from '@/lib/agent/actions/intent'
import {
  addLeadNoteAction,
  createFollowUpAction,
  createMeetingAction,
  createTaskAction,
  updateLeadStatusAction,
} from '@/lib/agent/actions/domain'

describe('approval policy per domain action', () => {
  it.each([addLeadNoteAction, updateLeadStatusAction])('$type always requires a card, for every intent', (definition) => {
    for (const intent of ACTION_INTENTS) expect(approvalRequiredFor(definition, intent)).toBe(true)
  })

  it.each([createTaskAction, createFollowUpAction, createMeetingAction])('$type is unchanged: a command runs, a proposal waits', (definition) => {
    expect(approvalRequiredFor(definition, 'EXPLICIT_COMMAND')).toBe(false)
    expect(approvalRequiredFor(definition, 'AGENT_PROPOSAL')).toBe(true)
  })
})
