import { z } from 'zod'

/**
 * The wire schema for one answer — the runtime mirror of the `Claim` union in
 * ./types.
 *
 * It is a DISCRIMINATED UNION on `claimClass`, with a differently-named evidence
 * field per class, for the same reason the TypeScript type is: if every class
 * carried one `evidence: string[]`, relabelling an inference as a fact would cost
 * the model a single string and only prose inspection could catch it. Here,
 * promoting a claim means moving its refs into a different field — and the
 * validator then checks those refs resolve to that KIND of evidence.
 *
 * The schema constrains SHAPE only. Whether a claim is supportable is decided by
 * lib/agent/validate.ts against the evidence actually collected; a payload that
 * parses cleanly here can still be dropped in full. That ordering is deliberate:
 * the model is allowed to propose, never to certify.
 *
 * `unknown` is nullable rather than optional so "I could not determine X" is an
 * explicit answer rather than an omission.
 */

const factClaim = z.object({
  claimClass: z.literal('FACT'),
  text: z.string().min(1),
  entityEvidence: z.array(z.string()),
})

const observationClaim = z.object({
  claimClass: z.literal('OBSERVATION'),
  text: z.string().min(1),
  metricEvidence: z.array(z.string()),
})

const inferenceClaim = z.object({
  claimClass: z.literal('INFERENCE'),
  text: z.string().min(1),
  evidence: z.array(z.string()),
})

const productClaim = z.object({
  claimClass: z.literal('PRODUCT'),
  text: z.string().min(1),
  productEvidence: z.array(z.string()),
})

const recommendationClaim = z.object({
  claimClass: z.literal('RECOMMENDATION'),
  text: z.string().min(1),
  evidence: z.array(z.string()),
})

/**
 * A PLAIN union, not `z.discriminatedUnion`, and that is a provider constraint
 * rather than a modelling choice.
 *
 * OpenAI Structured Outputs permits `anyOf` and explicitly forbids `oneOf`. Zod
 * emits `oneOf` for a discriminated union and `anyOf` for a plain one, so the
 * discriminated form made every OpenAI request fail schema validation before any
 * inference — `Invalid schema for response_format 'response': In
 * context=('properties','claims','items'), 'oneOf' is not permitted` — while
 * Anthropic, which accepts `oneOf`, had been fine with it.
 *
 * Nothing about the contract changes. The four variants keep their distinct
 * `claimClass` literals and their differently-named evidence fields, so parsing
 * still admits exactly the same payloads and rejects exactly the same ones. What
 * is given up is only zod's parse-time discriminator shortcut — an optimisation,
 * never a guarantee. The guarantee lives in lib/agent/validate.ts, which resolves
 * each class's refs against the evidence the tools actually collected.
 */
export const agentClaimSchema = z.union([
  factClaim,
  observationClaim,
  inferenceClaim,
  recommendationClaim,
  productClaim,
])

/**
 * The ONE thing the model may propose doing, as opposed to saying.
 *
 * IT IS A PROPOSAL AND NOTHING ELSE. Emitting this executes nothing: the payload
 * is parsed by `parseActionProposal`, which discards any identity it carries,
 * and then handed to the Action Runtime, which decides. A model that fills this
 * in has asked a question, not performed a mutation.
 *
 * CONCRETE, NOT GENERIC, and that is a provider constraint as much as a design
 * one. OpenAI Structured Outputs rejects an open `additionalProperties` record,
 * so `args` cannot be `z.record(...)` here; it must name its fields. Each
 * registered action therefore gets its own literal-tagged branch, and the union
 * below is a PLAIN one rather than `z.discriminatedUnion` for the reason stated
 * on `agentClaimSchema`: zod emits `oneOf` for the discriminated form and that
 * provider permits only `anyOf`.
 *
 * `evidenceRefs` is required for the same reason every claim carries evidence:
 * an action proposed on nothing is a guess about someone's business.
 */
const createTaskProposal = z.object({
  actionType: z.literal('create_task'),
  args: z.object({
    /** A lead id that appeared in a tool result. Never a name, never invented. */
    clientId: z.number(),
    title: z.string(),
    /** `YYYY-MM-DD`. The column stores no time of day. */
    dueDate: z.string(),
  }),
  /** Refs from this investigation — `lead:161`. The runtime records them. */
  evidenceRefs: z.array(z.string()),
})

const createFollowUpProposal = z.object({
  actionType: z.literal('create_follow_up'),
  args: z.object({
    clientId: z.number(),
    /** `YYYY-MM-DD`. SocialCRM follow-ups are a DAY, not a time. */
    at: z.string(),
    /** Nullable rather than optional — Structured Outputs drops optional keys. */
    note: z.union([z.string(), z.null()]),
  }),
  evidenceRefs: z.array(z.string()),
})

const createMeetingProposal = z.object({
  actionType: z.literal('create_meeting'),
  args: z.object({
    clientId: z.number(),
    title: z.string(),
    /** `YYYY-MM-DD` in the business timezone. */
    date: z.string(),
    /**
     * `HH:MM`, 24-hour, in the business timezone.
     *
     * A meeting is the ONE action where a time is really persisted — the row
     * holds `start_at`/`end_at` as instants and its own timezone. The task and
     * follow-up rule that time is not stored does not apply here.
     */
    startTime: z.string(),
    durationMinutes: z.number(),
    note: z.union([z.string(), z.null()]),
  }),
  evidenceRefs: z.array(z.string()),
})

/**
 * ONE action, applied to MANY leads the investigation actually found.
 *
 * The model chooses the set and the shared arguments; the application expands
 * that into N independent `create_task` proposals, each with its own identity,
 * its own idempotency key, its own policy check and its own verification. There
 * is no batch mutation — there is a plan made of ordinary actions.
 *
 * `targets` is a list of LEAD IDS, and every one of them has to appear in this
 * run's evidence (see `groundedBatch`). A batch is the most expensive place a
 * hallucinated id could land, because it lands N times.
 *
 * Only `create_task` for now. Batching a follow-up would overwrite dates reps
 * set by hand, and batching a meeting would put N events on a calendar — both
 * deserve their own review rather than arriving as a side effect of this one.
 */
const createTaskBatchProposal = z.object({
  actionType: z.literal('create_task'),
  /** Lead ids from tool results. Never names, never invented. */
  targets: z.array(z.number()),
  /** Shared by every task in the batch. */
  args: z.object({ title: z.string(), dueDate: z.string() }),
  evidenceRefs: z.array(z.string()),
})

export const agentAnswerSchema = z.object({
  headline: z.string().min(1),
  claims: z.array(agentClaimSchema),
  unknown: z.string().nullable(),
  /**
   * The business diagnosis. Nullable rather than optional for the same reason
   * `unknown` is: OpenAI Structured Outputs requires every property in
   * `required`, so an optional key would be dropped from the emitted schema and
   * the model would never be asked for it.
   *
   * A plain enum union rather than `z.enum(...).nullable()` so the emitted JSON
   * Schema stays `anyOf`-shaped, which is what that provider accepts.
   */
  businessState: z.union([z.literal('URGENT'), z.literal('AT_RISK'), z.literal('OPPORTUNITY'), z.literal('HEALTHY'), z.null()]),
  /**
   * Null for every question that is not an explicit instruction to create a
   * task — which is almost all of them. Nullable rather than optional for the
   * same reason `unknown` and `businessState` are: Structured Outputs requires
   * every property in `required`, so an optional key would be dropped from the
   * emitted schema and never asked for.
   */
  proposedAction: z.union([createTaskProposal, createFollowUpProposal, createMeetingProposal, z.null()]),
  /** Null unless the user asked for one action across several leads. */
  proposedBatch: z.union([createTaskBatchProposal, z.null()]),
})

/**
 * A NOTE ON `unknown`, because it looks like a bug and is not.
 *
 * Under zod 4.4.3 a property KEY named `unknown` is inferred as OPTIONAL —
 * `unknown?: string` — even though it is declared `.nullable()` and even when
 * written as an explicit `z.union([z.string(), z.null()])`. Sibling keys with the
 * identical declaration infer correctly, so this is specific to the key name.
 *
 * It does not weaken anything, because the inferred TS type is not the contract:
 *
 *   · What the MODEL is given is the generated JSON Schema, where `unknown` is
 *     listed in `required` with `anyOf: [string, null]` — verified, not assumed.
 *   · What the SYSTEM trusts is `validateAgentAnswer`, which re-checks the shape
 *     at runtime (`unknown` must be `null` or a string) and rejects the whole
 *     answer otherwise.
 *
 * So this file describes the shape asked for; lib/agent/validate.ts decides what
 * is accepted. The loop deliberately treats the model's output as untyped and
 * hands it straight to the validator, rather than casting it to `AgentAnswer`
 * and trusting a type the parser did not actually guarantee.
 */
