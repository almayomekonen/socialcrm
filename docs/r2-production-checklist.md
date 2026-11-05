# R2 Production checklist

**Audience:** whoever prepares and runs the Production rollout.
**Background:** [cloudflare-r2-migration.md](./cloudflare-r2-migration.md). Each step below is done once, in this order, and the rollout does not start until the owner approves it. Never paste a secret into a ticket, a chat or this file.

## 1. Cloudflare

- [ ] **Bucket:** `socialcrm-files-production` exists and is not the Preview bucket.
- [ ] **Private:** Settings → Public access shows the `r2.dev` URL **disabled** and **no** custom domain.
- [ ] **R2 credentials:** an API token with **Object Read & Write**, scoped to this one bucket. A token for the Preview bucket must be refused on this one.
- [ ] **CORS:** exactly this policy, and no Preview origins:
  ```json
  [{ "AllowedOrigins": ["https://getsocialcrm.com", "https://www.getsocialcrm.com"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
  ```
- [ ] **Browser Rendering token:** a separate custom token with **Browser Run - Edit**, on this account only.
- [ ] **Plan:** decide Workers Free or Paid. Free allows 1 request per 10 seconds and 10 browser minutes per day. Paid removes the collision case, where renders that clash past one retry fail with `pdf_rate_limited`.

## 2. Vercel variables, Production scope only

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | The 32-character account ID |
| `R2_ACCESS_KEY_ID` | From the Production token |
| `R2_SECRET_ACCESS_KEY` | From the Production token; mark sensitive |
| `R2_BUCKET_NAME` | `socialcrm-files-production` |
| `CLOUDFLARE_BROWSER_RENDERING_API_TOKEN` | The Production token; mark sensitive |
| `PDF_RENDERER` | Exactly `cloudflare`. An entry already exists and its value can't be read, so re-enter it. |
| `PDF_RENDER_TIMEOUT_MS` | Unset, unless a value was chosen on purpose; capped at 55000 |
| `R2_PUBLIC_BASE_URL` | Unset |

- [ ] Do **not** remove the `AWS_*` or `S3_BUCKET_NAME` variables yet: the code running in Production today still reads them.
- [ ] Adding these changes nothing until the next deployment.

## 3. Neon restore

- [ ] In the Neon console, check the restore window for the `main` branch covers the rollout. Note its length.
- [ ] Immediately before migrating, record the current LSN:
  ```sql
  SELECT pg_current_wal_lsn(), now();
  ```
- [ ] Create no new branch (CLAUDE.md §16).

## 4. Axiom alerts

Create these monitors before the rollout, on the `vercel` dataset, which the Vercel drain writes to. All match log lines starting `[storage] <event>`.

| Monitor | Match | Fires when |
| --- | --- | --- |
| Storage down | `[storage] r2.error` | 5 or more in 5 minutes |
| Missing configuration | `[storage] config.missing` | Any |
| Renderer failing | `[storage] pdf.render.failed`, `[storage] pdf.render.timeout` | 3 or more in 15 minutes |
| PDF not stored | `[storage] pdf.upload.failed` | Any |
| Uploads failing | `[storage] upload.failed` | 5 or more in 15 minutes |
| Cleanup failing | `[storage] object.delete_failed` | 3 or more in 1 hour |

Watch `download.denied` by hand for the first days. Normal use produces some.

## 5. Migration

Apply by hand, from a clean checkout of the PR's commit, immediately before merging.

- [ ] Load the Production `DATABASE_URL` into the process environment, using the **direct** host, without `-pooler`. A process variable takes precedence over `.env.local`. Don't print it.
- [ ] Confirm exactly one pending migration:
  ```
  npx knex --knexfile knexfile.cjs migrate:list
  ```
  It must list only `20261105120000_files_url_app_route.cjs`. Anything else: stop.
- [ ] Apply only that migration:
  ```
  npx knex --knexfile knexfile.cjs migrate:up 20261105120000_files_url_app_route.cjs
  ```
  A lock timeout changes nothing: run it again.
- [ ] Confirm the new expression:
  ```sql
  SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a
  JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.files'::regclass AND a.attname = 'url';
  ```
  It must contain `/api/files/`.

## 6. Deploy and verify

- [ ] Merge straight after the migration, because `files.url` links answer 404 until the new code is live.
- [ ] Confirm `getsocialcrm.com` serves the merged commit.
- [ ] Anonymous `GET /api/files/1` and `GET /api/billing/invoice/1/download` answer 401.
- [ ] In an internal agency, with synthetic data: upload, open and download a file; upload from `www.getsocialcrm.com` too; issue an invoice, download its PDF, and email it to yourself.
- [ ] Confirm `[storage]` events reach Axiom and the objects are under `tenants/` in the bucket.
- [ ] Agencies with logos re-upload them: the old ones answer 410.

## 7. Rollback, in this order

1. **Application:** Vercel instant rollback to the deployment that was live before the merge. Uploads and PDFs then fail as they do today.
2. **Database, if the rollback will last:**
   ```
   npx knex --knexfile knexfile.cjs migrate:down
   ```
   Confirm first that this migration is the latest applied. It restores the exact previous `files.url` expression.
3. **Neon restore** only for damage nothing above can undo. It also discards every other Production write since the recorded LSN.

R2 objects stay in place through all of this. Files and invoices created after cutover return when the migration and code are re-applied.

## 8. Afterwards

- [ ] After a stable period, remove `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `S3_BUCKET_NAME`, `PDF_RENDER_TOKEN`, and `PDF_RENDER_URL`.
- [ ] Remove the `pdf.getsocialcrm.com` DNS record.
- [ ] Decide separately what to do with the AWS account and any stack left in it.
