/**
 * Messenger saved replies — reusable snippets a נציג can send in one tap.
 *
 * WHY THIS IS NOT WhatsApp TEMPLATES. `whatsapp_templates` holds Meta-APPROVED
 * message templates: they exist because WhatsApp forbids free-form business-
 * initiated messages, each one is submitted to Meta and waits for approval, and
 * they carry an approval status and a category. Messenger has no such concept —
 * inside the 24-hour window a Page sends whatever it likes. So a saved reply
 * here is a CRM convenience (text the rep would otherwise retype), not a
 * compliance artefact, and it has no status, no approval and no Meta identity.
 * Reusing that table would mean teaching every WhatsApp reader to ignore rows
 * that are not really templates.
 *
 * TENANCY. `agencyId` on the row, on the uniqueness constraint and on every
 * read. A snippet belongs to a workspace, not to the rep who typed it, because
 * the value of a saved reply is that the whole team answers the same way.
 *
 * ATTACHMENTS ARE A URL, NOT AN UPLOAD. Meta's reusable `attachment_id` expires
 * after 90 days (Send API, Saving Assets), which would make a saved reply stop
 * working three months after it was written, silently. A URL the business
 * controls does not expire; Meta fetches it per send. SocialCRM hosts nothing.
 *
 * ADDITIVE ONLY.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS messenger_saved_replies (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      -- What the rep picks from the list. Not sent to the customer.
      title text NOT NULL,
      -- The message body. May be empty when the reply is an attachment or a
      -- card carousel, which is why there is no NOT NULL check on content here;
      -- the action rejects a reply that would send nothing at all.
      body text NOT NULL DEFAULT '',
      -- [{ title, payload }] — Meta allows up to 13.
      "quickReplies" jsonb NOT NULL DEFAULT '[]'::jsonb,
      -- [{ type: 'postback'|'web_url', title, payload|url }] — up to 3.
      buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
      -- Optional https URL Meta fetches at send time, with its asset type.
      "attachmentUrl" text,
      "attachmentType" text CHECK ("attachmentType" IS NULL OR "attachmentType" IN ('image','video','audio','file')),
      "createdByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // The composer lists an agency's replies by title; the picker is the only read.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_saved_replies_agency_idx
      ON messenger_saved_replies ("agencyId", title)
  `)

  // Two snippets with the same name are a picker the rep cannot use. Case- and
  // whitespace-insensitive, because "הצעת מחיר" and "הצעת מחיר " are the same
  // name to the person typing them.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS messenger_saved_replies_agency_title_uniq
      ON messenger_saved_replies ("agencyId", lower(btrim(title)))
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_saved_replies_author_idx
      ON messenger_saved_replies ("createdByUserId") WHERE "createdByUserId" IS NOT NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS messenger_saved_replies`)
}
