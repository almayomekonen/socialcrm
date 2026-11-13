import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { getQuotaStatus } from '@/lib/quota'
import { leadsWithContact } from '@/lib/system/createLeadForOwner'
import { normalizeEmail, phoneCore } from '@/lib/leads/normalizeContact'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { offeredChoice, readable, whichLeadQuestion, type LeadOption } from '../leadChoice'
import { recordLeadChoice, type NewCustomerDraft } from '../request'
import { QUOTE_COPY } from './copy'

/**
 * A quote for a customer the Agent could not find as a lead. The application,
 * not the model, decides who the quote is for:
 *
 *   1. every detail the model passed is kept ONLY if the owner wrote it in this
 *      request (name words, the phone's digits, the email): nothing invented;
 *   2. a phone or email already on a lead of this agency → THAT lead, never a
 *      second one (none visible to this user → refused, nothing revealed);
 *   3. a lead the user may see with the same name → ONE question listing them,
 *      with "a new lead" as the last choice: the owner decides, we never guess;
 *   4. otherwise a new lead, and the only thing ever asked for is its name.
 *
 * Nothing is created here. The confirmed details are stored on the message
 * (request.ts) so a later answer (the VAT question, say) never asks again, and
 * the card the owner approves carries them; the lead is written only by the
 * approved `create_quote` action (lib/system/createLeadForOwner.ts).
 */

export type NewCustomer = { firstName: string; lastName: string; phone: string | null; email: string | null }
export type CustomerOutcome =
  | { lead: LeadOption }
  | { create: NewCustomer }
  | { ask: string; why: 'customer_name' | 'lead' }
  | { refused: 'contact_not_visible' | 'quota' | 'cannot_own'; text: string }

const MAX_NAME_MATCHES = 5
const NAME_WORD = /^[\p{L}][\p{L}'"׳״-]*$/u
const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const wordIn = (text: string, w: string) =>
  !!w && new RegExp(`(?:^|[^\\p{L}])[ולבשמה]?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)

/** Each part of a name, kept only when the owner wrote every word of it. */
function groundedName(value: string | null | undefined, said: string): string | null {
  const words = norm(value ?? '').split(' ').filter(Boolean)
  if (!words.length || words.length > 3 || !words.every((w) => NAME_WORD.test(w) && wordIn(said, w))) return null
  return (value ?? '').trim().replace(/\s+/g, ' ')
}
/** The phone, kept only when its digits appear in what the owner wrote (any spacing or dashes). */
function groundedPhone(value: string | null | undefined, said: readonly string[]): string | null {
  const core = phoneCore(value)
  if (!core) return null
  const runs = said.flatMap((m) => [...m.matchAll(/\+?\d[\d\s().-]{7,}\d/g)].map((r) => phoneCore(r[0])))
  return runs.includes(core) ? (value ?? '').trim() : null
}
function groundedEmail(value: string | null | undefined, said: string): string | null {
  const email = normalizeEmail(value)
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && said.includes(email) ? email : null
}

/** The first phone number written in the owner's request (9+ digits, any spacing), as written. */
function phoneIn(said: readonly string[]): string | null {
  for (const m of said) for (const r of m.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) if (phoneCore(r[0])) return r[0].trim()
  return null
}
function emailIn(said: string): string | null {
  return said.match(/[^\s@,;:()"']+@[^\s@,;:()"']+\.[a-z]{2,}/)?.[0] ?? null
}

/** A bare "דוד כהן" answering our "what is the customer's name?". */
function bareName(reply: string): { firstName: string; lastName: string | null } | null {
  const words = reply.trim().replace(/[.!]+$/u, '').split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 3 || !words.every((w) => NAME_WORD.test(w))) return null
  return { firstName: words[0], lastName: words.slice(1).join(' ') || null }
}

/** What the owner told us about the customer in this request: stored first, then what the model read, each grounded. */
export function customerDraft(input: { said: readonly string[]; proposed: NewCustomerDraft | null | undefined; stored: NewCustomerDraft | null; askedName: boolean }): NewCustomerDraft {
  const all = norm(input.said.join(' '))
  const p = input.proposed
  const draft: NewCustomerDraft = {
    firstName: input.stored?.firstName ?? groundedName(p?.firstName, all),
    lastName: input.stored?.lastName ?? groundedName(p?.lastName, all),
    // The owner's own words are enough for a contact detail, also when the model left it out.
    phone: input.stored?.phone ?? groundedPhone(p?.phone, input.said) ?? phoneIn(input.said),
    email: input.stored?.email ?? groundedEmail(p?.email, all) ?? groundedEmail(emailIn(all), all),
  }
  // The newest message answering "what is the name?" IS the name, whatever the model made of it.
  if (!draft.firstName && input.askedName) {
    const bare = bareName(input.said[0] ?? '')
    if (bare) {
      draft.firstName = bare.firstName
      draft.lastName = draft.lastName ?? bare.lastName
    }
  }
  return draft
}

/** Leads THIS user may see with this name: the same first name, and the same last name when one was given. */
async function sameName(scope: AgentScope, draft: NewCustomerDraft): Promise<LeadOption[]> {
  if (!draft.firstName) return []
  const q = db('clients').where({ agencyId: scope.agencyId }).whereRaw('lower(trim("firstName")) = ?', [norm(draft.firstName)])
  if (draft.lastName) q.whereRaw('lower(trim("lastName")) = ?', [norm(draft.lastName)])
  if (!isAdmin(scope.role)) q.whereIn('userId', scope.gotPermIds ?? [])
  const ids = ((await q.orderBy('id').limit(MAX_NAME_MATCHES).select('id')) as { id: number }[]).map((r) => Number(r.id))
  return readable(scope, ids)
}

export async function resolveNewCustomer(input: {
  scope: AgentScope
  job: WaAssistantJob
  said: readonly string[]
  proposed: NewCustomerDraft | null | undefined
  /** The new customer this request is already about (the owner chose "a new lead", or we asked for the name). */
  stored: NewCustomerDraft | null
  askedName: boolean
}): Promise<CustomerOutcome> {
  const { scope, job } = input
  const draft = customerDraft(input)

  // 2. A phone or email is a person: whoever already has it IS this customer.
  const withContact = await leadsWithContact(db, scope.agencyId, draft)
  if (withContact.length) {
    const visible = await readable(scope, withContact)
    if (!visible.length) return { refused: 'contact_not_visible', text: QUOTE_COPY.contactNotVisible }
    if (visible.length === 1) {
      await recordLeadChoice(job.id, { leadId: visible[0].id })
      return { lead: visible[0] }
    }
    // Two leads share the phone or email: the owner picks one; a new lead with it could not exist anyway.
    await recordLeadChoice(job.id, offeredChoice(visible))
    return { ask: whichLeadQuestion(visible), why: 'lead' }
  }

  // 3. Same name, and the owner has not already said it is someone new.
  if (!input.stored) {
    const named = await sameName(scope, draft)
    if (named.length) {
      await recordLeadChoice(job.id, offeredChoice(named, { allowNew: true, draft }))
      return { ask: whichLeadQuestion(named, true), why: 'lead' }
    }
  }

  // 4. A new lead. Its name is the one thing it cannot be created without.
  if (!draft.firstName) {
    await recordLeadChoice(job.id, { newLead: draft })
    return { ask: draft.phone || draft.email ? QUOTE_COPY.askNewCustomerNameKnownContact : QUOTE_COPY.askNewCustomerName, why: 'customer_name' }
  }
  // The new lead is this user's own; a role that cannot see its own leads (OFFICE) could not quote it.
  if (!isAdmin(scope.role) && !(scope.gotPermIds ?? []).includes(scope.userId)) return { refused: 'cannot_own', text: QUOTE_COPY.newLeadNotAllowed }
  const quota = await getQuotaStatus(scope.agencyId)
  if (quota.limit !== null && (quota.remaining ?? 0) <= 0) return { refused: 'quota', text: QUOTE_COPY.newLeadQuota }

  await recordLeadChoice(job.id, { newLead: draft })
  return { create: { firstName: draft.firstName, lastName: draft.lastName ?? '', phone: draft.phone, email: draft.email } }
}
