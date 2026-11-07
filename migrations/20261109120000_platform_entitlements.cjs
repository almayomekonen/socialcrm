/**
 * Founder entitlement (product decision 2026-11-07): a database-managed,
 * auditable, revocable grant of unlimited legitimate product usage to ONE
 * verified user of ONE agency. Additive and reversible.
 *
 *   platform_entitlements   one row per grant. Never edited: the only change a
 *                           row may ever receive is its single revocation
 *                           (revokedAt + revokedBy + revokeReason). A revoked
 *                           grant cannot be un-revoked; re-granting is a new row.
 *                           Direct DELETE is refused; a row goes only when its
 *                           agency or user is deleted (cascade).
 *
 * Also: owner_personal_reminder_events.type gains 'founder_limit_waived', the
 * audit record of a reminder limit (50 live / 30 per day) the grant bypassed.
 *
 * No grant is inserted here. Granting is a separate, reviewed data change.
 *
 * @param {import('knex').Knex} knex
 */
const EVENT_TYPES = [
  'proposed', 'scheduled', 'discarded', 'superseded', 'rescheduled', 'cancelled', 'claimed', 'dispatched', 'sent', 'failed',
  'unknown', 'text_purged', 'consent_granted', 'consent_withdrawn', 'opted_out', 'capacity_denied', 'kill_switch_tripped',
  'alert_threshold', 'pricing_unavailable', 'cost_released',
]
const typeCheck = (types) => `CHECK (type IN (${types.map((t) => `'${t}'`).join(',')}))`

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS platform_entitlements (
      id             bigserial PRIMARY KEY,
      "agencyId"     integer NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      "userId"       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entitlement    text NOT NULL CHECK (entitlement IN ('founder_unlimited_usage')),
      reason         text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
      "grantedBy"    text NOT NULL CHECK (char_length(btrim("grantedBy")) BETWEEN 1 AND 200),
      "grantedAt"    timestamptz NOT NULL DEFAULT now(),
      "revokedAt"    timestamptz NULL,
      "revokedBy"    text NULL,
      "revokeReason" text NULL,
      CHECK (("revokedAt" IS NULL AND "revokedBy" IS NULL AND "revokeReason" IS NULL)
          OR ("revokedAt" IS NOT NULL AND char_length(btrim("revokedBy")) > 0 AND char_length(btrim("revokeReason")) > 0))
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS platform_entitlements_one_active
      ON platform_entitlements ("agencyId", "userId", entitlement) WHERE "revokedAt" IS NULL`)

  await knex.raw(`
    CREATE OR REPLACE FUNCTION platform_entitlements_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        -- A cascade from the agency/user delete runs inside the RI trigger (depth 2).
        IF pg_trigger_depth() < 2 THEN
          RAISE EXCEPTION 'platform_entitlements %: rows are revoked, never deleted', OLD.id USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
      END IF;
      IF OLD."revokedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'platform_entitlements %: a revoked grant is final', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW."agencyId" IS DISTINCT FROM OLD."agencyId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
         OR NEW.entitlement IS DISTINCT FROM OLD.entitlement OR NEW.reason IS DISTINCT FROM OLD.reason
         OR NEW."grantedBy" IS DISTINCT FROM OLD."grantedBy" OR NEW."grantedAt" IS DISTINCT FROM OLD."grantedAt" THEN
        RAISE EXCEPTION 'platform_entitlements %: a grant is never edited, only revoked', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW."revokedAt" IS NULL THEN
        RAISE EXCEPTION 'platform_entitlements %: the only permitted change is the revocation', OLD.id USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)
  await knex.raw(`DROP TRIGGER IF EXISTS platform_entitlements_guard_trg ON platform_entitlements`)
  await knex.raw(`CREATE TRIGGER platform_entitlements_guard_trg BEFORE UPDATE OR DELETE ON platform_entitlements
      FOR EACH ROW EXECUTE FUNCTION platform_entitlements_guard()`)

  await knex.raw(`ALTER TABLE owner_personal_reminder_events DROP CONSTRAINT IF EXISTS owner_personal_reminder_events_type_check`)
  await knex.raw(`ALTER TABLE owner_personal_reminder_events ADD CONSTRAINT owner_personal_reminder_events_type_check
      ${typeCheck([...EVENT_TYPES, 'founder_limit_waived'])}`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DELETE FROM owner_personal_reminder_events WHERE type = 'founder_limit_waived'`)
  await knex.raw(`ALTER TABLE owner_personal_reminder_events DROP CONSTRAINT IF EXISTS owner_personal_reminder_events_type_check`)
  await knex.raw(`ALTER TABLE owner_personal_reminder_events ADD CONSTRAINT owner_personal_reminder_events_type_check ${typeCheck(EVENT_TYPES)}`)
  await knex.raw(`DROP TABLE IF EXISTS platform_entitlements`)
  await knex.raw(`DROP FUNCTION IF EXISTS platform_entitlements_guard()`)
}
