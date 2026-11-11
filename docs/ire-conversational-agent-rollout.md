# Conversational auto-response: rollout runbook

Branch `feat/ire-conversational-agent`. Code in `lib/inbox/autoresponse/conversational/`, flag in
`lib/flags/conversationalAgentFlags.ts`. Nothing changes for any agency until **every** step below
is approved and done. Each Production step needs its own approval.

## What the flag turns on (per agency, `IRE_CONVERSATIONAL_AGENCY_IDS`, absence = off, no "all")

- The model reports the conversation's mode in the same call that writes the reply (no extra call).
- Personal conversations get a natural reply; owner facts, commitments and selling are refused by
  `validatePersonal.ts` (one repair, then silence). One quiet in-app notice per personal conversation
  (`conversation.personal_detected`).
- Social messages ("חחחח", "מה איתך?") are not silenced by the sales turn rules; a thumbs up still is,
  without closing the conversation.
- A meeting mention is read by the model instead of an immediate handoff; a prospect's new booking
  need is still handed to the team after generation. Explicit requests for a person hand off as before.
- Leads with status `closed` (existing customers) are answered; `lost` stays silent.
- The agent-profile settings section (greeting, persona, tone, FAQ, escalation topics) is shown.

Unchanged for everyone: the manual personal mark (checked at enqueue, in the worker and at send),
opt-out, human takeover and typing, the 24-hour window, quiet hours, the daily cap, the kill switch,
plan entitlement, duplicate-send protection, and AI cost accounting (`inbox.autoResponse` stays
`automation`, never charged to credits).

## Steps (each separately approved)

1. **Migration, before any deploy that uses it.** `20261112120000_auto_response_agent_profile.cjs`
   adds the nullable `auto_response_settings."agentProfile"` (jsonb). Apply with `npm run migrate`
   against Production (`migrate:list` first). The column is read only for flagged agencies, so a
   deploy before the migration does not break other agencies, but the flagged agency would fail.
2. **Merge and deploy.** With the flag unset, Production behaviour is unchanged.
3. **Agency 103, review only.** Before setting the flag, set 103's `auto_response_settings.draft = true`
   for channel `whatsapp`. In draft mode the worker writes every would-be reply to
   `qualify_draft_review` and sends nothing. NOTE: draft is per agency, so 103's real customers also
   stop getting automatic replies while it is on.
4. **Flag.** `IRE_CONVERSATIONAL_AGENCY_IDS=103` (Production only), redeploy.
5. **Review.** Read `qualify_draft_review` for 103 (replies, decisions, `qualification.conversation`
   for the mode) and the `CONVERSATIONAL_TURN` / `CONVERSATIONAL_REPLY_CHECK` traces.
6. **Live.** Only after the review is approved: `draft = false` for 103.

Rollback at any step: remove the agency from `IRE_CONVERSATIONAL_AGENCY_IDS` and redeploy. The
column and the stored mode memory are inert without the flag.

## Evaluation

`npx tsx scripts/e2e/ire-conversational-eval.ts [--only <id>] [--out <file>] [--baseline]` runs
synthetic Hebrew conversations through the real model and scores mode, validators and content.
It costs about $0.05 per scenario on `gpt-5.6`. `--baseline` runs the same set through the classic prompt.
