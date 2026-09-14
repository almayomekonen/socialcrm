# Meta App Review — submission package

Written for Meta App Review (English copy to paste) and for whoever records the
screencasts. Every statement describes functionality implemented on
`feat/meta-app-review`. Do not submit until the §4 checklist has passed on the
production build with a real test Page.

App: **SocialCRM** (https://getsocialcrm.com) — a lead-management CRM for small
businesses that receive leads from Facebook, Instagram and WhatsApp.

---

## 1. Permission justifications (paste per permission)

### pages_read_user_content

SocialCRM shows a business the comments people leave on its Facebook Page posts
so that a sales rep can respond to prospects and record them as leads. When a
comment is posted, the Page's `feed` webhook notifies SocialCRM; with
`pages_read_user_content` the notification includes the comment text, which we
display in the app's Comments inbox together with the commenter's name, the time,
a link to the post on Facebook, and the replies in that comment thread. The rep
can then create a lead from the comment. We store the comment id, post id,
commenter name and Page-scoped id, comment text and timestamps, only for Pages
the business connected, and only to show and manage these comments. Comment data
is never sold, shared or used for advertising.

### pages_manage_engagement

SocialCRM lets a business reply to comments on its own Page posts without leaving
the CRM. In the Comments inbox, a rep types a reply under a comment and clicks
"Publish reply"; SocialCRM calls `POST /{comment-id}/comments` with the Page
access token, so the reply is published publicly as the Page. The reply appears
in the comment's thread in SocialCRM, marked as sent from SocialCRM, and on
Facebook. Replies are only sent by an explicit user action; SocialCRM never posts
automatically, never likes, hides or deletes comments, and never posts on
behalf of a person. We use this permission only to publish those replies.

### pages_messaging

SocialCRM brings a business's Facebook Page conversations into its CRM inbox so
reps can answer prospects quickly and turn conversations into leads. When a
person messages the Page, the `messages` webhook delivers the message; SocialCRM
stores it and shows it in the Messenger tab of the Conversations inbox with the
conversation history and unread state. A rep replies from the conversation, and
SocialCRM sends the reply with the Send API (`POST /{page-id}/messages`,
`messaging_type: RESPONSE`) only within 24 hours of the person's last message;
outside that window the app explains that it cannot reply and sends nothing.
Messages the Page sends from Meta Business Suite are received via
`message_echoes` so the history stays complete. SocialCRM never sends the first
message, sends no promotional or automated messages, and uses no message tags.
The rep can create a lead from the conversation or link it to an existing lead.

### ads_read

SocialCRM shows a business how its Facebook ad campaigns perform next to the
leads those campaigns produce. An account admin connects their ad account (the
consent screen asks only for `ads_read`), then opens Performance → Ads, chooses
one of the ad accounts returned by `GET /me/adaccounts` and a date range, and
sees spend, impressions, clicks, CTR and CPC for the account and for each
campaign, read from the Insights API (`GET /{ad-account-id}/insights`). The
feature is read-only: SocialCRM does not create, edit, pause or delete campaigns
and does not request `ads_management`. The user can disconnect at any time,
which deletes the stored token from SocialCRM.

---

## 2. Reviewer instructions (paste into "How to test")

> Replace the angle-bracket values before submitting. The test account must be
> on an agency that is in all three rollout allowlists, and the Facebook test
> user must have a role on the app.

1. Go to https://getsocialcrm.com/auth and sign in with
   `<reviewer email>` / `<reviewer password>`.
2. **Connect the test Page** (skip if the screencast shows it already connected):
   Settings → Integrations → Facebook → "Connect Facebook account", log in as
   `<Facebook test user>`, select the Page `<Test Page name>`, click "Connect page".
3. **pages_read_user_content** — as a different Facebook account, comment on a
   post of `<Test Page name>`. In SocialCRM open Conversations → "Comments". The
   comment appears with its text, author and time. Click "Create lead": the lead
   is created and "Open the lead" links to it.
4. **pages_manage_engagement** — on the same comment, if a "grant reply
   permission" notice is shown, click it and approve on Facebook. Type a reply
   and click "Publish reply". The reply appears under the comment in SocialCRM,
   labelled "your Page · sent from SocialCRM". Click "Open the post on Facebook"
   to see the reply published by the Page.
5. **pages_messaging** — open Conversations → "Messenger". If a permission notice
   is shown, approve it on Facebook. From a Facebook account with a role on the
   app, send a message to `<Test Page name>`. Within about 10 seconds the
   conversation appears in SocialCRM, unread. Open it, type a reply and send. The
   reply appears in the thread and in the sender's Messenger. Click "Create lead"
   to create a lead from the conversation.
6. **ads_read** — open Performance → "Ads". Click "Connect ad account" and
   approve `ads_read`. Select `<ad account name>` and the range
   `<range with delivery, e.g. Last 30 days>`. Spend, impressions, clicks, CTR,
   CPC and the per-campaign table are shown, matching Ads Manager for the same
   account and dates.

The app interface is in Hebrew. Labels used above: Conversations = שיחות,
Comments = תגובות, Create lead = צור ליד, Publish reply = פרסם תשובה,
Performance = ביצועים, Ads = מודעות, Connect ad account = חבר חשבון מודעות.

---

## 3. Screencast recording checklist

Record at 1080p, English captions or voice-over, cursor visible, one video per
permission (or one video with chapters). Never show an access token, the App
Secret, Graph API Explorer, DevTools, or a customer's real data.

**Before recording**
- [ ] Production build of this branch deployed; migrations applied.
- [ ] Recording agency in `FACEBOOK_COMMENTS_*`, `FACEBOOK_MESSENGER_*`,
      `FACEBOOK_ADS_REPORTING_*` allowlists.
- [ ] Test Page connected; commenter and messenger accounts are app Testers.
- [ ] Browser: fresh profile, no extensions, UI zoom 100%, notifications off.
- [ ] Ad account with delivery in the chosen range (the earlier Explorer test
      returned an empty insights array — pick a range with spend first).

**pages_read_user_content**
- [ ] Show Facebook: a new comment posted on the test Page.
- [ ] Show SocialCRM Comments inbox receiving it with the full text.
- [ ] Click "Create lead", then open the created lead.

**pages_manage_engagement**
- [ ] Show the permission prompt and Facebook consent (if not yet granted).
- [ ] Type a reply in SocialCRM, click "Publish reply", show the success toast
      and the reply in the thread labelled as sent from SocialCRM.
- [ ] Open the post on Facebook and show the reply published by the Page.

**pages_messaging**
- [ ] Show the permission prompt and consent (if not yet granted).
- [ ] From the test account, send a fresh message to the Page on Messenger.
- [ ] Show it appearing in SocialCRM's Messenger tab (unread), open it.
- [ ] Reply from SocialCRM; show the reply arriving in Messenger on the sender side.
- [ ] Show "Create lead" from the conversation.
- [ ] Optional: a conversation older than 24 hours showing the closed-window notice.

**ads_read**
- [ ] Show "Connect ad account" and the consent screen listing only `ads_read`.
- [ ] Select the ad account and a date range; show totals and the campaign table.
- [ ] Show Ads Manager for the same account and dates with matching numbers.
- [ ] Optional: "Disconnect ad account" (removes the stored access from SocialCRM).

---

## 4. Pre-submission verification (run on production, test assets only)

Every item must pass with evidence. Do not message or reply to real customers.

1. Comment ingest with text: comment on the test Page →
   ```sql
   select "commentId", "authorIsPage", "messageAvailable", status
   from facebook_page_comments where "pageId" = '<test page id>'
   order by id desc limit 5;
   ```
   Expect the new comment, `messageAvailable = true`, `authorIsPage = false`.
2. Reply dedupe: after publishing a reply from SocialCRM, the same query must show
   exactly **one** row for the reply with `authorIsPage = true` and
   `"sentByUserId"` set, even after the webhook echo arrives (wait 1 minute).
   If a second Page-authored row with a differently formatted id appears, stop:
   the Graph reply id and webhook `comment_id` formats differ and dedupe needs a
   normalisation step.
3. Messenger receive: message the Page from a tester account →
   ```sql
   select direction, source, left(text, 20), "channelTimestamp"
   from messenger_messages where "pageId" = '<test page id>' order by id desc limit 5;
   ```
4. Messenger send + echo: reply from SocialCRM → exactly one outbound row with
   `source = 'socialcrm'` for that `mid` after the echo arrives.
5. Page-inbox echo: reply once from Meta Business Suite → one outbound row with
   `source = 'page_inbox'`. If it shows `other_app`, record the `app_id` from the
   server log and update `PAGE_INBOX_APP_IDS`.
6. Window: a conversation whose last inbound message is older than 24h shows the
   closed-window notice and the send button is absent.
7. Ads: a range with delivery shows non-empty totals; a range with no delivery
   shows "no activity in this range" (not an error).
8. Health: `select page_id, health_status from facebook_pages where agency_id = <id>`
   stays `healthy`; a Lead Ads Testing Tool lead still arrives.
