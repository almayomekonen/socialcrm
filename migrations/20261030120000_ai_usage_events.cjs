/**
 * AI usage ledger: ONE ROW PER PROVIDER REQUEST.
 *
 * A provider request is not a business event. One inbound WhatsApp message can
 * lead to several requests (summary, generation, regeneration, a fallback
 * provider, several Agent steps), so each row also names:
 *
 *   invocationId   one runStructured / generateText run / transcription:
 *                  groups its retries, fallbacks and steps
 *   operationKind  + operationId: the business operation behind it, e.g.
 *                  auto_response_job:123, conversation_analysis_job:45,
 *                  wa_assistant_job:9, agent_investigation:inv_…
 *
 * Cost is never silently zero: `costBasis` says whether `costUsd` was priced
 * from provider-reported usage, estimated, or is unknown (then costUsd is NULL
 * and `costNote` says why). `priceVersion` pins the price table used.
 *
 * Write-only in this phase; nothing reads it to decide anything. No message
 * text, prompt, phone number or credential is stored. `callId` is UNIQUE: the
 * idempotency key of one provider request.
 *
 * ADDITIVE: one new table, no foreign keys.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id bigserial PRIMARY KEY,
      "callId" text NOT NULL,
      "invocationId" text NOT NULL,
      "operationKind" text NOT NULL,
      "operationId" text NULL,
      "agencyId" integer NULL,
      "userId" integer NULL,
      "conversationId" bigint NULL,
      "leadId" integer NULL,
      feature text NOT NULL,
      provider text NOT NULL,
      "requestedModel" text NOT NULL,
      "responseModel" text NULL,
      "providerRequestId" text NULL,
      "chainIndex" integer NOT NULL DEFAULT 0,
      attempt integer NOT NULL DEFAULT 0,
      "stepIndex" integer NOT NULL DEFAULT 0,
      status text NOT NULL CHECK (status IN ('success','error','timeout','aborted')),
      "errorCode" text NULL,
      "finishReason" text NULL,
      "usageReported" boolean NOT NULL,
      "inputTokens" integer NULL,
      "uncachedInputTokens" integer NULL,
      "cachedInputTokens" integer NULL,
      "cacheWriteTokens" integer NULL,
      "outputTokens" integer NULL,
      "reasoningTokens" integer NULL,
      "webSearchCalls" integer NOT NULL DEFAULT 0,
      "audioSeconds" numeric(10,2) NULL,
      "costUsd" numeric(12,6) NULL,
      "costBasis" text NOT NULL CHECK ("costBasis" IN ('reported_usage','estimated','unknown')),
      "costNote" text NULL,
      "priceVersion" text NULL,
      currency text NOT NULL DEFAULT 'USD',
      "latencyMs" integer NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_usage_events_cost_basis_ck CHECK (("costUsd" IS NULL) = ("costBasis" = 'unknown'))
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_events_call_uniq ON ai_usage_events ("callId")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_usage_events_agency_idx ON ai_usage_events ("agencyId", "createdAt")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_usage_events_operation_idx ON ai_usage_events ("operationKind", "operationId")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON ai_usage_events ("createdAt")`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_usage_events`)
}
