# OAuth 2.1 authorization server

SocialCRM is both the **authorization server** and the **protected resource** for its MCP endpoint. Everything is behind `MCP_ENABLED === '1'`; when it is off every endpoint below answers 404.

## Endpoints

| Endpoint                                                                                          | Purpose                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource/api/mcp` (and `/.well-known/oauth-protected-resource`) | RFC 9728 Protected Resource Metadata: `resource` = `${MCP_PUBLIC_ORIGIN}/api/mcp`, `authorization_servers` = [issuer], `scopes_supported`.                                                                                                                                                                                                                              |
| `GET /.well-known/oauth-authorization-server`                                                     | RFC 8414 metadata: authorize/token/revocation endpoints, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`. |
| `GET /api/oauth/authorize`                                                                        | Validates the request and starts consent.                                                                                                                                                                                                                                                                                                                               |
| `GET /oauth/consent` · `POST /api/oauth/consent`                                                  | The consent screen and its decision.                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/oauth/token`                                                                           | `authorization_code` and `refresh_token` grants.                                                                                                                                                                                                                                                                                                                        |
| `POST /api/oauth/revoke`                                                                          | RFC 7009 revocation of a refresh token (revokes its family).                                                                                                                                                                                                                                                                                                            |

Discovery documents are `cache-control: no-store` and built per request, so the kill switch takes effect immediately. The proxy lets exactly these well-known paths through without a session.

## Client trust: CIMD, no DCR

`client_id` must be an HTTPS URL of a **Client ID Metadata Document** on an allowlisted host (`MCP_TRUSTED_CLIENT_ID_HOSTS`, default `chatgpt.com,claude.ai`). Matching is on the exact hostname — no subdomains, no look-alikes, no IPs or loopback, no userinfo, no explicit port, no query/fragment, and the URL must be byte-identical to its WHATWG form.

The fetch (`lib/oauth/server/cimd.ts`) is a single-purpose, bounded fetcher, never a generic URL fetcher: HTTPS only, at most 2 redirects each re-validated against the allowlist, a 5 s deadline for the whole fetch, a 64 KB body cap, a strict schema (`client_id` must equal the URL, `redirect_uris` required, `token_endpoint_auth_method` must allow `none`), and a bounded cache (default 10 min, at most 1 h, 50 entries). Any failure fails closed with a local error page — the request is never redirected anywhere before the client and redirect URI are trusted.

Observed documents: Claude `https://claude.ai/oauth/mcp-oauth-client-metadata` (auth method `none`; also lists a JWT bearer grant, which is ignored); ChatGPT `https://chatgpt.com/oauth/client.json` (auth methods `none`, `private_key_jwt`; only `none` is accepted).

## Authorization request

Required: `response_type=code`, `client_id` (CIMD URL), `redirect_uri` (exact string match against the CIMD `redirect_uris`), `code_challenge` (S256, 43 base64url chars), `code_challenge_method=S256`, `resource` (must be this server's MCP resource, matched as a string — no URL normalisation), `state`. `scope` is optional (defaults to all Phase A read scopes); unknown scopes are rejected. Every security-sensitive parameter appearing twice is rejected.

Errors before the redirect URI is trusted render a local page; errors after it redirect to the client with `error`, `state` and `iss`. **Every** authorization response — success and error — goes through one builder (`buildAuthorizationRedirect`) that always adds `iss` (RFC 9207).

### Pending request and login resume

The validated request is stored in a signed, `HttpOnly`, `SameSite=Lax`, `Secure` cookie (`scrm_oauth_pending`, JWT `typ: oauth-pending+jwt`, 10 minutes) — never in a URL. If the user is not signed in they go through the normal SocialCRM login; afterwards they land on the fixed internal path `/oauth/consent` (no `returnTo`, no external target). The login model, session cookie and `sessionVersion` semantics are unchanged.

### Consent

The consent page names the client (from its CIMD), the redirect host, the user and agency, and the requested scopes in Hebrew, and states what is **not** granted (no phone/email, no changes, no sending). The POST requires: the exact `Origin`, the CSRF value bound inside the signed pending cookie, a pending request not already used, a signed-in session, and `decision=approve|deny`. The pending request is not tied to a user (it can be created before login); the grant is created for whoever is signed in and eligible (active user, agency allowlisted, product access) at the moment they approve. The form works without JavaScript (the clicked button carries the decision); with JavaScript a synchronous lock prevents a second submission. `/oauth/consent` is the only page whose CSP `form-action` also allows `https://chatgpt.com` and `https://claude.ai` (browsers apply `form-action` to the 303 redirect chain); every other page keeps `'self'`. That CSP relaxation is not authorization — the server only ever redirects to the CIMD-validated URI stored in the signed pending request.

Approve: creates or merges the user's active grant for (user, client, resource) — scopes are unioned — and issues a single-use code bound to the pending request's `jti` (a replayed pending request violates a unique constraint and is refused). Deny: redirects with `access_denied`.

## Tokens

| Artifact           | Format                                                                                                                                             | Lifetime          | Storage                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| Authorization code | 32 random bytes, base64url                                                                                                                         | 120 s, single use | SHA-256 hash only                                            |
| Access token       | JWT HS256, header `typ: at+jwt`, claim `typ: mcp_access`, `iss`, `aud` = MCP resource, `sub`, agency, grant, scopes, `sv` (sessionVersion), client | 15 minutes        | Not stored                                                   |
| Refresh token      | 32 random bytes, base64url                                                                                                                         | 30 days           | SHA-256 hash only, with `family_id`, `used_at`, `revoked_at` |

`MCP_JWT_SECRET` signs access tokens and the pending cookie. It must be at least 32 characters and differ from `JWT_SECRET` and `MOBILE_JWT_SECRET` (enforced at boot in production).

### Token endpoint

Form-encoded only, 8 KB max, no repeated sensitive parameter. Public clients only: an `Authorization` header or any `client_secret`/`client_assertion` parameter is `invalid_client`. Every check that does not need the stored code runs **before** the code is consumed, so a malformed request never burns a valid code. Code exchange checks client, redirect URI, PKCE, resource, expiry and replay atomically; a reused code revokes its grant. The grant is then re-validated against the database (user exists, not suspended, same agency, same `sessionVersion`, agency still allowlisted) — a failure revokes the grant with the reason.

### Refresh: rotation with strict replay detection

Every refresh returns a new refresh token in the same family and marks the old one used, in one transaction with the presented row locked `FOR UPDATE`. Presenting an **already-used** token (checked before expiry) revokes the whole family **and** the grant (`refresh_reuse`). There is **no grace window**: two parallel refreshes of the same token produce one success and a revoked grant; the user must reconnect. Clients that refresh serially (Claude, observed) are unaffected. Refresh is also limited to 120 issuances per grant per hour, and a refresh token presented by a different client than it was issued to revokes the grant (`client_revoked`). Narrowing scopes on refresh is allowed; widening is `invalid_scope`.

### Revocation and disconnect

- `POST /api/oauth/revoke` (RFC 7009): revokes the presented refresh token's family; always answers 200.
- Settings → אינטגרציות → חיבורי AI → "נתק את {client}": revokes the **grant** and all its refresh tokens (`user_disconnect`), only if the grant belongs to the signed-in user and agency. Other clients' grants are untouched.
- Product-side events also revoke on the next request or refresh: sign-out-everywhere (`session_revoked`), suspension, agency change, removal from the allowlist.

Revocation never overwrites the first `revoked_reason`/`revoked_at`.

## Scopes

| Scope                    | Hebrew label shown on consent / Settings                           | Tools                                                                  |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `crm.leads.read`         | צפייה בלידים שלך, במעקבים ובסיכום היומי                            | search_leads, get_lead, get_leads_needing_followup, get_today_brief    |
| `crm.conversations.read` | צפייה בסיכומי שיחות WhatsApp עם הלידים שלך, ובהודעות עצמן לפי בקשה | get_lead_conversations, get_conversation, get_unanswered_conversations |

Each tool declares its scope in `_meta.securitySchemes` (`[{ type: 'oauth2', scopes: [...] }]`). The pinned SDK cannot emit a top-level `securitySchemes`; see [clients.md](./clients.md).

## Error codes

Token endpoint: RFC 6749 codes (`invalid_request`, `invalid_client`, `invalid_grant`, `unsupported_grant_type`, `invalid_scope`, `invalid_target`) with short generic descriptions — never ids, hashes, session versions or database details. MCP tool errors: `invalid_input`, `not_found`, `insufficient_scope`, `product_access_required`, `feature_not_enabled`, `rate_limited`, `server_error`, each with a fixed English message and the request id.
