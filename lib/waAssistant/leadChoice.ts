import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { BUSINESS_TZ } from '@/lib/today/constants'
import type { AgentScope, EvidenceRef } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { redactContactDetails } from './render'
import { pendingRequestKind, recordLeadChoice, requestLeadState, type NewCustomerDraft, type RequestKind, type RequestLeadState, type StoredLeadChoice } from './request'

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
/**
 * `missing`: no lead stored for this request and none proposed (only with `requireProposed`).
 * `newLead`: the owner said this request is for a customer who is not a lead yet
 * (only after a list that offered it, which only quotes show: ./quotes/newCustomer.ts).
 */
export type LeadChoice = { lead: LeadOption } | { ask: string } | { refused: true } | { missing: true } | { newLead: NewCustomerDraft }
const EMPTY_DRAFT: NewCustomerDraft = { firstName: null, lastName: null, phone: null, email: null }

const MAX_LISTED = 5
const ORDINALS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']
const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const hasWord = (text: string, w: string) =>
  !!w && new RegExp(`(?:^|[^\\p{L}])[ולבשמה]?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)

/** The leads of these ids THIS user may act on (agency + rep visibility), as options. */
export async function readable(scope: AgentScope, ids: number[]): Promise<LeadOption[]> {
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
  // A phone ending is 3-4 bare digits: never part of an amount ("1,500", "₪500", "500 שקל").
  const digits = [...text.matchAll(/(?<![\d,.₪])(\d{3,4})(?![\d]|[,.]\d|\s*(?:₪|ש["״'׳]?ח|שקל))/gu)].map((m) => m[1])
  const byPhone = options.filter((o): o is LeadOption => !!o?.phoneTail && digits.some((d) => o.phoneTail!.endsWith(d)))
  if (byPhone.length === 1) return byPhone[0]
  if (text.split(' ').length > 3 || /יום/u.test(text)) return null
  const m = /^(?:מספר\s+)?(?:את\s+)?[הל]?(ראשון|שני|שלישי|רביעי|חמישי|[1-5])(?:\s|$|[.!](?!\d))/u.exec(text)
  if (!m) return null
  const i = /\d/.test(m[1]) ? Number(m[1]) - 1 : ORDINALS.indexOf(m[1])
  return options[i] ?? null
}

/** "ליד חדש", "חדש", "לקוח חדש", "אף אחד", or the number after the last listed lead. */
const NEW_ANSWER = /^(?:זה\s+)?(?:[ול]?ליד\s+חדש|לקוח(?:ה)?\s+חדש(?:ה)?|חדש(?:ה)?|אף\s+אחד(?:\s+מהם)?|אף\s+אחת(?:\s+מהם)?|אחר(?:ת)?)[\s.!]*$/u
export function picksNewLead(answer: string, listed: number): boolean {
  const text = norm(answer)
  if (NEW_ANSWER.test(text)) return true
  const m = /^(?:מספר\s+)?(\d)[\s.!]*$/u.exec(text)
  return !!m && Number(m[1]) === Math.min(listed, MAX_LISTED) + 1
}

export function whichLeadQuestion(options: readonly LeadOption[], allowNew = false): string {
  const shown = options.slice(0, MAX_LISTED)
  const same = shown.every((o) => norm(o.name) === norm(shown[0].name))
  const label = (o: LeadOption) => redactContactDetails(o.name).trim() || 'ליד'
  // Look-alikes (same name, and the same or no phone ending) also show when the lead was created.
  const alike = (o: LeadOption) => shown.some((x) => x !== o && norm(x.name) === norm(o.name) && x.phoneTail === o.phoneTail)
  const head = same ? `יש ${options.length} לידים בשם ${label(shown[0])}:` : 'יש כמה לידים מתאימים:'
  const lines = shown.map(
    (o, i) => `${i + 1}. ${label(o)}${o.phoneTail ? `, טלפון שמסתיים ב-${o.phoneTail}` : alike(o) ? ', בלי מספר טלפון' : ''}${alike(o) && o.created ? `, נוצר ב-${o.created}` : ''}`,
  )
  if (allowNew) return [head, ...lines, `${shown.length + 1}. ליד חדש`, 'איזה מהם? אם זה לקוח אחר, כתבו "ליד חדש".'].join('\n')
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
  /**
   * Quotes only: the caller handles a customer who is not a lead yet
   * (./quotes/newCustomer.ts). Every list then ends in "a new lead", and carries
   * what the owner wrote about the customer (`newLeadDraft`) for that answer.
   */
  offersNewLead?: boolean
  newLeadDraft?: NewCustomerDraft
}

/** What the request already settled: a stored pick, a reply to the stored list, or that list again. Null when nothing is stored. */
async function fromStored(scope: AgentScope, state: RequestLeadState): Promise<{ choice: LeadChoice; shown?: LeadOption[]; offer?: { allowNew: boolean; draft: NewCustomerDraft | null } } | null> {
  if (state.leadId) {
    const [lead] = await readable(scope, [state.leadId])
    return { choice: lead ? { lead } : { refused: true } }
  }
  if (state.newLead) return { choice: { newLead: state.newLead } }
  if (!state.offered) return null
  const shown = await shownList(scope, state.offered)
  for (const answer of state.answers) {
    if (state.allowNew && picksNewLead(answer, shown.length)) return { choice: { newLead: state.draft ?? EMPTY_DRAFT } }
    const pick = selected(shown, answer)
    if (pick) return { choice: { lead: pick } }
  }
  const still = shown.filter((o): o is LeadOption => o !== null)
  // Not answered yet: the same list again, never a new one.
  if (!still.length) return state.allowNew ? { choice: { newLead: state.draft ?? EMPTY_DRAFT } } : { choice: { refused: true } }
  return { choice: { ask: whichLeadQuestion(still, state.allowNew) }, shown: still, offer: { allowNew: state.allowNew, draft: state.draft } }
}

/** The list as stored on the message that shows it: ids in order, and, for a new-lead offer, what the owner wrote about the customer. */
export function offeredChoice(shown: readonly LeadOption[], offer?: { allowNew: boolean; draft: NewCustomerDraft | null }): StoredLeadChoice {
  const options = shown.slice(0, MAX_LISTED).map((o) => o.id)
  return offer?.allowNew ? { options, allowNew: true, ...(offer.draft ? { draft: offer.draft } : {}) } : { options }
}

type NoNewLead = { newLead: NewCustomerDraft }
export async function chooseLead(input: ChooseLeadInput & { requireProposed: true; offersNewLead: true }): Promise<LeadChoice>
export async function chooseLead(input: ChooseLeadInput & { requireProposed: true; offersNewLead?: false }): Promise<Exclude<LeadChoice, NoNewLead>>
export async function chooseLead(input: ChooseLeadInput & { requireProposed?: false; offersNewLead?: false }): Promise<Exclude<LeadChoice, { missing: true } | NoNewLead>>
export async function chooseLead(input: ChooseLeadInput): Promise<LeadChoice> {
  const { scope, request } = input
  const keep = async (choice: LeadChoice, shown?: readonly LeadOption[], offer?: { allowNew: boolean; draft: NewCustomerDraft | null }): Promise<LeadChoice> => {
    if (!request) return choice
    if ('lead' in choice) await recordLeadChoice(request.job.id, { leadId: choice.lead.id })
    // The caller records the new customer itself, once it has read the details (./quotes/newCustomer.ts).
    else if ('ask' in choice && shown) await recordLeadChoice(request.job.id, offeredChoice(shown, offer))
    return choice
  }

  const stored = request ? await fromStored(scope, await requestLeadState(request.kind, request.job, input.said[0] ?? '')) : null
  // Only a quote request ever stores a new customer; anything else reading one is refused, never handed it.
  if (stored && 'newLead' in stored.choice && !input.offersNewLead) return { refused: true }
  if (stored) return keep(stored.choice, stored.shown, stored.offer)

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
  if (input.offersNewLead) {
    // The name the owner used for these leads, when they all share it: "a new lead" then needs no question about the name.
    const first = pool.every((o) => norm(o.first) === norm(pool[0].first)) && hasWord(said, norm(pool[0].first)) ? pool[0].first : null
    const draft: NewCustomerDraft = { ...(input.newLeadDraft ?? EMPTY_DRAFT) }
    if (!draft.firstName && first) draft.firstName = first
    return keep({ ask: whichLeadQuestion(pool, true) }, pool, { allowNew: true, draft })
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
export async function requestLead(job: WaAssistantJob, scope: AgentScope): Promise<{ kind: RequestKind; leadId: number } | { kind: RequestKind; newCustomer: true } | null> {
  const text = job.question?.trim() ?? ''
  if (job.kind !== 'text' || !text) return null
  const kind = await pendingRequestKind(job)
  if (!kind) return null
  const stored = await fromStored(scope, await requestLeadState(kind, job, text))
  if (stored && 'lead' in stored.choice) return { kind, leadId: stored.choice.lead.id }
  return stored && 'newLead' in stored.choice ? { kind, newCustomer: true } : null
}

/** The rule the Agent reads when the lead is already chosen. Ids only, no lead content. */
export const chosenLeadRule = (leadId: number) =>
  `- בבקשה הזו בעל העסק כבר בחר ליד: clientId ${leadId}. השתמש בו כ-clientId בפעולה, אל תחפש ליד אחר ואל תשאל שוב איזה ליד.`

/** The rule the Agent reads when this quote is for a customer who is not a lead yet. No customer content. */
export const newCustomerRule = `- בבקשה הזו הלקוח עוד לא ליד ב-SocialCRM, ובעל העסק כבר אישר שזה לקוח חדש. אל תחפש ליד ואל תשאל איזה ליד או באיזה שם הוא שמור: create_quote עם clientId 0, ו-newCustomer עם השם, הטלפון והאימייל שבעל העסק כתב בבקשה הזו (מה שלא נאמר: null).`
