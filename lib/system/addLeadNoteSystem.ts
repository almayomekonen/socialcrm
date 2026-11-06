import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { insertLeadNote } from '@/db/leadNotes'
import { validateLeadNoteContent } from '@/lib/leads/leadNotes'

/**
 * System / server lead-note write — NO product-session authorization.
 *
 * The counterpart of the `addLeadNote` server action (actions/leadNotes.ts),
 * for a caller that has already established who is acting (the Action
 * Runtime). The note goes into `lead_notes`, the lead page's "הערות ושיחות",
 * through the SAME `insertLeadNote` (which also stamps the lead's
 * `lastActivityAt`), with the same content validation. Nothing is overwritten:
 * a note is always a new row beside the existing ones.
 *
 * THE GATE IS PASSED IN. `addLeadNote` checks `canActOnLead`: agency, and for
 * non-admins `userId` or `createdById` in the rep's permitted set. This
 * reproduces that rule from the caller-supplied scope (calling `canActOnLead`
 * itself would re-resolve permissions).
 *
 * The author is the acting user, by their name in `users` as written now, the
 * same as the web form.
 *
 * NEVER import this from client/UI code.
 */

export type AddLeadNoteResult =
  | { result: 'added'; noteId: number; leadName: string }
  | { result: 'invalid'; reason: string }
  | { result: 'not_permitted' }

export async function addLeadNoteSystem(input: {
  leadId: number
  agencyId: number
  role: string
  gotPermIds: number[]
  actorUserId: number
  content: string
}): Promise<AddLeadNoteResult> {
  const validated = validateLeadNoteContent(input.content)
  if ('error' in validated) return { result: 'invalid', reason: validated.error }

  const q = db('clients').where({ id: input.leadId, agencyId: input.agencyId })
  if (!isAdmin(input.role as Parameters<typeof isAdmin>[0])) {
    q.where((b) => b.whereIn('userId', input.gotPermIds).orWhereIn('createdById', input.gotPermIds))
  }
  const lead = (await q.first('id', 'firstName', 'lastName')) as
    | { id: number; firstName: string | null; lastName: string | null }
    | undefined
  if (!lead) return { result: 'not_permitted' }

  const author = (await db('users').where({ id: input.actorUserId, agencyId: input.agencyId }).first('name')) as
    | { name: string | null }
    | undefined
  if (!author) return { result: 'not_permitted' }

  const note = await insertLeadNote({
    agencyId: input.agencyId,
    leadId: lead.id,
    userId: input.actorUserId,
    userName: author.name ?? '',
    content: validated.content,
  })
  return { result: 'added', noteId: Number(note.id), leadName: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() }
}
