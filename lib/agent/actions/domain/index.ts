import 'server-only'
import { getAgentAction, registerAgentAction } from '../registry'
import { createTaskAction } from './createTask'
import { createFollowUpAction } from './createFollowUp'
import { createMeetingAction } from './createMeeting'
import { updateLeadStatusAction } from './updateLeadStatus'
import { addLeadNoteAction } from './addLeadNote'

/**
 * The domain actions, and the one place they are turned on.
 *
 * Registration is EXPLICIT rather than an import side effect, so a module that
 * merely reaches the runtime cannot silently make actions executable, and a test
 * can reset the registry and rebuild it deterministically.
 *
 * Idempotent: `registerAgentAction` throws on a duplicate type, which is correct
 * for a programming error and wrong for a module that may be initialised more
 * than once in a serverless process.
 */
export function registerDomainActions(): void {
  for (const definition of [createTaskAction, createFollowUpAction, createMeetingAction, updateLeadStatusAction, addLeadNoteAction]) {
    if (!getAgentAction(definition.type)) registerAgentAction(definition)
  }
}

export { createTaskAction, createFollowUpAction, createMeetingAction, updateLeadStatusAction, addLeadNoteAction }
