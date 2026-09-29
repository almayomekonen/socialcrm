# WhatsApp agent: ownership + silence correctness

**Flag:** `AGENT_RELIABILITY_AGENCY_IDS`.

- **Default:** unset, meaning no agency; legacy behaviour everywhere.
- **Values:** comma-separated agency ids, or `all`.
- **Local development:** add the id to your `.env.local`, for example `AGENT_RELIABILITY_AGENCY_IDS=103`.
- **Code:** `lib/flags/agentReliabilityFlags.ts` and `lib/inbox/autoresponse/reliability/*`.
- **Rollout:** agency 103 first. No migration and no other environment variable.

## What changes for an agency in the rollout

The table lists situations as they happen to a customer, not in code order.

| Situation | Before | After |
|---|---|---|
| An automation template is sent into the conversation | Counted as a human takeover: the agent stopped for good. | Not a person. Only `isHumanOutbound` counts: a SocialCRM send with a user and no source, or a Coexistence echo. |
| A rep presses "return to agent" | The rep's earlier messages paused the agent again on the next customer message. | The return records an ownership epoch, `qualification.ownership.sinceSequence`. Only a human reply after it takes over again. |
| A closed conversation is legitimately reopened | It answered, but stayed `closed`. | It becomes `ai_qualifying` again. Opted-out and human-owned conversations never reopen. |
| The first message is only a greeting, an emoji, or `?` | A model call to say hello, or silence. | The business greeting plus "איך אפשר לעזור?". No model call. |
| An image or document has a caption | The caption was ignored. | The caption is the customer's text. The stored message is unchanged. |
| A photo or voice note arrives on its own | Silence. | One honest acknowledgement asking for words, never repeated back to back. Stickers and reactions stay silent. No model call. |
| The plan does not include the AI reply (`resolveAiAccess` denies) | A job that died as `ai_unavailable`; the customer got nothing. | No job is created, no model is called, and no substitute message is sent. The inbox thread says the automatic reply is paused. The inbound message, its notification rules and the inbox are unchanged. |

## What does not change

- **Guards:** the human-presence guard (typing TTL, turn epoch, mid-generation abort) and `assertAgentSendAllowed`.
- **Conversation rules:** opt-out, quiet hours, the 24-hour window and the daily cap.
- **Idempotency:** the one-in-flight-job rule, and questionnaire routing and behaviour.
- **Fixed replies (`replyMode = fixed`):** these never needed AI, so the entitlement check does not apply to them.
