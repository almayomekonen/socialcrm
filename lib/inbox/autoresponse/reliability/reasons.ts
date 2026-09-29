/**
 * The skip / suppression reason for an agency whose plan does not include the
 * AI reply. One literal, shared by the enqueue boundary, the worker and the
 * inbox notice, so the three can never disagree about what they are seeing.
 */
export const AI_NOT_ENTITLED = 'ai_not_entitled' as const
