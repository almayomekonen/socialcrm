/**
 * Turn `webhook_failures` from a write-only ledger into a recoverable queue.
 *
 * WHY. Both Meta webhooks answer HTTP 200 unconditionally — correctly, because a
 * non-2xx invites redelivery storms and lets Meta disable the subscription. The
 * consequence is that META NEVER RETRIES: every transient internal failure is
 * terminal. The only record was this table, written from six places, read from
 * none, with a `resolved` column nothing ever set. A paid lead lost to a Graph
 * 500 was gone, silently, forever.
 *
 * This adds the state a retry worker needs. The table keeps its existing shape
 * and its existing `resolved` boolean — nothing is renamed or dropped, so every
 * current writer keeps working untouched.
 *
 * `status` is the real lifecycle and is deliberately three-valued:
 *   pending  — eligible for another attempt
 *   resolved — the lead exists now (recovered, or it turned out to already exist)
 *   dead     — we stopped trying, and a human needs to know
 *
 * `dead` is NOT a synonym for `resolved`. Collapsing them is what makes a
 * dead-letter queue lie about how much it lost, which is the exact failure mode
 * this migration exists to end.
 *
 * `next_attempt_at` carries the exponential backoff. It defaults to `now()` so
 * rows written before this migration become immediately eligible for one
 * recovery pass rather than being stranded — those are real lost leads.
 *
 * `agency_id` is nullable because historical rows genuinely do not know theirs
 * (the writer only recorded `page_id`). The worker resolves it from the Page and
 * backfills. A NULL agency is never notified about — silence beats guessing a
 * tenant.
 *
 * Additive and reversible.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const add = async (col, ddl) => {
    const has = await knex.schema.hasColumn('webhook_failures', col)
    if (!has) await knex.raw(`ALTER TABLE webhook_failures ADD COLUMN ${ddl}`)
  }

  await add('status', `status text NOT NULL DEFAULT 'pending'`)
  await add('attempts', `attempts integer NOT NULL DEFAULT 0`)
  await add('max_attempts', `max_attempts integer NOT NULL DEFAULT 5`)
  await add('next_attempt_at', `next_attempt_at timestamptz NOT NULL DEFAULT now()`)
  await add('resolved_at', `resolved_at timestamptz`)
  await add('resolution', `resolution text`)
  await add('agency_id', `agency_id integer`)
  await add('last_error', `last_error text`)

  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE webhook_failures
        ADD CONSTRAINT webhook_failures_status_check
        CHECK (status IN ('pending','resolved','dead'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`)

  // The claim query: due, still retryable, oldest first.
  await knex.raw(`CREATE INDEX IF NOT EXISTS webhook_failures_claim_idx
      ON webhook_failures (status, next_attempt_at)
      WHERE status = 'pending'`)

  // The operational view: what has this agency lost, and when did we give up.
  await knex.raw(`CREATE INDEX IF NOT EXISTS webhook_failures_agency_status_idx
      ON webhook_failures (agency_id, status, created_at DESC)`)

  /**
   * IDEMPOTENCY. The same leadgen id can fail repeatedly across redeliveries and
   * each failure used to insert another row, so the queue would retry one lost
   * lead N times in parallel. One open row per (page, lead) makes the retry
   * unit the LEAD rather than the delivery.
   *
   * Partial on the two live states so a resolved/dead row never blocks a genuine
   * future failure of the same lead — a re-run of an old ad can legitimately
   * fail again months later.
   */
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS webhook_failures_open_lead_uniq
      ON webhook_failures (page_id, lead_id)
      WHERE status = 'pending'`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS webhook_failures_open_lead_uniq`)
  await knex.raw(`DROP INDEX IF EXISTS webhook_failures_agency_status_idx`)
  await knex.raw(`DROP INDEX IF EXISTS webhook_failures_claim_idx`)
  await knex.raw(`ALTER TABLE webhook_failures DROP CONSTRAINT IF EXISTS webhook_failures_status_check`)
  for (const col of [
    'status',
    'attempts',
    'max_attempts',
    'next_attempt_at',
    'resolved_at',
    'resolution',
    'agency_id',
    'last_error',
  ]) {
    const has = await knex.schema.hasColumn('webhook_failures', col)
    if (has) await knex.raw(`ALTER TABLE webhook_failures DROP COLUMN ${col}`)
  }
}
