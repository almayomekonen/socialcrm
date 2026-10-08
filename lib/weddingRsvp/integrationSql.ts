/** SQL fragments shared by the Wedding Manager integration reads (pure strings). */

/** SQL: an inbox_conversations alias's customerWaId normalized to 972… digits. */
export const waSql = (a: string) => `(CASE WHEN regexp_replace(${a}."customerWaId", '\\D', '', 'g') ~ '^0[2-9][0-9]{8}$'
  THEN '972' || substr(regexp_replace(${a}."customerWaId", '\\D', '', 'g'), 2)
  ELSE regexp_replace(${a}."customerWaId", '\\D', '', 'g') END)`

/** Invites sent before the module existed (phone app): recognised by the invite text. */
export const INVITE_TEXT_SQL = (m: string) => `(${m}.metadata->>'kind' = 'wedding_invite'
  OR regexp_replace(${m}.text || ${m}.payload::text || COALESCE(${m}."rawPayload"::text, ''), '[^א-ת]', '', 'g') LIKE '%להזמינכםלחגוג%'
  OR (${m}.payload::text || COALESCE(${m}."rawPayload"::text, '')) ILIKE '%happy and excited to invite you%')`

/**
 * SQL: the wedding RSVP choice of an inbound message aliased `m`, normalized to our
 * button ids. Free-form taps carry button_reply.id; template quick replies carry
 * button.payload (our id — or the visible label when sent without payloads).
 */
export const RSVP_CHOICE_SQL = `(CASE
  WHEN m.type = 'interactive' THEN m.payload->'button_reply'->>'id'
  WHEN m.type = 'button' AND m.payload->>'payload' IN ('wedding_rsvp_attending', 'מגיע/ה') THEN 'wedding_rsvp_attending'
  WHEN m.type = 'button' AND m.payload->>'payload' IN ('wedding_rsvp_not_attending', 'לצערי לא') THEN 'wedding_rsvp_not_attending'
END)`
