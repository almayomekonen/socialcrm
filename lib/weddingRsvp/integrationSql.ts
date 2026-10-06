/** SQL fragments shared by the Wedding Manager integration reads (pure strings). */

/** SQL: an inbox_conversations alias's customerWaId normalized to 972… digits. */
export const waSql = (a: string) => `(CASE WHEN regexp_replace(${a}."customerWaId", '\\D', '', 'g') ~ '^0[2-9][0-9]{8}$'
  THEN '972' || substr(regexp_replace(${a}."customerWaId", '\\D', '', 'g'), 2)
  ELSE regexp_replace(${a}."customerWaId", '\\D', '', 'g') END)`

/** Invites sent before the module existed (phone app): recognised by the invite text. */
export const INVITE_TEXT_SQL = (m: string) => `(${m}.metadata->>'kind' = 'wedding_invite'
  OR regexp_replace(${m}.text || ${m}.payload::text || COALESCE(${m}."rawPayload"::text, ''), '[^א-ת]', '', 'g') LIKE '%להזמינכםלחגוג%'
  OR (${m}.payload::text || COALESCE(${m}."rawPayload"::text, '')) ILIKE '%happy and excited to invite you%')`
