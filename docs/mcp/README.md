# SocialCRM MCP integration (Phase A)

SocialCRM exposes a **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server so a user can ask an AI assistant — Claude, ChatGPT, or any MCP client that follows the same standards — about their own לידים, follow-ups, Today brief and WhatsApp conversations. The assistant never writes anything, never sends a message and never receives a phone number or email address.

The design is **vendor-neutral**: there is one MCP endpoint, one OAuth server and one permission path. Nothing in the request path branches on which client is calling. The only client-specific facts are the display name on the consent screen and the `source` label in the audit log.

| Read next                        | For                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| [oauth.md](./oauth.md)           | The OAuth 2.1 authorization server: endpoints, CIMD, PKCE, tokens, refresh, revocation |
| [tools.md](./tools.md)           | The seven tools, their limits and permissions, and how to add a tool safely            |
| [security.md](./security.md)     | Threat model, tenant isolation, PII and privacy boundaries, logging                    |
| [operations.md](./operations.md) | Environment, deployment order, rollback, runbook                                       |
| [clients.md](./clients.md)       | Supported clients, the Claude live verification log, ChatGPT/OpenAI readiness          |

## Architecture

```
 AI client (Claude / ChatGPT)                     SocialCRM (Next.js on Vercel)
 ───────────────────────────                     ─────────────────────────────
 1. POST /api/mcp  (no token)  ───────────────▶  initialize + tools/list served; a tool call returns
                                                  an error whose _meta["mcp/www_authenticate"] names the PRM URL
                                                  (an invalid/expired bearer token → HTTP 401 + WWW-Authenticate)
 2. GET  /.well-known/oauth-protected-resource/api/mcp  ──▶  resource + issuer
 3. GET  /.well-known/oauth-authorization-server         ──▶  endpoints, S256, CIMD, auth method "none"
 4. browser → GET /api/oauth/authorize?client_id=<CIMD URL>&…
                                   ├─ fetch + validate the client's CIMD document (host allowlist)
                                   ├─ exact redirect_uri match, PKCE S256, resource = this server
                                   └─ signed pending-request cookie → 302 /oauth/consent
    (not signed in → normal SocialCRM login → resumes at /oauth/consent)
 5. user approves  → POST /api/oauth/consent  → grant + single-use code → 303 redirect_uri?code&state&iss
 6. POST /api/oauth/token  (code + code_verifier, no client secret) → 15-min access JWT + rotating refresh token
 7. POST /api/mcp  Authorization: Bearer <access>
        └─ authenticateMcpRequest: JWT checks + DATABASE re-check (grant, user, agency,
           sessionVersion, suspension, allowlist, product access) → McpPrincipal
        └─ runTool: scope → rate limit → validated input → tool → audit row
        └─ tool: agency + getPerms-scoped readers → presenter (no contact data) → result
```

Key properties:

- **Every MCP request re-checks the database.** Disconnect, sign-out-everywhere, suspension, removing the agency from the allowlist, or losing product access stops an already-issued token on its next call. There is no token denylist; the grant row is the source of truth.
- **Tools never see the request.** They receive a server-built `McpPrincipal` (user, agency, role, `gotPermIds`, plan, scopes) and their validated arguments. Agency and user ids are never taken from tool input.
- **Visibility is the product's own.** Leads go through `scopedLeads` (`db/briefing.ts`), follow-ups through `listFollowUps`/`countFollowUps`, the Today brief through `buildTodayBrief`, waiting-reply through `oldestWaitingWhatsappQuery`/`waitingReplySql`. Not permitted and not found are the same answer.
- **Stored intelligence first.** Conversation tools return the stored `conversation_intelligence` summary/intent/temperature. No tool calls an LLM.

## Code map

| Area                 | Files                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags and boot check | `lib/flags/mcpFlags.ts`, `lib/startup/checkMcpAuthEnv.ts`, `instrumentation.ts`                                                                                                                                                       |
| OAuth server         | `lib/oauth/server/*` (config, cimd, pkce, redirectUri, authorizeRequest, pendingRequest, consentDecision, grants, authorizationCodes, refreshTokens, accessToken, tokenRequest, tokenEndpoint, metadata, connections, sweep, logSafe) |
| OAuth routes         | `app/.well-known/*`, `app/api/oauth/{authorize,consent,token,revoke}`, `app/oauth/consent`                                                                                                                                            |
| MCP runtime          | `app/api/mcp/route.ts`, `lib/mcp/{auth,scope,runTool,rateLimit,audit,errors,wwwAuthenticate,server}.ts`                                                                                                                               |
| Tools and presenters | `lib/mcp/tools/*`, `lib/mcp/present.ts`, `lib/mcp/presentConversation.ts`                                                                                                                                                             |
| Data access          | `db/mcpLeads.ts`, `db/mcpConversations.ts`                                                                                                                                                                                            |
| Settings             | `components/settings/AiConnections.tsx`, `actions/oauthGrants.ts`                                                                                                                                                                     |
| Retention            | `lib/oauth/server/sweep.ts`, `app/api/cron/oauth-sweep/route.ts`, `vercel.json`                                                                                                                                                       |
| Schema               | `migrations/20261003000001`–`20261003000004` (oauth_grants, oauth_authorization_codes, oauth_refresh_tokens, mcp_audit_events)                                                                                                        |
| Tests                | `__tests__/oauth/*`, `__tests__/mcp/*`, `__tests__/a11y/{oauthConsent*,aiConnections}*`                                                                                                                                               |

## Intentionally NOT supported (Phase A)

| Not supported                                                           | Why                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic Client Registration (DCR)                                       | Clients are identified by their published Client ID Metadata Document (CIMD) from an allowlisted host. No open registration endpoint.                                                                    |
| Client secrets, `private_key_jwt`, `client_assertion`, JWT bearer grant | Public clients only (`token_endpoint_auth_method: none`), protected by PKCE S256, exact redirect URIs and the CIMD host allowlist. Any client-authentication material is rejected with `invalid_client`. |
| Write tools                                                             | Phase A is read-only: no status change, no follow-up, no note, no lead creation.                                                                                                                         |
| Sending WhatsApp messages                                               | No tool sends anything.                                                                                                                                                                                  |
| Messenger / Instagram conversations                                     | They live in separate `messenger_*` tables; conversation tools are WhatsApp-only and say so.                                                                                                             |
| Personal conversations                                                  | Threads marked personal (`isPersonal`) are excluded from every MCP tool — an approved Phase A privacy boundary.                                                                                          |
| Phone numbers and email addresses                                       | Never selected for output; the assistant gets the lead's SocialCRM link instead.                                                                                                                         |
| MCP `server/discover`, `resources/*`, `prompts/*`                       | Not implemented; see [clients.md](./clients.md).                                                                                                                                                         |
