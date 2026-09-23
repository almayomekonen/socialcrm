# Business Asset User Profile Access — submission prep

**Not submitted.** This is the material to submit, plus a checklist for the
screencast Meta requires. Nothing here claims the feature is approved.

---

## 1. Current status (verified, 2026-09-23)

`GET /{app-id}/permissions` with an app access token returns ten entries, all
`live`:

```
business_management            live
email                          live
leads_retrieval                live
pages_manage_metadata          live
pages_messaging                live
pages_read_engagement          live
pages_show_list                live
public_profile                 live
whatsapp_business_management   live
whatsapp_business_messaging    live
```

`pages_read_user_content`, `pages_manage_engagement` and `ads_read` are absent,
matching the known rejections.

**Business Asset User Profile Access is absent from that list — but so is every
other Feature.** Meta separates *Permissions* from *Features*, and
`/{app-id}/permissions` enumerates only the former. So the API result is
consistent with "not granted" and is **not proof**. Confirm in **App Dashboard →
App Review → Permissions and Features** before submitting, and read the status
shown there rather than inferring it.

A second, conclusive runtime check becomes available the moment a Page is
connected: call `GET /{PSID}?fields=first_name,last_name,profile_pic` with the
Page token. A refusal is recorded by the app as `profileStatus = 'denied'`, so

```sql
SELECT "profileStatus", count(*) FROM messenger_conversations GROUP BY 1;
```

answers it from production data with no manual Graph call at all.

---

## 2. Why the app needs it

Verbatim-ready, for the submission form.

> SocialCRM is a CRM for small businesses in Israel that receive customer
> enquiries through Facebook Page messages, WhatsApp and Facebook Lead Ads. A
> business owner or their sales representative answers those enquiries from
> inside SocialCRM instead of switching between Meta Business Suite, WhatsApp
> and a spreadsheet.
>
> The Messenger webhook identifies a person only by their Page-scoped ID. Without
> Business Asset User Profile Access we can display nothing but that opaque
> identifier, so every conversation in the representative's inbox is
> indistinguishable from every other one. A representative handling fifteen
> enquiries in a morning cannot tell which thread belongs to which person, cannot
> recognise a returning customer, and cannot greet anyone by name.
>
> We request the feature to show, inside the business's own inbox, the first
> name, last name and profile picture of the person who messaged that business's
> Page — and for no other purpose.
>
> The data is used only to label the conversation the person themselves started.
> It is shown exclusively to authenticated users of the workspace that owns the
> Page, is never shown to any other business, is never used for advertising,
> targeting, profiling, enrichment or resale, and is never combined with data
> from any other source. The name is stored alongside the conversation solely so
> the inbox can be rendered without calling the Graph API on every page view; the
> profile picture is not copied or stored — only Meta's URL is cached, and it is
> refreshed from Meta rather than rehosted. A business that disconnects its Page
> or deletes its account has this data removed with it, through the deletion
> route already documented for this app.
>
> If the feature is not granted, the product continues to work: messages are sent
> and received normally and the conversation is labelled with initials instead.
> The feature affects presentation only.

---

## 3. Data handling — the specifics a reviewer will ask about

| Question | Answer |
| --- | --- |
| Which fields? | `first_name`, `last_name`, `profile_pic` only |
| When is it called? | Once when a conversation is first created, then at most once every 3 days per contact (`PROFILE_TTL_MS`), in a background task after the HTTP response |
| Where is it stored? | `messenger_conversations.customerName` (text) and `profilePicUrl` (Meta's URL), scoped to one agency |
| Is the picture rehosted? | No. Meta's signed CDN URL is cached and refreshed; the image bytes are never copied to our infrastructure |
| Who can see it? | Only authenticated users of the workspace that owns that Page. Every read is filtered by `agencyId` |
| Is it used for ads/profiling? | No |
| On refusal? | Recorded as `denied`, never retried on a timer, UI falls back to initials, messaging unaffected |
| Deletion? | Removed with the conversation when a Page is disconnected or the account is deleted — see `privacy-and-data-deletion.md` |

---

## 4. Screencast checklist

Meta expects a recording of the *real* product performing the *stated* use case.
Record only after a Page is connected and the feature is temporarily available
(or record the fallback and narrate the gap — do not stage a fake name).

Record in one take, Hebrew UI is fine, English narration or captions:

- [ ] **Show the business context first.** Log in to SocialCRM, land on the
      workspace. Make it obvious this is a business tool with an authenticated
      user, not a consumer app.
- [ ] **Show the Page connection.** Settings → מקורות לידים → פייסבוק, showing
      the connected Page. This establishes that the Page is a business asset the
      user administers.
- [ ] **Send a message to the Page from a second device**, on camera, as the
      "customer". Use a test account you control.
- [ ] **Show it arriving** in שיחות → Messenger.
- [ ] **This is the shot that matters:** the conversation row and the thread
      header showing the customer's real **name and profile picture**. Say aloud
      what it is for — "the representative can now see which customer this
      conversation belongs to."
- [ ] **Show a second conversation** from a different person, side by side in the
      list, so the reviewer sees the problem the feature solves: two threads that
      would otherwise be indistinguishable.
- [ ] **Reply from SocialCRM** and show it arriving on the customer device. This
      proves the profile data is used inside a genuine messaging workflow.
- [ ] **Show the fallback**, briefly: a conversation with no profile data showing
      initials. It demonstrates the feature is presentation-only and the product
      degrades honestly.
- [ ] **Do not show** anything the request does not cover — no export, no
      audience building, no cross-business view, no third-party sharing.

Length: 2–4 minutes. Do not cut between the customer sending and the message
appearing; an unbroken shot is what makes the flow credible.

---

## 5. Before submitting

- [ ] Confirm the real status in App Dashboard → App Review → Permissions and
      Features (the API check above is suggestive, not conclusive)
- [ ] Confirm the app is in **Live** mode — in Development mode only people with
      an app role can message the Page, and a reviewer cannot reproduce the flow
- [ ] Provide test credentials for a SocialCRM workspace with the Page connected
- [ ] Re-read §2 against the shipped UI so the text does not describe anything
      that is not on screen
