import 'server-only'
import { db } from '@/config/db'
import { canActOnLead } from '@/lib/tasks/taskAccess'
import type { LeadNote } from '@/lib/leads/leadNotes'

const COLUMNS = ['id', 'userName', 'content', 'createdAt'] as const

/** A safety bound on one page render, far above what one lead accumulates. */
const MAX_NOTES_SHOWN = 200

type Viewer = Parameters<typeof canActOnLead>[0]

/** Newest first, for a viewer allowed to act on the lead; anyone else gets none. */
export async function getLeadNotes(viewer: Viewer, leadId: number): Promise<LeadNote[]> {
  if (!(await canActOnLead(viewer, leadId))) return []
  return db('lead_notes')
    .where({ leadId, agencyId: viewer.agencyId })
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(MAX_NOTES_SHOWN)
    .select(...COLUMNS)
}

/** Writing a note is real lead work, so it stamps lastActivityAt in the same transaction. */
export async function insertLeadNote(input: {
  agencyId: number
  leadId: number
  userId: number
  userName: string
  content: string
}): Promise<LeadNote> {
  return db.transaction(async (trx) => {
    const [note] = await trx('lead_notes')
      .insert(input)
      .returning([...COLUMNS])
    const at = new Date()
    await trx('clients').where({ id: input.leadId, agencyId: input.agencyId }).update({ lastActivityAt: at, updatedAt: at })
    return note as LeadNote
  })
}

export async function findLeadNoteLeadId(agencyId: number, noteId: number): Promise<number | null> {
  const row = await db('lead_notes').where({ id: noteId, agencyId }).first('leadId')
  return row ? Number(row.leadId) : null
}

export async function removeLeadNote(agencyId: number, noteId: number): Promise<void> {
  await db('lead_notes').where({ id: noteId, agencyId }).del()
}
