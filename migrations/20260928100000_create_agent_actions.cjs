/**
 * Agent actions — the durable record of every action the Agent attempted.
 *
 * WHY A NEW TABLE. `agent_investigations` records what the Agent SAID; this
 * records what it TRIED TO DO, and the two have different lifecycles, different
 * cardinality (one investigation may propose several actions) and different
 * retention concerns. Folding actions into the investigation row would also mean
 * no unique key to claim, and the claim is the entire point.
 *
 * ONE ROW IS BOTH THE IDEMPOTENCY CLAIM AND THE AUDIT RECORD. Splitting them
 * would permit the state where a mutation is claimed but unaudited, or audited
 * but unclaimed — and every interesting failure in this system lives in exactly
 * that gap. The row is written before execution and updated after it, so a row
 * frozen at 'EXECUTING' is itself the evidence that a process died mid-mutation.
 *
 * THE UNIQUE INDEX IS THE GUARANTEE. ("agencyId","idempotencyKey") makes the
 * claim atomic under concurrency: `INSERT … ON CONFLICT DO NOTHING RETURNING *`
 * hands a row to exactly one of two simultaneous duplicates. `agencyId` is part
 * of the key rather than only part of the query, so two tenants deriving the
 * same key from the same arguments do not collide with each other.
 *
 * WHAT IS DELIBERATELY NOT STORED. No customer message text, no claim prose, no
 * provider or model identifier — the same boundary `agent_investigations` and
 * `ai_messages` already hold. `args` carries the normalised arguments an action
 * was invoked with, which is the minimum that makes an audit trail useful;
 * `evidenceRefs` carries references, never the sentences written around them.
 *
 * NOTHING EXECUTES YET. The action registry is empty by design in this phase, so
 * this table can only ever record refusals until domain actions are reviewed and
 * added. Additive and reversible; no existing table is touched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS agent_actions (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,                    -- authenticated scope, never a model value
      "userId" integer NOT NULL,                      -- the actor the action ran as
      "actionId" text NOT NULL,                       -- minted per proposal by the application
      "agentRunId" text NOT NULL,                     -- the investigation that proposed it
      "planId" text,                                  -- set when the action belongs to a batch
      "idempotencyKey" text NOT NULL,                 -- derived; see lib/agent/actions/idempotency.ts
      "actionType" text NOT NULL,                     -- registry key; a closed set in code
      args jsonb NOT NULL DEFAULT '{}'::jsonb,        -- canonicalised arguments
      "argsHash" text NOT NULL,                       -- what an approval is bound to
      risk text NOT NULL,                             -- READ | LOW_RISK_WRITE | APPROVAL_REQUIRED | HIGH_RISK
      "approvalState" text NOT NULL DEFAULT 'NOT_REQUIRED',
      "approvedByUserId" integer,
      "executionState" text NOT NULL DEFAULT 'PENDING',   -- PENDING|EXECUTING|SUCCEEDED|FAILED|NOT_EXECUTED|UNKNOWN
      "executionStatus" text,                             -- the executor's own verdict
      "verificationState" text NOT NULL DEFAULT 'NOT_ATTEMPTED',
      "verificationChecks" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "targetIds" jsonb NOT NULL DEFAULT '[]'::jsonb,     -- entities the action claims to have touched
      "evidenceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,  -- refs only, never claim text
      retryable boolean,                                  -- whether a prior failure was definitive
      "failureReason" text,                               -- machine-readable; never provider prose
      "timingsMs" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // THE CLAIM. One row per logical action per tenant, however many times it is retried.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS agent_actions_idempotency_uniq
      ON agent_actions ("agencyId", "idempotencyKey")`)

  // One action id resolves to one row, for approval flows that address it directly.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS agent_actions_action_uniq
      ON agent_actions ("agencyId", "actionId")`)

  // Agency-scoped audit read, newest first.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_actions_agency_created_idx
      ON agent_actions ("agencyId", "createdAt" DESC)`)

  // Every action proposed by one investigation.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_actions_run_idx
      ON agent_actions ("agencyId", "agentRunId")`)

  // The reconciliation queue: rows whose outcome is not known.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_actions_unresolved_idx
      ON agent_actions ("agencyId", "executionState")
      WHERE "executionState" IN ('EXECUTING', 'UNKNOWN')`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS agent_actions`)
}
