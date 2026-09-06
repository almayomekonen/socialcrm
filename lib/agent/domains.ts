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
 * WEB_RESEARCH IS DELIBERATELY ABSENT. There is no search tool, no HTTP egress,
 * and no external-evidence claim class, so naming the domain here would advertise
 * a route with nothing at the end of it — and the most likely consequence is an
 * agent that promises to look something up. When that capability is built it
 * arrives with its tools, its citation contract and its own trust rules, not
 * before.
 */
export const AGENT_DOMAINS = ['GENERAL', 'PRODUCT', 'CRM', 'BUSINESS_ADVICE', 'MIXED'] as const

export type AgentDomain = (typeof AGENT_DOMAINS)[number]

/** Domains that carry a business diagnosis. The others answer with `businessState: null`. */
export const BUSINESS_DOMAINS: readonly AgentDomain[] = ['CRM', 'BUSINESS_ADVICE', 'MIXED']
