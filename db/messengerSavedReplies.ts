import { db } from '@/config/db'
import type { MessengerSendableType } from '@/lib/facebook/messenger/attachmentRules'
import type { MessengerButton, MessengerQuickReply, MessengerRichContent } from '@/lib/facebook/messenger/structured'

/**
 * Messenger saved replies — reads and writes.
 *
 * Every function takes `agencyId` and applies it to both the WHERE and, on a
 * write, the row itself. An id alone is never enough to touch a row: a snippet
 * belongs to a workspace, and the id is a bigserial another tenant can guess.
 */

export type MessengerSavedReply = {
  id: number
  title: string
  body: string
  quickReplies: MessengerQuickReply[]
  buttons: MessengerButton[]
  attachmentUrl: string | null
  attachmentType: MessengerSendableType | null
}

export type SavedReplyInput = {
  title: string
  body: string
  quickReplies: MessengerQuickReply[]
  buttons: MessengerButton[]
  attachmentUrl: string | null
  attachmentType: MessengerSendableType | null
}

/** A reply the agency can realistically manage from one picker. */
export const SAVED_REPLY_LIMIT = 100

/** jsonb comes back parsed on some drivers and as text on others. */
function json<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback
  const value = typeof raw === 'string' ? safeParse(raw) : raw
  return Array.isArray(value) ? (value as T) : fallback
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

type Row = {
  id: number | string
  title: string
  body: string
  quickReplies: unknown
  buttons: unknown
  attachmentUrl: string | null
  attachmentType: MessengerSendableType | null
}

function map(row: Row): MessengerSavedReply {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body ?? '',
    quickReplies: json<MessengerQuickReply[]>(row.quickReplies, []),
    buttons: json<MessengerButton[]>(row.buttons, []),
    attachmentUrl: row.attachmentUrl ?? null,
    attachmentType: row.attachmentType ?? null,
  }
}

const COLUMNS = ['id', 'title', 'body', 'quickReplies', 'buttons', 'attachmentUrl', 'attachmentType'] as const

export async function listMessengerSavedReplies(agencyId: number): Promise<MessengerSavedReply[]> {
  const rows = (await db('messenger_saved_replies')
    .where({ agencyId })
    .orderByRaw('lower(btrim(title)) ASC')
    .limit(SAVED_REPLY_LIMIT)
    .select(...COLUMNS)) as Row[]
  return rows.map(map)
}

export async function getMessengerSavedReply(agencyId: number, id: number): Promise<MessengerSavedReply | null> {
  if (!Number.isInteger(id) || id <= 0) return null
  const row = (await db('messenger_saved_replies').where({ id, agencyId }).first(...COLUMNS)) as Row | undefined
  return row ? map(row) : null
}

export async function countMessengerSavedReplies(agencyId: number): Promise<number> {
  const [row] = await db('messenger_saved_replies').where({ agencyId }).count<{ count: string }[]>('id as count')
  return Number(row?.count ?? 0)
}

function writable(input: SavedReplyInput) {
  return {
    title: input.title.trim().slice(0, 120),
    body: input.body,
    quickReplies: JSON.stringify(input.quickReplies),
    buttons: JSON.stringify(input.buttons),
    attachmentUrl: input.attachmentUrl,
    attachmentType: input.attachmentType,
  }
}

/** Returns null when the title collides with an existing reply in this agency. */
export async function createMessengerSavedReply(
  agencyId: number,
  userId: number,
  input: SavedReplyInput,
): Promise<MessengerSavedReply | null> {
  const rows = await db('messenger_saved_replies')
    .insert({ agencyId, createdByUserId: userId, ...writable(input) })
    // The uniqueness is on lower(btrim(title)), an EXPRESSION index, which
    // `onConflict(columns)` cannot name — so the constraint is the arbiter and
    // a collision returns no row rather than throwing.
    .onConflict(db.raw('("agencyId", lower(btrim(title)))'))
    .ignore()
    .returning([...COLUMNS])
  return rows.length > 0 ? map(rows[0] as Row) : null
}

/** Returns null when the row is not this agency's, or the new title collides. */
export async function updateMessengerSavedReply(
  agencyId: number,
  id: number,
  input: SavedReplyInput,
): Promise<MessengerSavedReply | null> {
  if (!Number.isInteger(id) || id <= 0) return null
  try {
    const rows = await db('messenger_saved_replies')
      .where({ id, agencyId })
      .update({ ...writable(input), updatedAt: db.fn.now() })
      .returning([...COLUMNS])
    return rows.length > 0 ? map(rows[0] as Row) : null
  } catch {
    // 23505 from the title uniqueness. Reported as "name taken", not as a crash.
    return null
  }
}

export async function deleteMessengerSavedReply(agencyId: number, id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id <= 0) return false
  const deleted = await db('messenger_saved_replies').where({ id, agencyId }).delete()
  return deleted > 0
}

/**
 * A saved reply as something sendable.
 *
 * ONE mapping, used both when validating a save and when sending — so a reply
 * can never be stored in a shape that is valid to save and invalid to send.
 *
 * It lives here and not in `savedReplyActions.ts` because that file is
 * `'use server'`, where every export must be an async function (a synchronous
 * one fails the build, not the typecheck) and every export is an addressable
 * RPC endpoint.
 */
export function asContent(reply: SavedReplyInput | MessengerSavedReply): MessengerRichContent {
  return {
    quickReplies: reply.quickReplies,
    buttons: reply.buttons,
    attachment:
      reply.attachmentUrl && reply.attachmentType
        ? { type: reply.attachmentType, url: reply.attachmentUrl }
        : undefined,
  }
}
