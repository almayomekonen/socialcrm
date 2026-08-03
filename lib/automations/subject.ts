import type { LeadFacts } from '@/db/automations/leadFacts'
import type { EventDefinition } from './catalog/types'
import type { FieldType } from './catalog/vocabularies'

/**
 * SUBJECT FIELD RESOLUTION — the one place that knows what a Lead is.
 *
 * Everything downstream asks for values BY CATALOG FIELD KEY: the condition
 * evaluator's live premise, the action's recipients, and the executor's own
 * variable substitution. None of them knows where a value comes from, and the
 * worker no longer carries a hand-written list per purpose.
 *
 * The engine's only subject is the Lead (the product's Entity Constraint), so
 * this file is small and will stay small. When a field is added to the `lead`
 * subject's catalog entry, its resolver is added here — subject-domain work,
 * not action work and not worker work.
 *
 * Resolution is LAZY and deduplicated: a caller asks for the keys it needs and
 * pays for exactly those. A premise on the lead's status costs nothing extra;
 * one on the business name costs one query, and only once per job.
 */

export type SubjectValues = Record<string, unknown>

/** What a resolver may reach for beyond the lead row itself. */
export type SubjectDeps = {
  agencyName: (agencyId: number) => Promise<string | null>
  repName: (userId: number | null) => Promise<string | null>
}

type Ctx = { agencyId: number; lead: LeadFacts; deps: SubjectDeps }

/**
 * One resolver per catalog field key of the `lead` subject. Adding a field to
 * the catalog without adding it here means the field simply has no value —
 * which the condition evaluator treats as undecidable and fails closed, and
 * which an executor sees as an unresolved variable. Never a wrong value.
 */
const RESOLVERS: Record<string, (c: Ctx) => Promise<unknown> | unknown> = {
  status: ({ lead }) => (lead.exists ? lead.currentStatus : null),
  email: ({ lead }) => (lead.exists ? lead.email : null),
  phone: ({ lead }) => (lead.exists ? lead.phone : null),
  leadFirstName: ({ lead }) => (lead.exists ? lead.firstName : null),
  leadName: ({ lead }) => (lead.exists ? lead.displayName : null),
  businessName: ({ agencyId, deps }) => deps.agencyName(agencyId),
  repName: ({ lead, deps }) => deps.repName(lead.exists ? lead.handlerId : null),
}

/** A memoised reader. Ask for anything, pay once, never twice. */
export function subjectResolver(agencyId: number, lead: LeadFacts, deps: SubjectDeps) {
  const ctx: Ctx = { agencyId, lead, deps }
  const cache = new Map<string, unknown>()

  return async function resolve(keys: readonly string[]): Promise<SubjectValues> {
    const out: SubjectValues = {}
    for (const key of keys) {
      if (!cache.has(key)) {
        const resolver = RESOLVERS[key]
        cache.set(key, resolver ? await resolver(ctx) : null)
      }
      out[key] = cache.get(key)
    }
    return out
  }
}

/**
 * The subject field an action's `requires` entry points at: the event's first
 * declared field of that type. `requires: ['email']` finds the event's email
 * field whatever it is called, so no layer has to name one.
 */
export function recipientFieldFor(event: EventDefinition | null, type: FieldType): string | null {
  return event?.fields.find((f) => f.type === type && f.lifecycle !== 'deprecated')?.key ?? null
}

/** Every subject key an action needs in order to have a recipient at all. */
export function recipientKeys(event: EventDefinition | null, requires: readonly FieldType[]): string[] {
  return requires.map((type) => recipientFieldFor(event, type)).filter((k): k is string => Boolean(k))
}
