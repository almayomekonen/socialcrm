/**
 * An action the APPLICATION proposes, never the model: the personal-reminder
 * actions, whose arguments are a draft row's id, version and time, and the
 * changes to an existing task or appointment, whose record id the application
 * resolved inside the agency. Never model-chosen ids. Kept out of `ProposedAction`, the model's answer shape, on purpose, so
 * no model output can name these types.
 */
export type SystemActionProposal = {
  actionType: 'create_reminder' | 'cancel_reminder' | 'reschedule_reminder' | 'update_task' | 'complete_task' | 'reschedule_meeting' | 'cancel_meeting'
    /** The SmartBee connection owner settling a document SmartBee never confirmed (lib/waAssistant/smartbee/resolve.ts). */
    | 'resolve_smartbee_document'
  args: Record<string, unknown>
  evidenceRefs: string[]
}
