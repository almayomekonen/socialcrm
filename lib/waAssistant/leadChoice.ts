import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { BUSINESS_TZ } from '@/lib/today/constants'
import type { AgentScope, EvidenceRef } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { redactContactDetails } from './render'
import { pendingRequestKind, recordLeadChoice, requestLeadState, type RequestKind } from './request'

/**
 * WHICH LEAD a meeting, task or follow-up is for — never guessed.
 *
 * The candidates are the leads the Agent read in this turn plus the one it
 * proposed, limited to what THIS user may act on (agency + rep visibility, the
 * bound every executor enforces). Of those, the ones the owner actually named
 * count; then:
 *   - one → that lead;
 *   - several → the owner's full name narrows it, or their answer to our
 *     question ("2", "השני", or the phone's last digits); otherwise ONE
 *     question listing each with its phone's last four digits;
 *   - none readable → refused.
 *
 * ONCE CHOSEN, KEPT (with `request`): the list we showed is stored by id, in the
 * order shown, on that message; "1" is read against THAT list, never against
 * whatever the Agent happens to read on the next turn. The chosen lead is stored
 * too, and every later message of the same request uses it: the Agent's own
 * `clientId` cannot replace it. A new request (request.ts) starts clean.
 */

export type LeadOption = { id: number; name: string; first: string; phoneTail: string | null; created: string | null }
/** `missing`: no lead stored for this request and none proposed (only with `requireProposed`). */
export type LeadChoice = { lead: LeadOption } | { ask: string } | { refused: true } | { missing: true }

const MAX_LISTED = 5
const ORDINALS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']
const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const hasWord = (text: string, w: string) =>
  !!w && new RegExp(`(?:^|[^\\p{L}])[ולבשמה]?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)

async function readable(scope: AgentScope, ids: number[]): Promise<LeadOption[]> {
  if (!ids.length) return []
  const q = db('clients').where({ agencyId: scope.agencyId }).whereIn('id', ids).orderBy('id')
  if (!isAdmin(scope.role)) q.whereIn('userId', scope.gotPermIds ?? [])
  const rows = (await q.select('id', 'firstName', 'lastName', 'phone', 'createdAt')) as {
    id: number
    firstName: string | null
    lastName: string | null
    phone: string | null
    createdAt: Date | string | null
  }[]
  return rows.map((r) => {
    const digits = (r.phone ?? '').replace(/\D/g, '')
    return {
      id: Number(r.id),
      name: [r.firstName, r.lastName].filter(Boolean).join(' '),
      first: r.firstName ?? '',
      phoneTail: digits.length >= 4 ? digits.slice(-4) : null,
      created: r.createdAt ? CREATED.format(new Date(r.createdAt)) : null,
    }
  })
}

const CREATED = new Intl.DateTimeFormat('he-IL', { timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit', year: 'numeric' })

/** The stored list, in the order it was shown; a lead this user can no longer see keeps its place, empty. */
async function shownList(scope: AgentScope, ids: readonly number[]): Promise<(LeadOption | null)[]> {
  const found = new Map((await readable(scope, [...ids])).map((o) => [o.id, o]))
  return ids.map((id) => found.get(id) ?? null)
}

/** "2" / "השני" / "1234" — the owner's answer to our list, from their newest message only. */
function selected(options: readonly (LeadOption | null)[], reply: string): LeadOption | null {
  const text = norm(reply)
  const digits = [...text.matchAll(/(?<!\d)(\d{3,4})(?!\d)/g)].map((m) => m[1])
  const byPhone = options.filter((o): o is LeadOption => !!o?.phoneTail && digits.some((d) => o.phoneTail!.endsWith(d)))
  if (byPhone.length === 1) return byPhone[0]
  if (text.split(' ').length > 3 || /יום/u.test(text)) return null
  const m = /^(?:מספר\s+)?(?:את\s+)?[הל]?(ראשון|שני|שלישי|רביעי|חמישי|[1-5])(?:\s|$|[.!])/u.exec(text)
  if (!m) return null
  const i = /\d/.test(m[1]) ? Number(m[1]) - 1 : ORDINALS.indexOf(m[1])
  return options[i] ?? null
}

export function whichLeadQuestion(options: readonly LeadOption[]): string {
  const shown = options.slice(0, MAX_LISTED)
  const same = shown.every((o) => norm(o.name) === norm(shown[0].name))
  const label = (o: LeadOption) => redactContactDetails(o.name).trim() || 'ליד'
  // Look-alikes (same name, and the same or no phone ending) also show when the lead was created.
  const alike = (o: LeadOption) => shown.some((x) => x !== o && norm(x.name) === norm(o.name) && x.phoneTail === o.phoneTail)
  const head = same ? `יש ${options.length} לידים בשם ${label(shown[0])}:` : 'יש כמה לידים מתאימים:'
  const lines = shown.map(
    (o, i) => `${i + 1}. ${label(o)}${o.phoneTail ? `, טלפון שמסתיים ב-${o.phoneTail}` : alike(o) ? ', בלי מספר טלפון' : ''}${alike(o) && o.created ? `, נוצר ב-${o.created}` : ''}`,
  )
  return [head, ...lines, 'איזה מהם?'].join('\n')
}

type ChooseLeadInput = {
  scope: AgentScope
  proposedId: number
  evidence: readonly EvidenceRef[]
  /** The owner's request, newest message first. */
  said: readonly string[]
  /** This message and its kind of request: the choice is stored on it and read back from the request. */
  request?: { job: WaAssistantJob; kind: RequestKind }
  /** The caller asks "which lead?" itself when nothing is stored and the Agent named none. */
  requireProposed?: boolean
}

/** What the request already settled: a stored pick, a reply to the stored list, or that list again. Null when nothing is stored. */
async function fromStored(scope: AgentScope, state: Awaited<ReturnType<typeof requestLeadState>>): Promise<{ choice: LeadChoice; shown?: LeadOption[] } | null> {
  if (state.leadId) {
    const [lead] = await readable(scope, [state.leadId])
    return { choice: lead ? { lead } : { refused: true } }
  }
  if (!state.offered) return null
  const shown = await shownList(scope, state.offered)
  for (const answer of state.answers) {
    const pick = selected(shown, answer)
    if (pick) return { choice: { lead: pick } }
  }
  const still = shown.filter((o): o is LeadOption => o !== null)
  // Not answered yet: the same list again, never a new one.
  return still.length ? { choice: { ask: whichLeadQuestion(still) }, shown: still } : { choice: { refused: true } }
}

export async function chooseLead(input: ChooseLeadInput & { requireProposed: true }): Promise<LeadChoice>
export async function chooseLead(input: ChooseLeadInput & { requireProposed?: false }): Promise<Exclude<LeadChoice, { missing: true }>>
export async function chooseLead(input: ChooseLeadInput): Promise<LeadChoice> {
  const { scope, request } = input
  const keep = async (choice: LeadChoice, shown?: readonly LeadOption[]): Promise<LeadChoice> => {
    if (!request) return choice
    if ('lead' in choice) await recordLeadChoice(request.job.id, { leadId: choice.lead.id })
    else if ('ask' in choice && shown) await recordLeadChoice(request.job.id, { options: shown.slice(0, MAX_LISTED).map((o) => o.id) })
    return choice
  }

  const stored = request ? await fromStored(scope, await requestLeadState(request.kind, request.job, input.said[0] ?? '')) : null
  if (stored) return keep(stored.choice, stored.shown)

  if (input.requireProposed && !(Number.isSafeInteger(input.proposedId) && input.proposedId > 0)) return { missing: true }
  const seen = input.evidence.filter((e) => e.kind === 'lead').map((e) => Number(e.refId))
  const ids = [...new Set([...seen, input.proposedId])].filter((n) => Number.isSafeInteger(n) && n > 0)
  const options = await readable(scope, ids)
  if (!options.length) return { refused: true }

  const said = norm(input.said.join(' '))
  const named = options.filter((o) => (o.name.includes(' ') && said.includes(norm(o.name))) || hasWord(said, norm(o.first)))
  const pool = named.length ? named : options
  if (pool.length === 1) {
    // Without a name match, the only candidate must be the one proposed.
    return named.length || pool[0].id === input.proposedId ? keep({ lead: pool[0] }) : { refused: true }
  }
  const full = pool.filter((o) => o.name.includes(' ') && said.includes(norm(o.name)))
  if (full.length === 1 && pool.filter((o) => norm(o.name) === norm(full[0].name)).length === 1) return keep({ lead: full[0] })
  if (!request && input.said.length > 1) {
    const pick = selected(pool, input.said[0])
    if (pick) return { lead: pick }
  }
  return keep({ ask: whichLeadQuestion(pool) }, pool)
}

/**
 * Before the Agent runs: the lead this message's pending request is already
 * about, decided by the application alone (a stored pick, or this reply read
 * against the stored list). The worker hands its id to the Agent as verified, so
 * the Agent neither searches again nor picks another lead. Null when nothing is
 * stored or the reply picks nothing.
 */
export async function requestLead(job: WaAssistantJob, scope: AgentScope): Promise<{ kind: RequestKind; leadId: number } | null> {
  const text = job.question?.trim() ?? ''
  if (job.kind !== 'text' || !text) return null
  const kind = await pendingRequestKind(job)
  if (!kind) return null
  const stored = await fromStored(scope, await requestLeadState(kind, job, text))
  return stored && 'lead' in stored.choice ? { kind, leadId: stored.choice.lead.id } : null
}

/** The rule the Agent reads when the lead is already chosen. Ids only, no lead content. */
export const chosenLeadRule = (leadId: number) =>
  `- בבקשה הזו בעל העסק כבר בחר ליד: clientId ${leadId}. השתמש בו כ-clientId בפעולה, אל תחפש ליד אחר ואל תשאל שוב איזה ליד.`
