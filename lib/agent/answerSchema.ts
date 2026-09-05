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

export const agentAnswerSchema = z.object({
  headline: z.string().min(1),
  claims: z.array(agentClaimSchema),
  unknown: z.string().nullable(),
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
