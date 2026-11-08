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

Real mode also fails unless the bucket is empty before and after the run.

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
