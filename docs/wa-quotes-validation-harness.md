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
