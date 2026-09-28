-- Evaluation-fixture entitlement for socialcrm-agent-40.
--
-- LOCAL DEVELOPMENT DATABASE ONLY. Never run against production: no production
-- agency is an evaluation fixture, and `trialExempt` on a real one grants the
-- product away for free.
--
-- WHY trialExempt AND NOT plan='pro': `trialExempt` resolves to LEGACY in
-- lib/trial's state machine — "outside the trial lifecycle", which is what a
-- permanent evaluation tenant actually is. `plan='pro'` would assert these
-- agencies pay, which is false and would corrupt any revenue query counting pro
-- agencies. See ENTITLEMENT.md for the full reasoning.
--
-- WHY ALL FOUR AND NOT JUST B: A (56) and D (51) are on trials that expire
-- 2026-09-11. Restoring only B leaves the benchmark decaying on a three-day
-- timer.
--
-- Idempotent: re-running changes nothing.

BEGIN;

-- Guard: refuse on anything that is not the local development database.
DO $$
BEGIN
  IF current_database() NOT IN ('socialcrm', 'socialcrm_test') THEN
    RAISE EXCEPTION 'refusing to grant evaluation entitlement on database %', current_database();
  END IF;
END $$;

-- Guard: every id must already exist. A missing row means the fixture set moved
-- and this script is out of date — fail rather than grant nothing silently.
DO $$
DECLARE found int;
BEGIN
  SELECT count(*) INTO found FROM agencies WHERE id IN (56, 49, 41, 51);
  IF found <> 4 THEN
    RAISE EXCEPTION 'expected 4 evaluation agencies, found %', found;
  END IF;
END $$;

UPDATE agencies SET "trialExempt" = true WHERE id IN (56, 49, 41, 51);

SELECT id, plan, "trialExempt", "trialEndsAt"::date AS trial_ends
FROM agencies WHERE id IN (56, 49, 41, 51) ORDER BY id;

COMMIT;
