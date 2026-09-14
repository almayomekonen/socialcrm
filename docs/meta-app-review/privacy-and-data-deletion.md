# Privacy policy and data deletion — required updates

Written for the business owner who approves legal copy. Meta App Review checks
that the privacy policy URL describes the data the app actually processes and
that users have a working way to request deletion. The current `/privacy` page
(updated March 2026) and `/data-deletion` page do not yet cover what this branch
processes. Legal wording is the owner's decision; nothing below has been
published.

## 1. What the app processes after this branch (factual inventory)

| Source / permission | Data stored | Where | Purpose | Deleted when |
| --- | --- | --- | --- | --- |
| Page connection (`pages_show_list`, `pages_manage_metadata`, `leads_retrieval`) | Page id, Page name, Page access token (encrypted), granted permission names | `facebook_pages` | Receive leads and events for that Page | User disconnects the Page (row deleted) |
| Lead Ads (existing) | Lead form answers (name, phone, email), ad/campaign attribution | `clients`, `lead_attribution` | Lead management | Lead deleted by the business, or deletion request |
| `pages_read_user_content` | Comment id, post id, commenter name and Page-scoped id, comment text, timestamps | `facebook_page_comments` | Show comments; create leads | Deletion request (comments removed on Facebook are marked deleted, not erased) |
| `pages_manage_engagement` | Reply text published by the Page, the CRM user who sent it | `facebook_page_comments` | Show the reply thread | Deletion request |
| `pages_messaging` | Messenger Page-scoped id, first/last name (User Profile API, fetched once per new conversation), message text, attachment links (Meta CDN URLs), timestamps, which CRM user replied, read state per CRM user | `messenger_conversations`, `messenger_messages`, `messenger_conversation_reads` | Show and answer conversations; create leads | Deletion request |
| `ads_read` | Encrypted user access token, granted permission names, token expiry. **Performance numbers are read live and not stored.** | `facebook_ad_connections` | Show ad performance | User clicks "Disconnect ad account" (row deleted; the Meta grant itself is removed by the user in Facebook → Business integrations) |

Security facts now true for new connections: Page and ad tokens are encrypted at
rest with AES-256-GCM and never sent to the browser. **Page tokens stored before
this deploy remain plaintext until each Page is reconnected** — either reconnect
existing Pages before changing the policy text, or keep the wording to "tokens
are protected" until that is done.

## 2. `/privacy` — sections to change

1. **"What information we collect"** — add: Facebook Page comments and replies on
   connected Pages; Facebook Messenger conversations with connected Pages (name,
   Page-scoped identifier, message content and attachments); advertising
   performance data for ad accounts a user connects (displayed, not stored).
2. **"Use of Facebook"** — currently says the Facebook API is used only to receive
   Lead Ads. Replace with a description of all four uses: Lead Ads, Page comments
   (read and reply as the Page when a user chooses to), Messenger conversations
   (receive and reply within Meta's messaging window, only when a user sends), and
   read-only ad performance. State that data is used only to provide these CRM
   features, never sold, never used for advertising, and processed per the Meta
   Platform Terms.
3. **"Information security"** — keep the encryption statement only once existing
   plaintext Page tokens have been re-sealed (see above).
4. **"User rights" / retention** — state how long comments and messages are kept
   (no automatic expiry exists in code today) and that the business can request
   deletion; add that disconnecting a Page stops new data and disconnecting ads
   deletes the stored ad access.
5. **Update the "last updated" date.**

Draft English wording for the Facebook section (translate to Hebrew for the site):

> SocialCRM uses Meta's APIs only for businesses that connect their Facebook Page
> or ad account. With the business's permission we receive leads from Lead Ads;
> receive comments on the Page's posts and, when a team member chooses to,
> publish replies as the Page; receive messages sent to the Page on Messenger and,
> when a team member chooses to, send replies within the period Meta allows; and
> display read-only performance data for connected ad accounts. This data is used
> only to provide these features to the business, is never sold or used for
> advertising, and access tokens are stored encrypted. A business can disconnect a
> Page or ad account at any time.

## 3. `/data-deletion`

Current page: email `alamayo274@gmail.com`, handled within 7 business days. Meta
accepts either a **Data Deletion Instructions URL** or a **Data Deletion Callback
URL**. This branch does not add a callback.

Required to be accurate:
- List what is deleted on request: leads, comments, replies, Messenger
  conversations and messages, Page connection, ad connection.
- Say how a person who only interacted with a business's Page (commented or
  messaged) can request deletion: through the business, or directly by email
  with the Page name and the approximate time of the comment/message — they have
  no SocialCRM account and cannot be matched by email.
- Keep the Data Deletion Instructions URL in the App Dashboard pointing to
  `https://getsocialcrm.com/data-deletion`.

Operational gap to close before promising a deadline: there is no admin tool that
deletes a Messenger contact's conversation or a commenter's comments by Page-
scoped id; today it is a manual database operation. Either build that tool or
state the manual process in the internal runbook.
