import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { LEAD_NOTE_MAX_LENGTH } from '@/lib/leads/leadNotes'
import { addLeadNoteSystem } from '@/lib/system/addLeadNoteSystem'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `add_lead_note` — one new note on the lead's "הערות ושיחות" (`lead_notes`).
 *
 * WHATSAPP ONLY for now (actions/ai/askAgent.ts drops it on the web). Additive:
 * a new row, existing notes untouched. The write is `addLeadNoteSystem`, the
 * session-less counterpart of the lead page's own form.
 *
 * Duplicates: the runtime's idempotency claim makes a second execution of the
 * same action a DUPLICATE_NOOP, and the card's token is single-use. The probe
 * finds the note by lead, author and exact content, so a crashed execution is
 * reconciled rather than written twice.
 */

const addLeadNoteArgs = z.object({
  clientId: z.number().int().positive(),
  content: z.string().trim().min(1).max(LEAD_NOTE_MAX_LENGTH),
})

export type AddLeadNoteArgs = z.infer<typeof addLeadNoteArgs>

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = addLeadNoteArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const r = await addLeadNoteSystem({
    leadId: parsed.data.clientId,
    agencyId: ctx.actor.agencyId,
    role: ctx.actor.role,
    gotPermIds: ctx.actor.gotPermIds,
    actorUserId: ctx.actor.userId,
    content: parsed.data.content,
  })
  if (r.result === 'not_permitted') return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }
  if (r.result === 'invalid') return { status: 'INVALID_ACTION', reason: `invalid-content:${r.reason}` }
  return { status: 'SUCCESS', targetIds: [{ kind: 'lead_note', id: String(r.noteId) }] }
}

type NoteRow = { id: number; leadId: number; agencyId: number; userId: number | null; content: string }

function result(row: NoteRow | undefined, args: AddLeadNoteArgs, ctx: ExecuteContext): VerificationResult {
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'note-not-found' }
  const checks = [
    { name: 'agency', ok: row.agencyId === ctx.actor.agencyId, expected: ctx.actor.agencyId, actual: row.agencyId },
    { name: 'lead', ok: row.leadId === args.clientId, expected: args.clientId, actual: row.leadId },
    { name: 'author', ok: row.userId === ctx.actor.userId, expected: ctx.actor.userId, actual: row.userId },
    { name: 'content', ok: row.content === args.content, expected: 'approved content', actual: row.content === args.content ? 'same' : 'different' },
  ]
  const ok = checks.every((c) => c.ok)
  return {
    state: ok ? 'VERIFIED' : 'MISMATCH',
    verified: ok,
    checks,
    targetIds: [{ kind: 'lead', id: String(row.leadId) }],
    reason: ok ? null : 'postcondition-mismatch',
  }
}

const COLUMNS = ['id', 'leadId', 'agencyId', 'userId', 'content'] as const

/** Re-read the note the executor reported, by id AND the authenticated agency. */
async function verify(action: ActionProposal, execution: ExecutionResult, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = addLeadNoteArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const noteId = Number(execution.targetIds?.find((t) => t.kind === 'lead_note')?.id)
  if (!Number.isSafeInteger(noteId)) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-note-id' }
  const row = (await db('lead_notes').where({ id: noteId, agencyId: ctx.actor.agencyId }).first(...COLUMNS)) as NoteRow | undefined
  return result(row, parsed.data, ctx)
}

/** From the arguments alone: does this author's note with this exact content exist on this lead? */
async function probe(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = addLeadNoteArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const row = (await db('lead_notes')
    .where({ agencyId: ctx.actor.agencyId, leadId: parsed.data.clientId, userId: ctx.actor.userId, content: parsed.data.content })
    .orderBy('id', 'desc')
    .first(...COLUMNS)) as NoteRow | undefined
  return result(row, parsed.data, ctx)
}

/** LOW_RISK_WRITE: one additive row on one lead in the acting agency; reaches nobody; deletable on the lead page. */
export const addLeadNoteAction: AgentActionDefinition = {
  type: 'add_lead_note',
  argsSchema: addLeadNoteArgs as never,
  risk: 'LOW_RISK_WRITE',
  execute,
  verify,
  probe,
}
