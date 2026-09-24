# First real validation — execution sequence

The order in which the first provider evidence is collected, owner-only
activation is switched on, and charging is validated later. Nothing here
bypasses a gate, and no step marks a gate passed in order to run a test.

## Where this stands

Two things that earlier reports got wrong, corrected here:

- **Deploying is not behaviourally inert.** Payment Links were removed, so
  purchasing behaviour changes the moment this ships, flags or no flags: the
  checkout is gone and the billing screen offers a card setup or says payments
  are unavailable. What the flags still hold back is the card wall on signup and
  automatic charging.
- **Pilot eligibility alone does not make a card save executable.**
  `CARD_TRIAL_PILOT_AGENCY_IDS` decides who is ASKED for a card. The callback
  that would activate a trial still runs through `verifyTokenSave`, which returns
  `unavailable` while `tokenSaveVerification` is closed — so the setup records a
  callback and activates nothing. Evidence comes first, in step 1.

## Step 1 — collect the first provider evidence (no application access)

`scripts/grow-sandbox-probe.ts`, which talks to Grow directly and touches no
application state: it writes no `billing_payment_methods` row, never calls
`confirmCardSetup`, and starts no trial. It sends `notifyUrl: ''`, so Grow does
not call the app at all.

Preconditions, enforced by `assertSandboxProbeEnvironment` before any request:
a gitignored 0600 env file, a gitignored state/evidence directory, and a
resolved base URL that IS the sandbox one (`resolved_base_url_not_sandbox`
otherwise).

```
npx tsx scripts/grow-sandbox-probe.ts create              # opens the hosted page
#   complete it with a SANDBOX TEST CARD in the browser
npx tsx scripts/grow-sandbox-probe.ts info <processId>    # read the saved result
```

**Correlation.** `create` returns `processId` + `processToken`; both are written
to the gitignored 0600 state file and re-read by `info`. The reference is
`probe-<timestamp>`. The customer-facing flow correlates the same way, by
`processId` plus a constant-time comparison of `processToken`.

**Contract validation.** `info` records only what the contract needs:
`statusCode`, `sum`, the SHAPE of `cardExp` (digits replaced by `N`), and
`cardTokenPresent` as a boolean. The question it answers is the one the gate
asks: *which statusCode means "token saved, nothing captured", and does
`getPaymentProcessInfo` return the token at all.*

**Evidence without exposing tokens.** Every record goes through an allowlist
sanitizer plus known-secret redaction into the gitignored `evidence.md`; the
Grow userId and page code are registered as secrets at startup. The card token
itself is never recorded — only whether one was present.

## Step 2 — owner-only verified trial activation

Only after step 1 has produced a real recorded observation.

**Code change** (reviewed and committed — deliberately not an env var, so it
cannot be flipped quietly), in `lib/payments/grow/providerEvidence.ts`:

```ts
tokenSaveVerification: {
  acceptedStatusCodes: ['<the code observed in step 1>'],
  evidenceRef: '<the evidence.md entry>',
}
```

That alone opens token-save verification. It does NOT open
`tokenChargeDispatch` or `tokenChargeReconciliation`, which stay `null`.

**Configuration**, in the environment Grow has confirmed the identifiers belong
to and nowhere else:

| Variable | Value |
|---|---|
| `GROW_USER_ID`, `GROW_PAGE_CODE_TOKEN` | the confirmed identifiers |
| `GROW_MODE` | matching that environment |
| `CARD_TRIAL_PILOT_AGENCY_IDS` | the owner's agency id, alone |
| `CARD_REQUIRED_TRIAL_ENABLED` | still unset |
| `SUBSCRIPTION_CHARGES_ENABLED` | still unset |

The owner then registers, is asked for a card, saves one, and the verified
callback starts the trial for that agency only. No charge is dispatched: the
dispatch gate is closed and charging is disabled independently.

## Step 3 — charge and reconciliation validation, later

Needs its own evidence and its own authorization, and must not be folded into
step 2.

1. Probe `charge` against a sandbox token (`sum` capped at `MAX_PROBE_SUM`) to
   observe the success shape and the duplicate-identifier refusal.
2. Record it and set `tokenChargeDispatch.evidenceRef`.
3. Probe `lookup` to observe the response of
   `getTokenTransactionsByExternalIdentifiers`, which Grow does not document.
4. **Implement the interpreter.** `growChargeReconciler` currently resolves its
   subject and returns `undetermined` — it cannot turn a response into
   `paid` / `not_charged` because the response shape is unknown. That code and
   its tests do not exist yet and are a genuine remaining dependency, not a
   configuration step.
5. Only then set `tokenChargeReconciliation.evidenceRef` and enable
   `SUBSCRIPTION_CHARGES_ENABLED`.

## Production preflight

Three migrations are pending **on this branch**, in filename order:

1. `20260916000001_create_billing_payment_methods.cjs` — CREATE TABLE
2. `20260916000002_create_billing_charges.cjs` — CREATE TABLE
3. `20260916000003_card_storage_consent.cjs` — two nullable ADD COLUMNs

**The production database has not been queried**, so this is what this branch
adds, not a verified production pending set. Run
`npx knex --knexfile knexfile.cjs migrate:list` against production and reconcile
before applying; if it disagrees, stop.

#3 is not optional: `createPendingPaymentMethod` writes those columns on every
insert, so code and migration ship together.
