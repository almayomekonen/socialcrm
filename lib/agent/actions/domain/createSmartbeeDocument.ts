import 'server-only'
import { z } from 'zod'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { resolveIntegrationAccess } from '@/lib/integrations/core/permissions'
import { smartbeeProviderMsgId } from '@/lib/integrations/providers/smartbee/config'
import { buildSmartbeeBody, validateDocumentDraft, type ConfirmedPayment, type DocumentDraft } from '@/lib/integrations/providers/smartbee/payload'
import { ensureSmartbeeDocument, findSmartbeeDocument, findSmartbeeDocumentByAction, unsettledSmartbeeDocument, type SmartbeeDocumentRow } from '@/db/smartbee/documents'
import type { AgentActionDefinition, ExecuteContext } from '../registry'
import type { ActionProposal, ExecutionResult, VerificationResult } from '../types'

/**
 * `create_smartbee_document` — one invoice, receipt or invoice-receipt for one
 * lead, through the agency's SmartBee connection.
 *
 * WHATSAPP ONLY and ONE AGENCY: offered only through smartbeeAnswerSchema to an
 * agency on SMARTBEE_AGENCY_IDS; the web Agent drops it (actions/ai/askAgent.ts).
 * ALWAYS A CARD (`requiresApproval`), and only the connection's owner may run
 * it: `resolveIntegrationAccess` is checked again HERE, at execution, together
 * with lead visibility against the current rows, and the approved connection
 * and environment (both inside the argsHash the card bound).
 *
 * WHAT "SUCCESS" MEANS HERE: the request is durably recorded with its
 * providerMsgId, ready for the follow-up to submit. It does NOT mean a
 * document exists. SmartBee creates documents asynchronously; only a 102 poll
 * result makes one `created`, and only then is the owner told it was issued.
 *
 * DUPLICATES: the runtime's claim, the single-use card, `agentActionId` unique
 * on smartbee_documents, and underneath them SmartBee's own permanent
 * deduplication of providerMsgId (derived from this action, never regenerated).
 */

const paymentArgs = z.object({
  method: z.enum(['cash', 'credit_card', 'bank_transfer', 'check', 'other']),
  amount: z.number().positive(),
  paidOn: z.string().nullable(),
  installments: z.number().int().nullable(),
  checkNumber: z.string().nullable(),
  reference: z.string().nullable(),
  otherLabel: z.string().nullable(),
})

const documentArgs = z.object({
  clientId: z.number().int().positive(),
  docType: z.enum(['Invoice', 'Receipt', 'InvoiceReceipt']),
  description: z.string().trim().min(1),
  amount: z.number().positive(),
  vatOption: z.enum(['NotInclude', 'Include', 'Free']).nullable(),
  payment: paymentArgs.nullable(),
  /** The customer exactly as the approved card showed it (frozen at proposal time). */
  customerName: z.string().trim().min(2).max(100),
  customerIdNumber: z.string().regex(/^\d{5,9}$/).nullable(),
  connectionId: z.number().int().positive(),
  environment: z.enum(['test', 'production']),
})

export type CreateSmartbeeDocumentArgs = z.infer<typeof documentArgs>

/** Every field present (null = not said): the stored payment is exactly what the card showed. */
function toPayment(p: CreateSmartbeeDocumentArgs['payment']): ConfirmedPayment | null {
  if (!p) return null
  return {
    method: p.method,
    amount: p.amount,
    paidOn: p.paidOn ?? null,
    installments: p.installments ?? null,
    checkNumber: p.checkNumber ?? null,
    reference: p.reference ?? null,
    otherLabel: p.otherLabel ?? null,
  }
}

type Lead = { id: number }

async function visibleLead(ctx: ExecuteContext, leadId: number): Promise<Lead | undefined> {
  const q = db('clients').where({ id: leadId, agencyId: ctx.actor.agencyId })
  if (!isAdmin(ctx.actor.role as never)) q.whereIn('userId', ctx.actor.gotPermIds ?? [])
  return (await q.first('id')) as Lead | undefined
}

function outcomeOf(row: SmartbeeDocumentRow): ExecutionResult {
  if (row.status === 'failed') return { status: 'FAILED', reason: `smartbee-${row.failureReason ?? 'rejected'}`, targetIds: [{ kind: 'smartbee_document', id: String(row.id) }] }
  return { status: 'SUCCESS', targetIds: [{ kind: 'smartbee_document', id: String(row.id) }], detail: { documentStatus: row.status } }
}

async function execute(action: ActionProposal, ctx: ExecuteContext): Promise<ExecutionResult> {
  const parsed = documentArgs.safeParse(action.args)
  if (!parsed.success) return { status: 'INVALID_ACTION', reason: 'invalid-args' }
  const a = parsed.data

  const access = await resolveIntegrationAccess({ provider: 'smartbee', agencyId: ctx.actor.agencyId, userId: ctx.actor.userId })
  if (access.ok === false) return { status: 'NOT_AUTHORIZED', reason: `smartbee-${access.reason}` }
  const connection = access.connection
  if (connection.id !== a.connectionId || connection.environment !== a.environment) return { status: 'FAILED', reason: 'smartbee-connection-changed' }

  // A crashed or retried execution: the row already exists. Never build a second request.
  const existing = await findSmartbeeDocumentByAction(ctx.actor.agencyId, action.actionId)
  if (existing) return outcomeOf(existing)

  const lead = await visibleLead(ctx, a.clientId)
  if (!lead) return { status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency-or-not-permitted' }
  // Another request for this lead is unsettled (pending, queued, or stalled with no owner resolution): never a
  // second document beside an uncertain one.
  if (await unsettledSmartbeeDocument(ctx.actor.agencyId, lead.id, action.actionId)) return { status: 'FAILED', reason: 'smartbee-request-in-flight' }
  const draft: DocumentDraft = {
    docType: a.docType,
    description: a.description,
    amount: a.amount,
    vatOption: a.vatOption,
    payment: toPayment(a.payment),
    // The APPROVED identity, never re-read: the lead check above only proves it is still this agency's, visible lead.
    customer: { name: a.customerName, idNum: a.customerIdNumber },
  }
  const valid = validateDocumentDraft(draft, connection.businessType)
  if (valid.ok === false) return { status: 'INVALID_ACTION', reason: `smartbee-${valid.reason}` }

  const providerMsgId = smartbeeProviderMsgId(connection.environment, action.actionId)
  const body = buildSmartbeeBody(draft, { providerMsgId, providerMsgReferenceId: `scrm-a${ctx.actor.agencyId}-l${lead.id}` })
  const { row } = await ensureSmartbeeDocument({
    agencyId: ctx.actor.agencyId,
    connectionId: connection.id,
    leadId: lead.id,
    agentActionId: action.actionId,
    environment: connection.environment,
    providerMsgId,
    docType: a.docType,
    description: a.description,
    totalAmount: a.amount,
    vatOption: a.vatOption,
    payment: draft.payment,
    requestSnapshot: body,
    approvedByUserId: ctx.actor.userId,
    approvedAt: new Date(ctx.nowMs),
  })
  // Recorded, not sent: SmartBee is called by the follow-up (lib/waAssistant/smartbee/follow.ts) right after
  // this reply, never inside the action's lease. A 30-second SmartBee timeout here would turn a recorded,
  // safely re-sendable request into an UNKNOWN action.
  return outcomeOf(row)
}

const LIVE = new Set(['pending', 'queued', 'created', 'draft', 'stalled'])

function result(row: SmartbeeDocumentRow | null, a: CreateSmartbeeDocumentArgs, action: ActionProposal, ctx: ExecuteContext): VerificationResult {
  if (!row) return { state: 'NOT_FOUND', verified: false, checks: [], reason: 'smartbee-document-not-found' }
  const checks = [
    { name: 'agency', ok: row.agencyId === ctx.actor.agencyId, expected: ctx.actor.agencyId, actual: row.agencyId },
    { name: 'action', ok: row.agentActionId === action.actionId, expected: 'this action', actual: row.agentActionId === action.actionId ? 'same' : 'different' },
    { name: 'key', ok: row.providerMsgId === smartbeeProviderMsgId(row.environment, action.actionId), expected: 'derived from this action', actual: row.providerMsgId },
    { name: 'lead', ok: row.leadId === a.clientId, expected: a.clientId, actual: row.leadId },
    { name: 'amount', ok: Math.round(row.totalAmount * 100) === Math.round(a.amount * 100), expected: a.amount, actual: row.totalAmount },
    { name: 'type', ok: row.docType === a.docType, expected: a.docType, actual: row.docType },
    { name: 'customer', ok: row.requestSnapshot?.customer?.name === a.customerName && (row.requestSnapshot?.customer?.dealerNumber ?? null) === a.customerIdNumber, expected: 'the approved customer', actual: row.requestSnapshot?.customer?.name === a.customerName ? 'same' : 'different' },
    { name: 'recorded', ok: LIVE.has(row.status), expected: 'recorded for SmartBee', actual: row.status },
  ]
  const ok = checks.every((c) => c.ok)
  return { state: ok ? 'VERIFIED' : 'MISMATCH', verified: ok, checks, targetIds: [{ kind: 'smartbee_document', id: String(row.id) }], reason: ok ? null : 'postcondition-mismatch' }
}

async function verify(action: ActionProposal, execution: ExecutionResult, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = documentArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  const id = Number(execution.targetIds?.find((t) => t.kind === 'smartbee_document')?.id)
  if (!Number.isSafeInteger(id)) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'no-document-id' }
  return result(await findSmartbeeDocument(ctx.actor.agencyId, id), parsed.data, action, ctx)
}

async function probe(action: ActionProposal, ctx: ExecuteContext): Promise<VerificationResult> {
  const parsed = documentArgs.safeParse(action.args)
  if (!parsed.success) return { state: 'UNVERIFIABLE', verified: false, checks: [], reason: 'invalid-args' }
  return result(await findSmartbeeDocumentByAction(ctx.actor.agencyId, action.actionId), parsed.data, action, ctx)
}

/** APPROVAL_REQUIRED (an issued tax document cannot be deleted), plus an owner-only check that no risk level expresses. */
export const createSmartbeeDocumentAction: AgentActionDefinition = {
  type: 'create_smartbee_document',
  argsSchema: documentArgs as never,
  risk: 'APPROVAL_REQUIRED',
  requiresApproval: true,
  execute,
  verify,
  probe,
}
