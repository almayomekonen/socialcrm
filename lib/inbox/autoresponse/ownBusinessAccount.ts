/**
 * Which agency IS SocialCRM's own business account.
 *
 * The WhatsApp agent represents whatever business the conversation belongs to.
 * SocialCRM's own product facts — the capability catalogue in
 * `lib/product/capabilities` — are legitimate business facts for exactly one
 * tenant: the account SocialCRM uses to sell SocialCRM. For every other agency
 * they are another company's information and must never appear.
 *
 * This is the single predicate that draws that line. It exists as its own module
 * so the identity layer can ask the question without importing the product
 * catalogue, and so there is one place to change if the account ever moves.
 *
 * Empty env ⇒ no agency qualifies. That is the safe default: a misconfiguration
 * makes the agent speak only from the tenant's own saved information.
 */
export const OWN_BUSINESS_ACCOUNT_ENV = 'IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS'

function parseAllowlist(raw: string | undefined): 'all' | number[] {
  const v = (raw ?? '').trim()
  if (!v) return []
  if (v === 'all') return 'all'
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export function isOwnBusinessAccount(
  agencyId: number | null | undefined,
  envRaw: string | undefined = process.env[OWN_BUSINESS_ACCOUNT_ENV],
): boolean {
  if (!agencyId) return false
  const list = parseAllowlist(envRaw)
  if (list === 'all') return true
  return list.includes(agencyId)
}
