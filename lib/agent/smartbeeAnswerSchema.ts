import { z } from 'zod'
import { agentAnswerSchema } from './answerSchema'
import { createSmartbeeDocumentProposal } from './waActionSchemas'

/**
 * The Agent's answer schema WITH the SmartBee document action, for one agency's
 * WhatsApp turns only (lib/waAssistant/worker.ts passes it when that agency's
 * SmartBee capability is on). Every other agency, and the web Agent, keep the
 * shared `agentAnswerSchema` unchanged, byte for byte: the model is never even
 * told that this action exists.
 *
 * Built from the shared schema's own union, so it can never drift from it.
 */
const shared = agentAnswerSchema.shape.proposedAction.options

export const smartbeeAgentAnswerSchema = agentAnswerSchema.extend({
  proposedAction: z.union([...shared, createSmartbeeDocumentProposal]),
})

/**
 * What the WhatsApp worker passes as `answerSchema`: the SmartBee schema when this
 * turn's agency has the capability on, otherwise undefined (the shared schema).
 * The cast is to the run's input type only; the validator re-checks the output.
 */
export function answerSchemaFor(documentsOn: boolean): typeof agentAnswerSchema | undefined {
  return documentsOn ? (smartbeeAgentAnswerSchema as unknown as typeof agentAnswerSchema) : undefined
}
