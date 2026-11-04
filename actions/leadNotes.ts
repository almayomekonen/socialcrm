'use server'

import { revalidatePath } from 'next/cache'
import { requireBasicCrmAccess } from '@/lib/requireUser'
import { canActOnLead } from '@/lib/tasks/taskAccess'
import { findLeadNoteLeadId, insertLeadNote, removeLeadNote } from '@/db/leadNotes'
import { validateLeadNoteContent, type LeadNote, type LeadNoteContentError } from '@/lib/leads/leadNotes'

export type LeadNoteErrorCode = LeadNoteContentError | 'notFound'
export type AddLeadNoteResult = { note: LeadNote } | { err: LeadNoteErrorCode }
export type DeleteLeadNoteResult = { ok: true } | { err: 'notFound' }

/**
 * TIER 1, like logLeadOutcome: a note is the customer's own record of their own
 * lead and reaches no paid or external service. A lapsed account keeps access
 * to what it wrote. Tenant and rep scoping come from canActOnLead, the same
 * check the lead's tasks use.
 */
export async function addLeadNote(input: { leadId: number; content: string }): Promise<AddLeadNoteResult> {
  const leadId = Number(input?.leadId)
  const validated = validateLeadNoteContent(input?.content)
  if ('error' in validated) return { err: validated.error }

  const user = await requireBasicCrmAccess()
  if (!(await canActOnLead(user, leadId))) return { err: 'notFound' }

  const note = await insertLeadNote({
    agencyId: user.agencyId,
    leadId,
    userId: user.id,
    userName: user.name ?? '',
    content: validated.content,
  })
  revalidatePath(`/clients/${leadId}`, 'layout')
  return { note }
}

export async function deleteLeadNote(input: { id: number }): Promise<DeleteLeadNoteResult> {
  const id = Number(input?.id)
  if (!Number.isSafeInteger(id) || id <= 0) return { err: 'notFound' }

  const user = await requireBasicCrmAccess()
  const leadId = await findLeadNoteLeadId(user.agencyId, id)
  if (leadId === null || !(await canActOnLead(user, leadId))) return { err: 'notFound' }

  await removeLeadNote(user.agencyId, id)
  revalidatePath(`/clients/${leadId}`, 'layout')
  return { ok: true }
}
