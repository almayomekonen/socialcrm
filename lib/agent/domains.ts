/**
 * The question domains the Agent routes between.
 *
 * ROUTING METADATA, NOT CAPABILITY. A domain says which source of truth a
 * question should be answered FROM — conversation, product knowledge, one lead,
 * or the business as a whole. It does not decide which tools run; the prompt's
 * per-domain guidance and the Budget do that.
 *
 * MIXED exists because the alternative was worse in both directions. Before it,
 * a question spanning two domains was silently collapsed into one — "האם כדאי לי
 * לשלם" became a product question and never looked at whether the business was
 * getting value, and "מה קורה בעסק ומה כדאי לשנות" became a CRM read that
 * stopped short of advising. MIXED names that case so each half is answered from
 * its own source.
 *
 * WHAT MIXED IS NOT: permission to call every tool. The failure it invites is a
 * model that reads "more than one domain applies" as "investigate everything",
 * turning a two-tool question into a six-tool one and spending the rep's wall
 * clock to say the same thing. Each domain contributes its own minimum; the
 * union of two minimums is not the union of every capability. The prompt states
 * this in those words and `__tests__/ai/agent/routing.test.ts` pins it.
 *
 * RESEARCH now exists, and it arrived under the conditions this file previously
 * set for it: a tool (OpenAI's hosted web search), a citation contract (the
 * `source` evidence ref), and its own trust rules (the SOURCED claim class, which
 * resolves only against pages the search actually consulted).
 *
 * IT IS A ROUTE, NOT A PERMISSION. The search tool is attached to the model only
 * when the routed domain admits it — see `domainAdmitsResearch`. A CRM question
 * cannot reach the web even if the model would like to, because the tool is not
 * in the set it was given. That is the difference between routing metadata and a
 * capability grant, and it is what keeps "search just in case" from becoming the
 * default on questions the database already answers.
 */
export const AGENT_DOMAINS = ['GENERAL', 'PRODUCT', 'CRM', 'BUSINESS_ADVICE', 'MIXED', 'RESEARCH'] as const

export type AgentDomain = (typeof AGENT_DOMAINS)[number]

/** Domains that carry a business diagnosis. The others answer with `businessState: null`. */
export const BUSINESS_DOMAINS: readonly AgentDomain[] = ['CRM', 'BUSINESS_ADVICE', 'MIXED']

/**
 * May this question reach the open web?
 *
 * RESEARCH is the question that is ABOUT the outside world. MIXED is admitted
 * because it is the domain that exists for questions spanning two sources of
 * truth, and "my leads slowed down — is something happening in my market?" is
 * exactly that shape: unanswerable from the database alone, and dishonest
 * answered from the web alone.
 *
 * CRM, PRODUCT and GENERAL are excluded on purpose. Each has a source of truth
 * that already answers it — rows, the product registry, or nothing at all — and
 * a search there costs the rep latency and money to produce a worse-grounded
 * answer. BUSINESS_ADVICE is excluded too: advice about THIS business is a
 * reading of its own data, and letting it wander onto the web is how generic
 * consulting prose gets presented as a diagnosis.
 */
export function domainAdmitsResearch(domain: AgentDomain): boolean {
  return domain === 'RESEARCH' || domain === 'MIXED'
}
