import 'server-only'
import { getAgentAction, registerAgentAction } from '../registry'
import { createTaskAction } from './createTask'
import { createFollowUpAction } from './createFollowUp'
import { createMeetingAction } from './createMeeting'
import { updateLeadStatusAction } from './updateLeadStatus'
import { addLeadNoteAction } from './addLeadNote'
import { createReminderAction } from './reminderCreate'
import { cancelReminderAction, rescheduleReminderAction } from './reminderChange'
import { completeTaskAction, updateTaskAction } from './taskChange'
import { cancelMeetingAction, rescheduleMeetingAction } from './meetingChange'

/** Personal-reminder actions: application-proposed only (SystemActionProposal), always a card. */
const REMINDER_ACTIONS = [createReminderAction, cancelReminderAction, rescheduleReminderAction]

/** Changes to an existing record: the application resolves the record, and each always needs a card. */
const RECORD_CHANGE_ACTIONS = [updateTaskAction, completeTaskAction, rescheduleMeetingAction, cancelMeetingAction]

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
  for (const definition of [createTaskAction, createFollowUpAction, createMeetingAction, updateLeadStatusAction, addLeadNoteAction, ...REMINDER_ACTIONS, ...RECORD_CHANGE_ACTIONS]) {
    if (!getAgentAction(definition.type)) registerAgentAction(definition)
  }
}

export { createTaskAction, createFollowUpAction, createMeetingAction, updateLeadStatusAction, addLeadNoteAction }
export { createReminderAction, cancelReminderAction, rescheduleReminderAction }
export { updateTaskAction, completeTaskAction, rescheduleMeetingAction, cancelMeetingAction }
