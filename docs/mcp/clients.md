# MCP clients: support, verification and submission readiness

## Supported-client matrix

|                              | Claude (custom connector)                                | ChatGPT (Developer Mode / Apps)                                         |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Client identity              | CIMD `https://claude.ai/oauth/mcp-oauth-client-metadata` | CIMD `https://chatgpt.com/oauth/client.json`                            |
| Redirect URI                 | `https://claude.ai/api/mcp/auth_callback`                | `https://chatgpt.com/connector_platform_oauth_redirect` (from its CIMD) |
| Trusted host (default)       | `claude.ai`                                              | `chatgpt.com`                                                           |
| Implemented                  | Yes                                                      | Yes (same code path)                                                    |
| **Live end-to-end verified** | **Yes** (2026-10-04, dev tunnel, test agency)            | **No** — not yet run against ChatGPT                                    |

There is no client-specific code path. Claude-specific strings exist only in display labels (consent heading, Settings card) and the audit `source` (`claude` / `chatgpt` / `mcp`).

## Claude — live verification log (2026-10-04)

Environment: local build of this branch behind an HTTPS tunnel, dedicated test database, one allowlisted test agency and test user; temporary `ping_auth` tool (not committed).

| Step                    | Observed                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery               | `initialize` without a token, then PRM and AS metadata fetched; `tools/list` returned the tool                                                                                                                                                                                    |
| CIMD                    | `client_id=https://claude.ai/oauth/mcp-oauth-client-metadata`, fetched and validated; document declares `token_endpoint_auth_method: none`                                                                                                                                        |
| Authorize               | `response_type=code`, exact `redirect_uri=https://claude.ai/api/mcp/auth_callback`, `code_challenge_method=S256` (43-char challenge), `resource` = this server's MCP resource, `scope=crm.leads.read crm.conversations.read`, `state` present; no duplicate or unknown parameters |
| Consent                 | One POST `/api/oauth/consent` with `decision=approve` → 303 to the Claude callback with `code`, `state`, `iss`; the browser reached the callback                                                                                                                                  |
| Code exchange           | Claude POSTed `/api/oauth/token` with `grant_type=authorization_code`, 128-char `code_verifier`, exact `redirect_uri`, `resource`; **no `Authorization` header, no client secret/assertion** (auth method `none`); code consumed; refresh token created                           |
| Tool call               | Authenticated `tools/call ping_auth` → `{ "ok": true }`; audit row `source=claude`, outcome `ok`                                                                                                                                                                                  |
| Refresh                 | After the access token expired, exactly **one** `grant_type=refresh_token` request, **serial** (refreshed before calling, no 401 first); old token marked used, one active successor in the same family; **no `refresh_reuse`**; grant stayed active                              |
| Tool call after refresh | Used the new access token → `{ "ok": true }`; second audit row `source=claude`                                                                                                                                                                                                    |

Issues found and fixed during the checkpoint (all committed): consent double submission (`fe5ac8d8`), CSP `form-action` blocking the redirect to the client (`861f466c`), and consent needing JavaScript to send the decision (`eedb5fbe`).

Known, harmless: before `initialize`, Claude sends `server/discover` with protocol version `2026-07-28`. SDK 1.32.0 answers 400 (unsupported version) and Claude continues with `initialize` on a supported version. No failure was observed. Claude also probes `resources/list`, which is not implemented.

## SDK and protocol version

`@modelcontextprotocol/sdk` is pinned at **1.32.0**, the latest v1 release (2026-10-02); it supports protocol versions up to `2025-11-25`. MCP `2026-07-28` (and `server/discover`) is implemented by the **v2** line — `@modelcontextprotocol/server` 2.3.0, a separate package with a new API and a migration guide. Moving to it is a migration, not a version bump: the endpoint, server construction, tool registration, the input-validation override, `_meta.securitySchemes` emission and every MCP test would need re-verification, followed by a fresh live check with each client. It is therefore **not** done in Phase A; Claude works today through version negotiation. Recommended as its own task before broad rollout.

## ChatGPT / OpenAI readiness

### A. Implemented

- OAuth 2.1 + PKCE S256, RFC 8707 resource, RFC 9207 `iss`, RFC 9728 PRM, RFC 8414 AS metadata, CIMD with `chatgpt.com` trusted, public client (`none`).
- Seven read-only tools with output schemas, read-only annotations and per-tool `_meta.securitySchemes`.
- Unauthenticated `initialize`/`tools/list`; tool calls without a token return the tool error with `_meta["mcp/www_authenticate"]`.
- Disconnect in Settings; ChatGPT-side disconnect via RFC 7009 revocation.

### B. Verified live — with Claude only

Discovery, CIMD, consent, code exchange with `none`, serial refresh without replay revocation, authenticated tool calls before and after refresh, audit `source`. These exercise the same server code ChatGPT uses, but they are **not** ChatGPT verification.

### C. Still requires live ChatGPT Developer Mode validation

1. Whether ChatGPT honours **`_meta.securitySchemes`** (the pinned SDK cannot emit a top-level `securitySchemes`). If it requires the top-level field, a custom `tools/list` handler or an SDK migration is needed — not built without approval.
2. Which **token endpoint auth method** ChatGPT actually uses. Its CIMD lists `none` and `private_key_jwt`; SocialCRM accepts only `none` and rejects any assertion with `invalid_client`.
3. ChatGPT's **refresh behaviour** — serial or parallel. Parallel refresh of the same token revokes the grant by design (no grace window); if ChatGPT does this routinely the user would be disconnected, and the finding must be reported rather than the rotation weakened.
4. **End-to-end tool invocation** in Developer Mode: connect (including a logged-out start that resumes at consent), each of the seven tools on realistic prompts, a "what is David's phone number?" prompt (must explain it is not shared and give the link), the injection fixture summarised without ChatGPT acting on it, and disconnect from Settings → the next ChatGPT call fails and ChatGPT offers to reconnect.

**SocialCRM is not ready for OpenAI app submission until every item in C is verified and logged here.** Submission also needs the store-listing material (description, privacy policy link covering this integration, support contact, screenshots, test account), which is out of scope for this document.
