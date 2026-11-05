# File storage on Cloudflare R2, PDFs without AWS

**Audience:** whoever sets up Cloudflare and runs the deployment.
**Decision (2026-11-05):** existing AWS files are not preserved or copied. Business data stays.

## How it works

| Concern | Implementation |
| --- | --- |
| Storage | `lib/storage/objects.ts` is the only module that talks to R2, through the AWS SDK v3 as an S3 protocol client. |
| Reading a file | `files.url` is `/api/files/<id>`: session, tenant and lead checks, then a 60-second redirect to R2. |
| Uploading | Server chooses a `tenants/<agencyId>/uploads/<uuid>` key and signs a 60-second PUT bound to type and size. The browser PUTs to R2, then `addFiles` verifies the object before recording it. |
| Invoice PDF | `lib/pdf/renderer.ts` returns bytes, the app stores them, and the row goes `rendering` to `ready` or `failed`. No webhook. |
| Invoice download | `/api/billing/invoice/<id>/download`: login, agency and lead checks, then a 60-second redirect. |
| Invoice email | The PDF is **attached**. There is no public link. |
| AI image attachments | A 5-minute signed URL for the provider, created after the agency and lead query. |
| Logs | `[storage] <event>` lines, through the Vercel drain to Axiom. |

The bucket is **private**. Nothing in the app needs public access today.

**A custom domain is not needed for launch.** Cloudflare documents that presigned URLs work only on
`<account>.r2.cloudflarestorage.com`, not on custom domains, and that host shares no cookies with the
app. `R2_PUBLIC_BASE_URL` is only for a future, deliberately public asset, and because R2 public access
is per bucket, it must belong to a **separate** public bucket.

### Old data, explicitly

- `files` rows stay listed. Their paths have no `tenants/` prefix, so `/api/files/<id>` answers 410 with
  "לא ניתן להציג". Agency logos and promotion images in this state appear broken until re-uploaded.
- Current AWS invoice documents become `failed` / `legacy_storage_retired`, which shows the existing
  "render again" button. Legal invoice rows are untouched.
- Invoice links in emails already sent stay dead, because the AWS hostname cannot be redirected. Re-send
  the invoice if a customer needs it.
- `clients_info.ipuyFiles` may hold old absolute URLs. Nothing reads them, and they are left as they are.

## Checklist: Cloudflare setup (manual)

Repeat steps 1 to 4 for **Preview** and **Production**. Never share a bucket or a token between them,
because Preview deployments are reachable by more people than Production.

1. **Create a bucket.** R2 → Create bucket, for example `socialcrm-files-preview` and
   `socialcrm-files-production`. Choose a location hint or jurisdiction only after checking your data
   residency requirements.
2. **Keep it private.** Under Settings → Public access: leave the `r2.dev` URL **disabled** and add **no**
   custom domain.
3. **Create an API token.** R2 → Manage API tokens → Create: **Object Read & Write**, **scoped to that one
   bucket**. Copy the Access Key ID and Secret Access Key straight into Vercel, and nowhere else.
4. **Add CORS.** Under Settings → CORS policy. Add every browser origin that uploads. Production:
   ```json
   [{ "AllowedOrigins": ["https://getsocialcrm.com", "https://www.getsocialcrm.com"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
   `GET` is needed because the table PDF export draws an uploaded image onto a canvas. Both Production hostnames
   serve the app, so both upload. For Preview, list the exact Preview origin you are testing.
5. **Set up PDF rendering (default).** My Profile → API Tokens → Create a custom token with the **Browser Run -
   Edit** permission (Browser Run was formerly Browser Rendering), on this account only. Workers Free allows 1
   request per 10 seconds and 10 browser minutes per day, which is enough only at low invoice volume: renders that
   collide past one retry fail with `pdf_rate_limited` and show the retry button. Workers Paid removes that limit.
6. **Accept the renderer on Preview before Production**, using a synthetic invoice only. Check:
   Hebrew and RTL, a page break with repeated table headers, totals, legal text, and that a repeat render
   works. The endpoint in `lib/pdf/renderer.ts` is `/browser-run/pdf` (Cloudflare's current product docs). Its API
   reference still shows `/browser-rendering/pdf`, and without credentials both answer 401, so this step is what
   proves the choice. Hebrew is not a pre-installed font there, so the invoice embeds Noto Sans Hebrew as data URIs:
   check the PDF's fonts as well as how it looks. If this step fails, deploy `infra/gotenberg/` to a
   container host outside AWS and set `PDF_RENDERER=gotenberg`.

**Optional, only for a future public asset:** a separate public bucket, a custom domain on a dedicated
domain added to Cloudflare (`getsocialcrm.com` stays on its current DNS), then `R2_PUBLIC_BASE_URL`.

## Environment variables

Set per environment, with different values in Preview and Production.

| Variable | Required | Notes |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | Yes | The 32-character account ID. |
| `R2_ACCESS_KEY_ID` | Yes | From the bucket-scoped token. |
| `R2_SECRET_ACCESS_KEY` | Yes | Mark sensitive. |
| `R2_BUCKET_NAME` | Yes | The private bucket. |
| `R2_PUBLIC_BASE_URL` | No | Leave unset. Must be a separate public bucket's domain. |
| `PDF_RENDERER` | Yes | `cloudflare` or `gotenberg`. No default. |
| `CLOUDFLARE_BROWSER_RENDERING_API_TOKEN` | With `cloudflare` | Mark sensitive. |
| `PDF_RENDER_URL` | With `gotenberg` | `https://` base URL. |
| `GOTENBERG_API_BASIC_AUTH_USERNAME`, `GOTENBERG_API_BASIC_AUTH_PASSWORD` | With `gotenberg` | Also set on the container host. |
| `PDF_RENDER_TIMEOUT_MS` | No | Default 30000, capped at 55000. |

**Remove after a stable release:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`,
`S3_BUCKET_NAME`, `PDF_RENDER_TOKEN`. Nothing reads them.

A missing variable fails with an error naming it. There is no AWS fallback.

## Deployment sequence

Production migrations are applied by hand, before the deploy, following
`claude/release-deployment-workflow.md` §8b.

1. Complete the Cloudflare checklist for Preview, and set Preview's variables.
2. Deploy the branch to Preview, then apply only this migration to the shared Preview database, using no new Neon
   branch (CLAUDE.md §16): `npx knex --knexfile knexfile.cjs migrate:up 20261105120000_files_url_app_route.cjs`.
   Read "Shared Preview database" below first.
3. Test on Preview with synthetic data: upload, open, delete; try another agency's file ID; an issued invoice
   renders and downloads; the invoice email arrives with the PDF attached; an old file answers 410.
4. Complete the checklist for Production, and set Production's variables.
5. Check for anything unexpected in Production: `npx knex --knexfile knexfile.cjs migrate:list` must list only
   this migration as pending. Other pending migrations belong to other work; stop and review them.
6. Apply the migration to Production. It rewrites `files` under a brief exclusive lock. Old code keeps serving
   until step 7, and `files.url` links answer 404 in that gap, so keep the gap short.
7. Merge and deploy. Confirm the live build is the expected commit.
8. Verify with one synthetic file and one synthetic invoice in an internal agency, then remove them.
9. Watch Axiom, then remove the AWS variables. Close the AWS account separately, whenever you decide.

### Shared Preview database

`preview-shared` serves every preview deployment, and it is a copy of production data. The migration is safe for its
data (no row is deleted, and it reverses), but it affects other branches:

- Every other preview's file links answer 404 until that branch has this code. Their AWS files are unreachable today
  either way.
- Knex refuses to run on a database that records a migration whose file is missing. Until this branch merges, any other
  branch running `migrate` against `preview-shared` fails with a missing-file error. Roll back with `migrate:down` if
  this branch is abandoned.
- It may have other migrations pending. `migrate:up <name>` applies only this one; `migrate` would apply them all.

Before applying to any database, check that nothing else depends on the column. Views fail the migration loudly, but
an index would be dropped silently:
`SELECT indexdef FROM pg_indexes WHERE tablename = 'files' AND indexdef ILIKE '%url%';`

If the migration fails with a lock timeout, nothing changed: run it again when the database is quieter.

## Rollback

- **Application:** Vercel instant rollback to the previous deployment. That returns to the disabled AWS paths,
  so uploads and PDFs fail as they did before.
- **Database:** run this migration's `down` (`npx knex --knexfile knexfile.cjs migrate:down`). It restores the
  exact previous `files.url` expression and the invoice document rows. Roll back the app first.
- **New files:** stay in R2, untouched. Their rows would not resolve on old code; re-applying the migration and
  redeploying restores them.
- **Renderer:** switching `PDF_RENDERER` is a variable change plus a redeploy.

## Axiom

Events are JSON after the `[storage]` prefix, from a closed field list with no URL, key or filename field.

| Watch | Event |
| --- | --- |
| Storage down | `r2.error` |
| Missing configuration | `config.missing` |
| Uploads failing in the browser | `upload.failed` |
| Probing or broken access | `download.denied` |
| Renderer problems | `pdf.render.failed`, `pdf.render.timeout` |
| Stored successfully | `pdf.upload.completed`, `upload.completed` |
| Renders that died | `pdf.stale_render_closed` |
| Objects left behind by a failed delete | `object.delete_failed` |

## Orphaned objects

- Deleting a file, a task or a lead removes its objects, once no other row points at them. This happens after the
  database commits, so a rollback costs no file. If R2 refuses, the delete still succeeds and `object.delete_failed` is
  logged.
- A batch upload that fails partway, or a closed browser, can leave an uploaded object with no row. Nothing removes
  those automatically.
- `npx tsx --conditions=react-server scripts/r2-orphan-report.ts` counts objects with no row, older than 24 hours. It
  only reports. Deleting what it finds is a separate decision, and no tool for it exists.

## Known limits

- Invoice HTML is processed by the chosen renderer's provider. Check this against your privacy terms.
- A `rendering` row on an invoice nobody opens stays `rendering` in the database until the invoice is next opened or
  re-rendered. Nothing is blocked by it, and the first status check closes it.
- `actions/auth.ts` still logs user email addresses at login. It is outside this migration.
