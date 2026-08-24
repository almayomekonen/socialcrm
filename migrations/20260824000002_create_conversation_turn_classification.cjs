/**
 * Per-turn conversation classification log — the durable record of how the AI
 * Qualifier read each customer turn.
 *
 * WHY THIS TABLE EXISTS. Every classification the qualifier makes is currently
 * thrown away. `conversation_ai_state.qualification` keeps only the LATEST
 * `cognition.salesStrategy`, overwritten on the next turn; `salesMove`, the
 * response profile and `hotSignal` are persisted nowhere at all. The `waTrace`
 * checkpoints that carry them are `console.log` lines, so they survive only as
 * long as log retention. `conversation_intelligence` records temperature and a
 * summary but ONLY on escalation, and `qualify_draft_review` stores the draft
 * text without any classification field.
 *
 * The consequence is that no question about classifier behaviour over time is
 * answerable: whether a prompt change shifted the distribution of sales moves,
 * which profile precedes an escalation, how often a strategy switches
 * mid-conversation. Same shape as the lead status transition gap — a
 * latest-value overwrite with no history — and, in the same way, every day
 * without this table is history permanently lost.
 *
 * WRITTEN FROM EXACTLY ONE PLACE: the convergence point in
 * lib/inbox/autoresponse/qualifyWorker.ts, after the send/escalate decision is
 * final and before the draft / escalate / send branches split. All three
 * outcomes therefore record exactly one row, and the early exits — pre-generation
 * stop, control handoff, GPT-eligibility WAIT, generation failure, human typing —
 * record none, because the response profile and hot signal do not exist yet on
 * those paths.
 *
 * The write is observability only. Nothing in the send path reads this table, and
 * the call site wraps it so a failure here can never affect a customer message.
 *
 * IDEMPOTENCY. `triggerSequence` is the inbound message's `inbox_messages.sequence`
 * (unique per conversation), so ("conversationId","triggerSequence") names exactly
 * one customer turn. A job that fails is returned to 'pending' on the SAME row by
 * failAutoResponseJob, and a lease expiry does the same via
 * reclaimStaleAutoResponseJobs — so one turn can be processed more than once. The
 * unique index makes the first classification win; `jobId` and `attempt` are stored
 * so the rare divergent retry is attributable rather than invisible.
 *
 * NO CHECK CONSTRAINTS ON THE ENUM COLUMNS. `salesMove`, `salesStrategy` and the
 * profile fields are code-owned enumerations that grow with the classifier. A CHECK
 * here would turn adding a ninth sales move into a migrate-before-deploy ordering
 * problem — the exact failure mode that shipped conversation_ai_state without
 * 'closed'. The classifier is the authority; this table records what it said.
 *
 * `agencyId` is stored on the row so every read is agency-scoped without a join.
 * `leadId` is nullable because leadless Contact IRE conversations have no lead.
 *
 * Additive and reversible. Nothing reads from it yet.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS conversation_turn_classification (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "conversationId" bigint NOT NULL,
      "leadId" integer,                               -- null = leadless Contact IRE conversation
      "triggerSequence" integer NOT NULL,             -- inbound inbox_messages.sequence this turn answers
      "jobId" bigint NOT NULL,                        -- attribution: which auto_response_jobs row wrote this
      attempt integer NOT NULL,                       -- that job's attempt number when it classified
      "salesMove" text NOT NULL,                      -- deterministic classifier, never the LLM's salesMove
      "salesStrategy" text NOT NULL,
      tone text NOT NULL,                             -- response profile: this turn's register
      emotion text NOT NULL,
      urgency text NOT NULL,
      language text NOT NULL,
      "customerStyle" text NOT NULL,
      "establishedTone" text NOT NULL,                -- register established across the conversation
      vocative text,                                  -- bounded: 'אחי' | 'bro' | 'dude' | null
      "hotSignal" boolean NOT NULL,                   -- observability only; policy ignores LLM hotness
      uncertain boolean NOT NULL,                     -- model-emitted; validation failures resolved earlier
      decision text NOT NULL,                         -- 'send' | 'escalate'
      "escalationReason" text,                        -- null when decision='send'
      draft boolean NOT NULL,                         -- true = canary turn that was never sent
      "turnCount" integer NOT NULL,                   -- the turn number this classification produced
      model text,                                     -- generation model, when the provider reported one
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // Idempotency: one classification per customer turn, however many times the
  // job behind it is retried or reclaimed.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS conversation_turn_classification_turn_uniq
      ON conversation_turn_classification ("conversationId", "triggerSequence")`)

  // Agency-scoped time-series reads (move distribution, drift after a prompt change).
  await knex.raw(`CREATE INDEX IF NOT EXISTS conversation_turn_classification_agency_created_idx
      ON conversation_turn_classification ("agencyId", "createdAt" DESC)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS conversation_turn_classification`)
}
