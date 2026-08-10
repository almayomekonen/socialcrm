import type { SupportCategory } from './vocabulary'

/**
 * What SocialCRM already knows about the problem the customer is reporting.
 *
 * THE CENTRAL RULE: the client transmits a REFERENCE, never a payload.
 *
 * A contextual link carries `?ctx=integration:whatsapp:41`, which means
 * "please TRY to resolve integration 41". It never means "here is the context
 * you should trust". The server re-reads the underlying row scoped by the
 * SESSION's agencyId and builds the context itself; whether connection 41
 * belongs to the authenticated agency is the server's decision alone.
 *
 * That is the entire IDOR defence, and it is why context is a reference rather
 * than a serialised blob. Parsing a ref is NOT authorization — see the resolver
 * registry (Phase 4) for where the tenant check actually happens.
 *
 * The product reason all of this exists: a customer looking at a broken WhatsApp
 * connection should click "צריך עזרה?" and be done. They should never have to
 * tell us which connection, what state it is in, or when it broke — SocialCRM
 * already knows all three.
 */

export const SUPPORT_CONTEXT_KINDS = ['integration', 'lead', 'billing', 'route'] as const
export type SupportContextKind = (typeof SUPPORT_CONTEXT_KINDS)[number]

/**
 * One display line. BOTH fields are customer-facing text, never machine values:
 * a resolver may not stash an id or a technical reason in here "for support to
 * read" — the connection row already holds that.
 */
export type SupportContextFact = { label: string; value: string }

export type SupportContext = {
  kind: SupportContextKind
  ref: string
  facts: SupportContextFact[]
  category: SupportCategory
  subjectHint: string
}

/** The ONLY shape that may reach `support_requests.context`. */
export const PERSISTED_CONTEXT_KEYS = ['kind', 'ref', 'facts', 'category', 'subjectHint'] as const

export type PersistedSupportContext = Pick<SupportContext, (typeof PERSISTED_CONTEXT_KEYS)[number]>

/**
 * The one function permitted to produce a value for the `context` column.
 *
 * PROJECTS by the key list rather than spreading and deleting. A resolver that
 * starts returning a sixth field cannot leak it — the extra field is simply
 * never read. Deletion-based redaction fails open when a new field appears;
 * projection fails closed.
 *
 * `facts` are rebuilt field-by-field for the same reason: a fact object is not
 * trusted to contain only {label, value}.
 */
export function toPersistedContext(
  ctx: SupportContext | null,
): PersistedSupportContext | Record<string, never> {
  if (!ctx) return {}
  return {
    kind: ctx.kind,
    ref: ctx.ref,
    facts: (ctx.facts ?? []).map((f) => ({ label: f.label, value: f.value })),
    category: ctx.category,
    subjectHint: ctx.subjectHint,
  }
}

const MAX_REF_CHARS = 120
/**
 * Deliberately narrow: alphanumerics, dash and underscore only. Anything else is
 * REJECTED outright rather than escaped — a ref is machine-authored, so an
 * unexpected character means it was not authored by us.
 */
const SEGMENT = /^[a-z0-9_-]{1,40}$/i

export function formatContextRef(
  kind: SupportContextKind,
  subject: string,
  id: string | number,
): string {
  return `${kind}:${subject}:${id}`
}

export function parseContextRef(
  raw: string | null,
): { kind: SupportContextKind; subject: string; id: string } | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_REF_CHARS) return null

  const parts = raw.split(':')
  if (parts.length !== 3) return null

  const [kind, subject, id] = parts
  if (!(SUPPORT_CONTEXT_KINDS as readonly string[]).includes(kind)) return null
  if (!SEGMENT.test(subject) || !SEGMENT.test(id)) return null

  return { kind: kind as SupportContextKind, subject, id }
}
