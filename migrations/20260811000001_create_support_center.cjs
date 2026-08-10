/**
 * First-party SaaS product support: the two tables behind /support and
 * /admin/support.
 *
 * The one relationship modelled here is SocialCRM customer ↔ SocialCRM platform
 * support. There is deliberately no assignment, no SLA, no priority and no
 * status-event log: those answer "which of our agents handled this", a question
 * a single-owner platform does not have. Each is additive later.
 *
 * Doctrine:
 *   - Additive only; reversible; drops in reverse FK order.
 *   - `createdByUserId` is ON DELETE SET NULL, never RESTRICT. actions/usersNteams.ts
 *     HARD-DELETES users rows; a RESTRICT FK here would make offboarding a teammate
 *     who once opened a request fail with a database error on a screen that has
 *     nothing to do with support. The requester snapshot is what keeps the thread
 *     answerable afterwards — the same reason sales_quotes snapshots its recipient.
 *   - support_messages."agencyId" is DEFENCE IN DEPTH, not the source of truth. It is
 *     always copied from the parent request row resolved under the tenant constraint
 *     in the same transaction; a caller never supplies the value that is written.
 *   - `context` holds ONLY the five public SupportContext keys (kind, ref, facts,
 *     category, subjectHint), produced by toPersistedContext(). Never a raw row,
 *     never a token, never resolver internals.
 *   - `attachments` is declared and never written in V1 — so materialising
 *     attachments later is a write, not a migration.
 *
 * UX NOTE — the asymmetric `body` rule, and where each half is enforced.
 *
 *   A CUSTOMER message MAY be empty. When SocialCRM has already resolved the
 *   context ("החיבור ל-WhatsApp נותק"), forcing the customer to retype what the
 *   system just told them is exactly the enterprise-helpdesk friction this
 *   feature exists to remove. The subject (always required) and the context
 *   snapshot carry the meaning.
 *
 *   A SUPPORT or SYSTEM message may NEVER be empty. An empty reply from us is
 *   not a message, it is a rendering bug that would read to the customer as
 *   silence dressed up as an answer.
 *
 * That asymmetry is the `support_messages_body_present` CHECK below.
 *
 * WHAT THE DATABASE DELIBERATELY CANNOT ENFORCE. "Empty is allowed only when a
 * valid context was resolved" is a PRODUCT rule, not a schema one — the row has
 * a `context` column, but a non-empty `context` on the parent request is not
 * proof that THIS message was created in that flow, and the check would have to
 * reach across tables to guess. So the database enforces the half it can state
 * exactly (support is never silent), and `lib/support/validation.ts` enforces
 * the half that depends on resolution having actually happened:
 *
 *     resolved context + empty body  → allowed
 *     no context      + empty body   → invalid_body
 *
 * Neither layer is a substitute for the other, and neither is redundant.
 *
 * @param {import('knex').Knex} knex
 */

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,

      -- Nullable + SET NULL: users rows are hard-deleted elsewhere in the product.
      "createdByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      -- Taken at creation so an orphaned request stays answerable.
      "requesterNameSnapshot" text NOT NULL DEFAULT '',
      "requesterEmailSnapshot" text NOT NULL DEFAULT '',

      subject text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('question','problem')),
      category text NOT NULL CHECK (category IN (
        'leads','whatsapp','meta','automations','ai',
        'billing','account','integrations','other')),
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_progress','waiting_for_customer','resolved')),

      context jsonb NOT NULL DEFAULT '{}'::jsonb,
      diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,

      "lastMessageAt" timestamptz,
      "lastMessageAuthorKind" text
        CHECK ("lastMessageAuthorKind" IN ('customer','support','system')),
      "resolvedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),

      -- A closed request must say when it closed. Reopening clears the timestamp
      -- in the SAME statement that changes the status, which is what keeps this
      -- satisfiable — see lib/support/status.ts.
      CONSTRAINT support_requests_resolved_requires_timestamp
        CHECK (status <> 'resolved' OR "resolvedAt" IS NOT NULL)
    )
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS support_requests_agency_created_idx
      ON support_requests ("agencyId", "createdAt" DESC)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS support_requests_agency_author_idx
      ON support_requests ("agencyId", "createdByUserId", "createdAt" DESC)
  `)
  // Partial: the owner inbox only ever scans unresolved requests.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS support_requests_open_idx
      ON support_requests ("lastMessageAt" DESC)
      WHERE status <> 'resolved'
  `)
  // The rate-limit read: "how many did this user open in the last hour?"
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS support_requests_author_created_idx
      ON support_requests ("createdByUserId", "createdAt" DESC)
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id bigserial PRIMARY KEY,
      "requestId" bigint NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
      -- Copied from the verified parent, never from a caller argument.
      "agencyId" integer NOT NULL,
      "authorKind" text NOT NULL
        CHECK ("authorKind" IN ('customer','support','system')),
      -- Stored for support replies too (internal attribution); NEVER rendered to
      -- the customer, who always sees "צוות SocialCRM".
      "authorUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      body text NOT NULL,
      attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),

      -- See the UX NOTE in this file's header. A customer's opening message may
      -- be empty because the resolved context can carry the meaning; a message
      -- FROM us never may.
      --
      -- The predicate is a regex, NOT length(btrim(body)) > 0. Single-argument
      -- btrim strips ONLY spaces, so a reply made of a newline and a tab
      -- survives it with length 2 and passes the check -- verified against this
      -- database before the constraint was written. The regex below asks the
      -- question that is actually meant: does this contain at least one
      -- non-whitespace character? It also cannot rot the way a hand-listed
      -- whitespace charlist does when someone forgets carriage return.
      CONSTRAINT support_messages_body_present CHECK (
        "authorKind" = 'customer' OR body ~ '[^[:space:]]'
      )
    )
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS support_messages_request_created_idx
      ON support_messages ("requestId", "createdAt")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS support_messages`)
  await knex.raw(`DROP TABLE IF EXISTS support_requests`)
}
