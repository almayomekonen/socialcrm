# Card-required trial — local demo walkthrough

A local, synthetic walkthrough of the whole card-trial experience in the real
application. **No Grow call is ever made and no card is ever charged**: a local
mock stands in for Grow's hosted page and its verification.

## What is real and what is simulated

| Real                                                                        | Simulated (local mock)                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The app's routes, components, server actions and database lifecycle         | Grow's hosted payment page (`/api/dev/grow-mock/pay`)                                   |
| `/api/payments/grow/notify` — the real parser, correlation and confirmation | The callback Grow would post (`/api/dev/grow-mock/callback` posts it to the real route) |
| Trial activation, charge rows, cancellation, analytics, emails              | The token-save verification result                                                      |
| The magic-link sign-in the product already uses                             | The "payment" rows for the declined / unknown / cancelled screens, inserted by the seed |

The mock is `lib/payments/grow/localMock.ts`. It needs **all three** of
`NODE_ENV !== 'production'`, `APP_ENV === 'local'` and `GROW_LOCAL_MOCK=true`,
so it cannot exist in a deployed app, and it never opens the
provider-evidence gates that govern the real integration.

## Start it

```bash
cd /Users/User/Documents/social-crm-card-trial

# once: an isolated local database (name must contain "demo")
createdb -h localhost socialcrm_card_demo_test
DATABASE_URL=postgres://$(whoami)@localhost:5432/socialcrm_card_demo_test NODE_ENV=test node scripts/bootstrap-schema.cjs
DATABASE_URL=postgres://$(whoami)@localhost:5432/socialcrm_card_demo_test NODE_ENV=test npx knex --knexfile knexfile.cjs migrate:latest

# the demo server, alongside whatever already runs on :3000
NEXT_DIST_DIR=.next-demo APP_ENV_FILE=.env.demo.local npx next dev -p 3002

# seed the scenarios and print one sign-in link each (magic links are single use)
DATABASE_URL=postgres://$(whoami)@localhost:5432/socialcrm_card_demo_test \
  APP_BASE=http://localhost:3002 npx tsx scripts/demo/seedCardTrialDemo.ts

# fresh links later, without rebuilding the data
LINKS_ONLY=1 DATABASE_URL=… APP_BASE=http://localhost:3002 npx tsx scripts/demo/seedCardTrialDemo.ts
```

`.env.demo.local` (gitignored) holds the demo database URL, `APP_ENV=local`,
`GROW_LOCAL_MOCK=true`, both feature flags on, and throwaway secrets.

## The scenarios

Each sign-in link logs into one synthetic agency. Open the link, then go to the
page named.

| #   | Scenario                                                   | Sign in as       | Then open                                                                             |
| --- | ---------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| 1   | Welcome modal: cardholder fields, disclosure, consent, CTA | `demo.welcome`   | `/dashboard` (modal opens by itself)                                                  |
| 2   | Card setup returned, awaiting server verification          | `demo.awaiting`  | `/billing/success?source=card_trial` (after ~30s it shows the bounded pending screen) |
| 3   | Verified active trial                                      | `demo.active`    | `/settings/update_payment`                                                            |
| 4   | Billing page: first-charge date, replace card, cancel      | `demo.active`    | `/settings/update_payment` → "החלפת כרטיס" / "ביטול לפני החיוב"                       |
| 5   | Expired trial → reactivation                               | `demo.expired`   | `/dashboard`                                                                          |
| 6   | Declined payment                                           | `demo.declined`  | `/dashboard`, then `/settings/update_payment`                                         |
| 7   | Payment in progress / outcome unknown                      | `demo.in-flight` | `/settings/update_payment`                                                            |
| 8   | Cancelled subscription                                     | `demo.cancelled` | `/settings/update_payment`                                                            |

**The full happy path** (scenario 1 → 2 → 3): sign in as `demo.welcome`, fill
the name and mobile, tick the consent, press "הוספת כרטיס והפעלת הניסיון". The
app opens the mocked Grow page (clearly labelled); press "אישור ושמירת הכרטיס"
and the mock posts a real callback to `/api/payments/grow/notify`. The return
screen then says the trial is active and names the first-charge date. The
"סימולציית סירוב אימות" button on that page shows the refused-setup screen
instead. Re-run the seed to reset `demo.welcome` to a fresh state.

## Emails (rendered, never sent)

```
http://localhost:3002/api/dev/email-automation-preview?automation=card_trial_started&agencyId=<id>
http://localhost:3002/api/dev/email-automation-preview?automation=card_trial_charge_reminder&agencyId=<id>
```

Use an agency id from the seed output (any card-trial one). The GET handler
renders the HTML only — it writes nothing and sends nothing.

## Removing it

```bash
kill <demo server pid>; dropdb -h localhost socialcrm_card_demo_test
rm -rf .next-demo .env.demo.local
```

The three code hooks it relies on (`distDir` via `NEXT_DIST_DIR`, the db env file
via `APP_ENV_FILE`, and the mock itself) are inert when those variables are
unset.
