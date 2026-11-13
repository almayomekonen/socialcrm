# WhatsApp quotes: local validation harnesses

Both run only on this machine, against a local database whose name ends in
`_test`. Each run rebuilds that database. Neither is part of the default suite.

## Hebrew scenarios (H1–H19)

`__tests__/live/quote/`. Real WhatsApp path; Meta and the PDF step are replaced.

- Self-test, no key and no network:
  `NODE_ENV=test npx vitest run --config vitest.quote-live.config.ts`
- Real model: create `.env.quote-live.local` (git-ignored, `chmod 600`):

  ```
  QUOTE_LIVE_API_KEY=<dedicated key>
  QUOTE_LIVE_MODEL=<the exact model Production uses>
  QUOTE_LIVE_MAX_USD=8
  QUOTE_LIVE_REPEATS=1
  ```

  then `QUOTE_LIVE_MODE=model NODE_ENV=test npx vitest run --config vitest.quote-live.config.ts`.

`QUOTE_LIVE_SET=newcustomer` runs only the new-customer scenarios (N1–N6: a
customer who is not a lead yet, by name and phone, name only, phone only, with a
missing VAT basis, a phone that is already a lead, and "ליד חדש" to a list of
same-name leads), with H1, H5 and H7 beside them. N1 also runs the real PDF job
(renderer, R2 and the owner's message replaced locally) and requires the owner's
PDF preview. The scorer fails any reply that asks what name a lead is saved
under, and checks that an approved new-customer card made exactly one lead, by
that action, with the quote on it. Real model run on 2026-11-13 (gpt-5.6): 9 of
9, $0.57.

`QUOTE_LIVE_REPEATS=1` is one complete pass: every scenario, then the remaining
wordings of the ones that have several. The cap cannot exceed $8 and is enforced
before each request leaves the machine, counting input at the highest rate the
model can bill, so the provider's bill can only be lower. Only that file is read
for a key, and `QUOTE_LIVE_MODEL` must be named: the harness will not assume one. Results go to `node_modules/.cache/quote-live/`.

## Cloudflare and R2

`__tests__/live/cloud/`. Default is dry: local Chrome stands in for Cloudflare and
an in-memory store for R2, under the real client code.

`NODE_ENV=test npx vitest run --config vitest.quote-cloud.config.ts`

Real mode (`QUOTE_CLOUD_MODE=real`) needs separate approval, a test bucket and
`.env.quote-cloud.local`. See the header of `__tests__/live/cloud/env.ts`.

Real mode also fails unless the bucket is empty before and after the run. The
file must also set `QUOTE_CLOUD_MAX_RENDERS` (at most 20) and
`QUOTE_CLOUD_MAX_RETRIES` (at most 3), and the R2 limits `QUOTE_CLOUD_MAX_R2_UPLOADS`
(16), `_DELETES` (16), `_READS` (26), `_LISTS` (8) and `_OBJECTS` (16). There is no
default, and over a limit that operation no longer leaves the machine. One S3 call
is one HTTP attempt (`AWS_MAX_ATTEMPTS=1`).

The harness is paced for Workers Free (1 Browser Run request every 10 seconds, 10
browser minutes a day). Every request, retries included, starts at least 11 seconds
after the one before it, in dry runs too, so a complete dry run takes about 3
minutes more than the rendering itself and the guard suite 8 to 16 minutes.
`X-Browser-Ms-Used` is the browser time of that one request, so the harness adds
the values up and refuses every further request at 300 seconds. A response without
a usable value is charged its elapsed time, and a request with no response is
charged 60 seconds. Browser time already used on the account that day is not
visible to the harness.

**The bucket-scoped R2 token is the actual boundary against Production.** The
harness can see a bucket's name, not whose it is. Its checks (test name, confirmed
name, empty bucket, approved key prefixes) are backstops, so the token must be
limited to the one test bucket.

Rendered PDFs and page images are kept for review in the git-ignored
`.quote-cloud-artifacts/<mode>/`, with `INDEX.md` naming each scenario. They stay
on this machine. Remove them with `rm -rf .quote-cloud-artifacts`.

The harness's own walls are proved from outside, dry only:
`NODE_ENV=test npx vitest run --config vitest.quote-cloud-guard.config.ts`.

## Real `after()` and cron recovery

`__tests__/live/after/`. A real `next start`, with `serverGuard.cjs` preloaded and
an environment built by the test (nothing inherited). The server can reach only
loopback and the local `socialcrm_quotes_test`; Meta, R2 and the PDF renderer are
local fakes, and no model is called. It needs a build made under the same guard,
with placeholder values only:

```
NEXT_TELEMETRY_DISABLED=1 AFTER_ALLOW_HOSTS=fonts.googleapis.com,fonts.gstatic.com \
AFTER_REFUSALS_FILE=/tmp/build-refusals.log \
NODE_OPTIONS="--max-old-space-size=8192 --require $PWD/__tests__/live/after/serverGuard.cjs" \
node node_modules/next/dist/bin/next build
```

then `NODE_ENV=test npx vitest run --config vitest.quote-after.config.ts`.

The flags it sets exist only in that local server process and name one synthetic
agency. It proves the reply returns before the render starts, and that a server
killed mid-render is recovered by the real cron route. Vercel's 60-second limit
can only be observed on a real deployment.
