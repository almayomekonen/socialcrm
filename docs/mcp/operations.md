# MCP operations: configuration, deployment, runbook

## Environment variables

| Variable                       | Required when         | Value / rule                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_ENABLED`                  | always (absent = off) | Exactly `1` enables MCP. Anything else — absent, `true`, ` 1` — is OFF and every MCP/OAuth endpoint answers 404. Read per request: changing it is the kill switch.                                                                                                            |
| `MCP_AGENCY_ALLOWLIST`         | MCP on                | `all`, or comma-separated agency ids. Empty = **no agency** (boot warns). Removing an agency stops its tokens on the next call and revokes its grants on the next refresh.                                                                                                    |
| `MCP_JWT_SECRET`               | MCP on                | Random, **≥ 32 characters**, and **different from `JWT_SECRET` and `MOBILE_JWT_SECRET`**. Signs access tokens and the pending-consent cookie. Rotating it invalidates every access token and pending consent immediately (refresh still works — refresh tokens are not JWTs). |
| `MCP_PUBLIC_ORIGIN`            | MCP on                | The bare public origin, e.g. `https://getsocialcrm.com` — no path, query or trailing segments. **HTTPS required in production** (http only on loopback outside production). Issuer, resource, metadata URLs, lead and inbox links are all built from it.                      |
| `MCP_TRUSTED_CLIENT_ID_HOSTS`  | optional              | Comma-separated exact hostnames allowed to host a CIMD `client_id`. Default `chatgpt.com,claude.ai`. IPs and loopback are ignored. Add a host only after reviewing that client.                                                                                               |
| `MCP_ALLOW_LOOPBACK_REDIRECTS` | never in production   | `1` allows `http://localhost` redirect URIs for local testing; ignored when `NODE_ENV=production`.                                                                                                                                                                            |
| `CRON_SECRET`                  | always (existing)     | Vercel Cron bearer secret; the retention sweep fails closed (500) without it.                                                                                                                                                                                                 |

In production a missing/short/shared `MCP_JWT_SECRET` or an invalid `MCP_PUBLIC_ORIGIN` **fails the boot** when `MCP_ENABLED=1` (`lib/startup/checkMcpAuthEnv.ts`); messages name the variable, never the value. Never paste secret values into tickets, logs or chat.

## Database

Four additive migrations (no existing table changed): `20261003000001_create_oauth_grants`, `…02_create_oauth_authorization_codes`, `…03_create_oauth_refresh_tokens`, `…04_create_mcp_audit_events`. Per the release workflow (§8b) they are applied **manually, before the deploy**, never by the build.

## Rollout order

1. **Migrations:** confirm with `npx knex --knexfile knexfile.cjs migrate:list`, then `npm run migrate` against the target `DATABASE_URL` (follow the release workflow pre-checks). Record the filenames.
2. **Environment:** set `MCP_JWT_SECRET`, `MCP_PUBLIC_ORIGIN`, (optionally) `MCP_TRUSTED_CLIENT_ID_HOSTS` and leave `MCP_ENABLED` unset/`0` and `MCP_AGENCY_ALLOWLIST` empty.
3. **Deploy the code.** With MCP off nothing new is reachable (all new endpoints 404); the Settings card is hidden; the sweep cron runs harmlessly.
4. **Enable for one internal agency:** `MCP_ENABLED=1`, `MCP_AGENCY_ALLOWLIST=<internal agency id>`.
5. **Verify discovery:** `GET /.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server` return 200 JSON with `https://` URLs on the production origin; `POST /api/mcp` `tools/list` without a token returns the seven tools; a request with an invalid bearer token returns 401 with a `WWW-Authenticate` header naming the PRM URL.
6. **Verify OAuth end to end** from Claude (custom connector) with a test user of the allowlisted agency: consent shows the client and redirect host, the connector completes, `tools/list` shows seven tools, a tool call succeeds, an `mcp_audit_events` row appears with the right `source`. Check one Vercel log line for the authorize request and confirm what the platform records (see [security.md](./security.md) → Logging). Disconnect from Settings and confirm the next call fails.
7. **Widen gradually:** add agencies to the allowlist one at a time; `all` only after observation.

## Rollback

- **Emergency disable:** set `MCP_ENABLED=0` (or remove it). Takes effect on the next request — every MCP/OAuth endpoint answers 404, every existing token stops working. No redeploy.
- **Per agency:** remove the id from `MCP_AGENCY_ALLOWLIST`.
- Active grants stay stored (re-enabling restores access without re-consent unless they were revoked); the retention sweep keeps running.
- No schema rollback is needed for an emergency disable. Migrations are additive; dropping the tables is a separate, deliberate decision.

## Retention sweep

`/api/cron/oauth-sweep`, daily 03:17 UTC (Vercel Cron, `Authorization: Bearer $CRON_SECRET`). Database clock. Deletes: codes > 1 day and expired; refresh tokens revoked > 30 days, used > 30 days and expired > 1 day, or never used and expired > 1 day; audit events > 180 days; revoked grants > 180 days with no remaining code/refresh/audit row (so the `ON DELETE CASCADE` on child tables never removes history). Batches of 5,000, up to 100 batches per table per run. Responds and logs counts only. Runs even when MCP is off.

## Runbook

Diagnose with request ids, outcomes and table counts — never print tokens, codes, hashes, `state` or secrets.

| Symptom                                                     | Likely cause                                                                                  | Check / action                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector cannot discover tools                             | MCP off, wrong origin, proxy                                                                  | Discovery URLs (rollout step 5). 404 → `MCP_ENABLED`. Wrong host in metadata → `MCP_PUBLIC_ORIGIN`. `tools/list` is public; if it fails the endpoint itself is down. |
| Authorize shows a local error page                          | Untrusted client host, CIMD fetch failed/invalid, unknown scope, wrong resource, missing PKCE | Client host in `MCP_TRUSTED_CLIENT_ID_HOSTS`? CIMD reachable and valid? `resource` must equal `${MCP_PUBLIC_ORIGIN}/api/mcp` exactly.                                |
| Invalid redirect URI (local error page, nothing redirected) | `redirect_uri` not byte-identical to one in the client's CIMD `redirect_uris`                 | Compare with the CIMD document. Never loosen matching.                                                                                                               |
| Token exchange `invalid_grant`                              | Code expired (120 s), already used, PKCE mismatch, grant no longer valid                      | A reused code revokes its grant by design; the user reconnects.                                                                                                      |
| Token exchange `invalid_client`                             | Client sent a secret/assertion                                                                | Only `none` is supported; the client must be configured as public.                                                                                                   |
| Grant revoked with `refresh_reuse`                          | A used refresh token was presented again (parallel refresh or theft)                          | By design — no grace window. User reconnects. If a client refreshes in parallel routinely, escalate as a client-compatibility issue; do not weaken rotation.         |
| User disconnected                                           | `revoked_reason = user_disconnect` on the grant                                               | Expected; reconnect from the client.                                                                                                                                 |
| Calls fail `feature_not_enabled`                            | Agency not allowlisted, or MCP off                                                            | `MCP_AGENCY_ALLOWLIST`.                                                                                                                                              |
| Calls fail `product_access_required`                        | Trial expired / no subscription                                                               | Billing; the tool returns a settings link.                                                                                                                           |
| Calls fail `server_error` after a tool ran                  | Audit insert failed (successful reads fail closed)                                            | Database health; `[mcp/audit] write failed` log with request id.                                                                                                     |
| `rate_limited`                                              | Per-grant/agency/message-read limits                                                          | `retryAfterSeconds` in the result; limits in `lib/mcp/rateLimit.ts`.                                                                                                 |
| Sweep 500 / 403                                             | `CRON_SECRET` missing / wrong header                                                          | Vercel env and cron configuration; nothing is deleted on failure.                                                                                                    |
| Need to stop everything now                                 | —                                                                                             | `MCP_ENABLED=0`.                                                                                                                                                     |
