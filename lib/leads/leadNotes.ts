/** A note as the lead screens receive it. */
export type LeadNote = {
  id: number
  userName: string
  content: string
  createdAt: string | Date
}

/** Long enough for a full call summary; a limit, so one request cannot store a document. */
export const LEAD_NOTE_MAX_LENGTH = 10_000

export type LeadNoteContentError = 'empty' | 'tooLong'

export function validateLeadNoteContent(raw: unknown): { content: string } | { error: LeadNoteContentError } {
  const content = typeof raw === 'string' ? raw.trim() : ''
  if (!content) return { error: 'empty' }
  if (content.length > LEAD_NOTE_MAX_LENGTH) return { error: 'tooLong' }
  return { content }
}
