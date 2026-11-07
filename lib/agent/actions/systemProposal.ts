/**
 * An action the APPLICATION proposes, never the model: the personal-reminder
 * actions, whose arguments are a draft row's id, version and time, never model
 * text. Kept out of `ProposedAction`, the model's answer shape, on purpose, so
 * no model output can name these types.
 */
export type SystemActionProposal = {
  actionType: 'create_reminder' | 'cancel_reminder' | 'reschedule_reminder'
  args: Record<string, unknown>
  evidenceRefs: string[]
}
