/**
 * Reminder Engine, Phase 3: storage for personal owner reminders
 * (architecture review v1.0–v1.6.1). Additive and reversible. Nothing reads or
 * writes these tables in production until later phases; every sending switch
 * stays absent.
 *
 *   owner_personal_reminders        one row per owner request (a draft until approved).
 *                                   Text is stored ONCE, here, and purged 90 days
 *                                   after a terminal state.
 *   owner_personal_reminder_events  append-only audit. Typed columns only: no
 *                                   free-text or JSON column can carry reminder text.
 *   owner_reminder_send_capacity    per-period counters for atomic send reservations.
 *
 * Also:
 *   - `timestampSource` on platform_whatsapp_inbound and wa_assistant_jobs.
 *     'meta' means a verified Meta timestamp; 'server' means the server-time
 *     fallback. NULL means unknown, which covers historical rows, and is never
 *     treated as verified.
 *   - wa_assistant_approvals: at most one pending token per recipient (every
 *     creation path), and one token for life per reminder action ('rem_…').
 *
 * DEFERRED, so not here: the rate-card table, the send-controls row, Meta
 * pricing columns and the `agent_investigations.surface` column. They belong
 * to later phases. `rateCardId` is a plain column until the rate-card table
 * exists; its foreign key is added then.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_personal_reminders (
      id                  bigserial PRIMARY KEY,
      "agencyId"          integer NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      "userId"            integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "recipientId"       bigint  NOT NULL REFERENCES owner_whatsapp_recipients(id) ON DELETE CASCADE,
      "leadId"            integer NULL REFERENCES clients(id) ON DELETE SET NULL,
      text                varchar(300) NULL,
      "textLength"        smallint NOT NULL,
      "remindAt"          timestamptz NOT NULL,
      timezone            text NOT NULL DEFAULT 'Asia/Jerusalem',
      "anchorMessageTs"   bigint NOT NULL,
      "sourceWamid"       text NOT NULL,
      status              text NOT NULL CHECK (status IN
                            ('proposed','scheduled','claimed','dispatching','sent','failed','unknown','cancelled','discarded')),
      version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
      attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      "nextAttemptAt"     timestamptz NULL,
      "claimToken"        uuid NULL,
      "claimedAt"         timestamptz NULL,
      "dispatchedAt"      timestamptz NULL,
      "sentAt"            timestamptz NULL,
      "cancelledAt"       timestamptz NULL,
      "finalizedAt"       timestamptz NULL,
      "draftExpiresAt"    timestamptz NULL,
      "textPurgedAt"      timestamptz NULL,
      channel             text NULL CHECK (channel IN ('text','template')),
      wamid               text NULL,
      "errorCode"         integer NULL,
      "errorScope"        text NULL CHECK ("errorScope" IN ('recipient','account','rate_limit','other')),
      "failureReason"     text NULL CHECK ("failureReason" IN ('window_closed','too_late','cap_recipient','cap_agency',
                            'cap_platform','cap_platform_month','cap_reminders_month','rate_limited','recipient_rejected',
                            'account_rejected','unverified_window','cost_controls_unconfigured','pricing_unavailable',
                            'monitor_stale','other')),
      "cancelReason"      text NULL CHECK ("cancelReason" IN ('owner','opted_out','consent_withdrawn',
                            'recipient_inactive','user_inactive','agency_no_access')),
      "discardReason"     text NULL CHECK ("discardReason" IN ('rejected','expired','superseded','due_passed','horizon',
                            'consent','forecast','lead_time','request_already_handled')),
      "createdByActionId" text NULL,
      "proposalActionId"  text NULL,
      "sourceJobId"       bigint NULL REFERENCES wa_assistant_jobs(id) ON DELETE SET NULL,
      "reservedMicros"    bigint NULL CHECK ("reservedMicros" >= 0),
      "rateCardId"        bigint NULL,
      "costReleasedAt"    timestamptz NULL,
      "createdAt"         timestamptz NOT NULL DEFAULT now(),
      "updatedAt"         timestamptz NOT NULL DEFAULT now(),
      CHECK ("textLength" BETWEEN 1 AND 300),
      CHECK (text IS NULL OR (char_length(text) = "textLength" AND position(E'\\n' in text) = 0)),
      CHECK (text IS NOT NULL OR "textPurgedAt" IS NOT NULL OR status = 'discarded'),
      CHECK ("remindAt" > "createdAt"),
      CHECK (status <> 'proposed'    OR "draftExpiresAt" IS NOT NULL),
      CHECK (status NOT IN ('scheduled','claimed') OR "nextAttemptAt" IS NOT NULL),
      CHECK (status <> 'claimed'     OR ("claimToken" IS NOT NULL AND "claimedAt" IS NOT NULL)),
      CHECK (status <> 'dispatching' OR "dispatchedAt" IS NOT NULL),
      CHECK (status <> 'sent'        OR (wamid IS NOT NULL AND "sentAt" IS NOT NULL AND "dispatchedAt" IS NOT NULL)),
      CHECK (status <> 'cancelled'   OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)),
      CHECK (status <> 'failed'      OR "failureReason" IS NOT NULL),
      CHECK (status <> 'discarded'   OR ("discardReason" IS NOT NULL AND "finalizedAt" IS NOT NULL)),
      CHECK (status NOT IN ('sent','failed','unknown','cancelled','discarded') OR "finalizedAt" IS NOT NULL)
    )
  `)
  // One inbound Meta message → at most one reminder request, for life (v1.4).
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS opr_source_uniq ON owner_personal_reminders ("recipientId","sourceWamid")`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS opr_one_draft_uniq ON owner_personal_reminders ("recipientId") WHERE status = 'proposed'`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS opr_action_uniq ON owner_personal_reminders ("agencyId","createdByActionId") WHERE "createdByActionId" IS NOT NULL`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS opr_wamid_uniq ON owner_personal_reminders (wamid) WHERE wamid IS NOT NULL`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_due_idx ON owner_personal_reminders ("nextAttemptAt") WHERE status = 'scheduled'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_claimed_idx ON owner_personal_reminders ("claimedAt") WHERE status = 'claimed'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_dispatching_idx ON owner_personal_reminders ("dispatchedAt") WHERE status = 'dispatching'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_owner_upcoming_idx ON owner_personal_reminders ("agencyId","userId","remindAt") WHERE status IN ('scheduled','claimed')`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_recipient_live_idx ON owner_personal_reminders ("recipientId", id) WHERE status IN ('proposed','scheduled','claimed')`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_drafts_idx ON owner_personal_reminders ("draftExpiresAt") WHERE status = 'proposed'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opr_purge_idx ON owner_personal_reminders ("finalizedAt") WHERE text IS NOT NULL`)

  // Immutability (v1.2 R8, v1.6). Cascades are DELETEs, so deletion stays possible.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION owner_personal_reminders_guard() RETURNS trigger AS $$
    BEGIN
      IF NEW."agencyId" IS DISTINCT FROM OLD."agencyId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
         OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR NEW."sourceWamid" IS DISTINCT FROM OLD."sourceWamid"
         OR NEW."anchorMessageTs" IS DISTINCT FROM OLD."anchorMessageTs" OR NEW."textLength" IS DISTINCT FROM OLD."textLength" THEN
        RAISE EXCEPTION 'owner_personal_reminders %: identity columns are immutable', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD."createdByActionId" IS NOT NULL AND NEW."createdByActionId" IS DISTINCT FROM OLD."createdByActionId" THEN
        RAISE EXCEPTION 'owner_personal_reminders %: createdByActionId is immutable once set', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD."createdByActionId" IS NULL AND NEW."createdByActionId" IS NOT NULL
         AND NOT (OLD.status = 'proposed' AND NEW.status <> 'proposed') THEN
        RAISE EXCEPTION 'owner_personal_reminders %: createdByActionId is set only when leaving proposed', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD."proposalActionId" IS NOT NULL AND NEW."proposalActionId" IS DISTINCT FROM OLD."proposalActionId" THEN
        RAISE EXCEPTION 'owner_personal_reminders %: proposalActionId is immutable once set', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.text IS DISTINCT FROM OLD.text AND NEW.text IS NOT NULL THEN
        RAISE EXCEPTION 'owner_personal_reminders %: text can only be purged, never changed', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.status = 'proposed' AND OLD.status <> 'proposed' THEN
        RAISE EXCEPTION 'owner_personal_reminders %: no transition back to proposed', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`)
  await knex.raw(`DROP TRIGGER IF EXISTS owner_personal_reminders_guard_trg ON owner_personal_reminders`)
  await knex.raw(`CREATE TRIGGER owner_personal_reminders_guard_trg
      BEFORE UPDATE ON owner_personal_reminders
      FOR EACH ROW EXECUTE FUNCTION owner_personal_reminders_guard()`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_personal_reminder_events (
      id               bigserial PRIMARY KEY,
      "agencyId"       integer NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      "userId"         integer NULL,
      "recipientId"    bigint  NULL,
      "reminderId"     bigint  NULL,
      type             text NOT NULL CHECK (type IN ('proposed','scheduled','discarded','superseded','rescheduled',
                         'cancelled','claimed','dispatched','sent','failed','unknown','text_purged','consent_granted',
                         'consent_withdrawn','opted_out','capacity_denied','kill_switch_tripped','alert_threshold',
                         'pricing_unavailable','cost_released')),
      "actorKind"      text NOT NULL CHECK ("actorKind" IN ('owner','system','settings','keyword','meta')),
      "actionId"       text NULL,
      "fromStatus"     text NULL,
      "toStatus"       text NULL,
      reason           text NULL CHECK (char_length(reason) <= 40),
      "versionAfter"   integer NULL,
      "remindAtBefore" timestamptz NULL,
      "remindAtAfter"  timestamptz NULL,
      "consentFrom"    text NULL CHECK ("consentFrom" IN ('v2','v3','v4','v5')),
      "consentTo"      text NULL CHECK ("consentTo" IN ('v2','v3','v4','v5')),
      "errorCode"      integer NULL,
      "capacityScope"  text NULL CHECK ("capacityScope" IN ('platform','agency','recipient')),
      "createdAt"      timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opre_reminder_idx ON owner_personal_reminder_events ("reminderId")`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS opre_agency_idx ON owner_personal_reminder_events ("agencyId","createdAt")`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS owner_reminder_send_capacity (
      "scopeKind"      text NOT NULL CHECK ("scopeKind" IN ('platform','agency','recipient','reminders_month','reminders_month_cost')),
      "scopeId"        bigint NOT NULL,
      "periodStart"    date NOT NULL,
      reserved         integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
      "reservedMicros" bigint NOT NULL DEFAULT 0 CHECK ("reservedMicros" >= 0),
      "updatedAt"      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("scopeKind","scopeId","periodStart")
    )
  `)

  // Timestamp provenance. NULL = unknown (historical rows): never verified.
  for (const table of ['platform_whatsapp_inbound', 'wa_assistant_jobs']) {
    await knex.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "timestampSource" text NULL`)
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_timestamp_source_check`)
    await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_timestamp_source_check CHECK ("timestampSource" IN ('meta','server'))`)
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS platform_whatsapp_inbound_verified_ts_idx
      ON platform_whatsapp_inbound ("fromHash", "messageTimestamp" DESC) WHERE "timestampSource" = 'meta'`)

  // Approvals (v1.6, v1.6.1). Refuse with a clear message rather than a raw
  // unique-index error when existing rows already break the rule.
  const { rows: dup } = await knex.raw(
    `SELECT count(*)::int AS n FROM (SELECT "recipientId" FROM wa_assistant_approvals WHERE status = 'pending' GROUP BY 1 HAVING count(*) > 1) d`,
  )
  if (dup[0].n > 0) throw new Error(`wa_assistant_approvals: ${dup[0].n} recipient(s) have more than one pending token; resolve before migrating`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS wa_approvals_one_pending_per_recipient
      ON wa_assistant_approvals ("recipientId") WHERE status = 'pending'`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS wa_approvals_reminder_action_uniq
      ON wa_assistant_approvals ("actionId") WHERE "actionId" LIKE 'rem\\_%'`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS wa_approvals_reminder_action_uniq`)
  await knex.raw(`DROP INDEX IF EXISTS wa_approvals_one_pending_per_recipient`)
  await knex.raw(`DROP INDEX IF EXISTS platform_whatsapp_inbound_verified_ts_idx`)
  for (const table of ['platform_whatsapp_inbound', 'wa_assistant_jobs']) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_timestamp_source_check`)
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "timestampSource"`)
  }
  await knex.raw(`DROP TABLE IF EXISTS owner_reminder_send_capacity`)
  await knex.raw(`DROP TABLE IF EXISTS owner_personal_reminder_events`)
  await knex.raw(`DROP TABLE IF EXISTS owner_personal_reminders`)
  await knex.raw(`DROP FUNCTION IF EXISTS owner_personal_reminders_guard()`)
}
