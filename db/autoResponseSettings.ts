/**
 * Instant Response Engine settings. Workspace master switch lives on
 * agencies.autoResponseEnabled; per-channel config in auto_response_settings.
 * Additive, read/write only — no business logic.
 */
import { db } from '@/config/db'
import { parseBusinessProfile, type BusinessProfile } from '@/lib/inbox/autoresponse/businessProfile'
import {
  parseReplyMode,
  clampDelaySeconds,
  MAX_FIXED_BODY_LENGTH,
  type AutoResponseReplyMode,
} from '@/lib/inbox/autoresponse/replyMode'

export type { AutoResponseReplyMode }
export {
  parseReplyMode,
  clampDelaySeconds,
  MAX_FIXED_BODY_LENGTH,
  MAX_DELAY_SECONDS,
} from '@/lib/inbox/autoresponse/replyMode'

export interface CollectFields {
  required: string[]
  optional: string[]
}

export interface AutoResponseSettings {
  agencyId: number
  channel: string
  enabled: boolean
  quietHours: { tz?: string; startHour?: number; endHour?: number }
  dailyCap: number
  /** Business information: what this business is and what it may say. */
  guidance: string | null
  /** How the agent should converse for this business. Never sent verbatim. */
  agentInstructions: string | null
  /** Structured profile derived from `guidance` on save. Null until derived. */
  businessProfile: BusinessProfile | null
  // Qualifier (P0b additive). Defaults reproduce one-shot acknowledge behavior.
  mode: 'acknowledge' | 'qualify'
  maxTurns: number
  collectFields: CollectFields
  draft: boolean
  replyMode: AutoResponseReplyMode
  /** The literal outgoing message, used only by replyMode 'fixed'. */
  fixedBody: string | null
  delaySeconds: number
}

interface SettingsRow {
  agencyId: number
  channel: string
  enabled: boolean
  quietHours: AutoResponseSettings['quietHours'] | null
  dailyCap: number
  guidance: string | null
  agentInstructions: string | null
  businessProfile: unknown
  mode: string | null
  maxTurns: number | null
  collectFields: CollectFields | string | null
  draft: boolean | null
  replyMode: string | null
  fixedBody: string | null
  delaySeconds: number | null
}

const DEFAULT_COLLECT: CollectFields = { required: ['name', 'need', 'urgency'], optional: ['budget', 'location', 'callback'] }

export async function getMasterEnabled(agencyId: number): Promise<boolean> {
  const row = await db('agencies').where({ id: agencyId }).first('autoResponseEnabled')
  return row?.autoResponseEnabled ?? false
}

export async function setMasterEnabled(agencyId: number, enabled: boolean): Promise<void> {
  await db('agencies').where({ id: agencyId }).update({ autoResponseEnabled: enabled })
}

export async function getChannelSettings(agencyId: number, channel: string): Promise<AutoResponseSettings | null> {
  const row = (await db('auto_response_settings')
    .where({ agencyId, channel })
    .first(
      'agencyId',
      'channel',
      'enabled',
      'quietHours',
      'dailyCap',
      'guidance',
      'agentInstructions',
      'businessProfile',
      'mode',
      'maxTurns',
      'collectFields',
      'draft',
      'replyMode',
      'fixedBody',
      'delaySeconds',
    )) as SettingsRow | undefined
  if (!row) return null
  const cf = row.collectFields
  return {
    agencyId: row.agencyId,
    channel: row.channel,
    enabled: row.enabled,
    quietHours: row.quietHours ?? {},
    dailyCap: row.dailyCap,
    guidance: row.guidance,
    agentInstructions: row.agentInstructions ?? null,
    businessProfile: parseBusinessProfile(row.businessProfile),
    mode: row.mode === 'qualify' ? 'qualify' : 'acknowledge',
    maxTurns: row.maxTurns ?? 5,
    collectFields: (typeof cf === 'string' ? JSON.parse(cf) : (cf ?? DEFAULT_COLLECT)) as CollectFields,
    draft: row.draft ?? false,
    replyMode: parseReplyMode(row.replyMode),
    fixedBody: row.fixedBody ?? null,
    delaySeconds: clampDelaySeconds(row.delaySeconds ?? 0),
  }
}

export type UpsertChannelSettingsInput = Pick<
  AutoResponseSettings,
  | 'agencyId'
  | 'channel'
  | 'enabled'
  | 'quietHours'
  | 'dailyCap'
  | 'guidance'
  | 'replyMode'
  | 'fixedBody'
  | 'delaySeconds'
> & {
  updatedBy: number
  /** Optional: callers that do not manage these leave the stored value alone. */
  agentInstructions?: string | null
  mode?: AutoResponseSettings['mode']
  /**
   * `undefined` leaves the stored profile alone; `null` clears it. Clearing
   * matters: a description saved while derivation was down must not keep serving
   * the profile built from the previous text.
   */
  businessProfile?: BusinessProfile | null
}

/**
 * `mode` is written here for the first time. It was previously reachable only by
 * a hand-written UPDATE, which is why every agency sat on the column default and
 * the conversational agent was unreachable through the product.
 *
 * It stays OPTIONAL on the input: a caller that omits it must not silently reset
 * a row that is already on `qualify`, so the merge only touches the column when a
 * value was supplied. Same for `agentInstructions`.
 */
export async function upsertChannelSettings(input: UpsertChannelSettingsInput): Promise<void> {
  const replyMode = parseReplyMode(input.replyMode)
  const delaySeconds = clampDelaySeconds(input.delaySeconds)
  const fixedBody =
    replyMode === 'fixed' ? (input.fixedBody ?? '').trim().slice(0, MAX_FIXED_BODY_LENGTH) || null : input.fixedBody

  const optional: Record<string, unknown> = {}
  if (input.mode !== undefined) optional.mode = input.mode === 'qualify' ? 'qualify' : 'acknowledge'
  if (input.businessProfile !== undefined) {
    optional.businessProfile = input.businessProfile ? JSON.stringify(input.businessProfile) : null
  }
  if (input.agentInstructions !== undefined) {
    optional.agentInstructions = (input.agentInstructions ?? '')?.trim()
      ? (input.agentInstructions as string).trim().slice(0, MAX_FIXED_BODY_LENGTH)
      : null
  }

  const shared = {
    enabled: input.enabled,
    quietHours: JSON.stringify(input.quietHours ?? {}),
    dailyCap: input.dailyCap,
    guidance: input.guidance,
    replyMode,
    fixedBody,
    delaySeconds,
    updatedBy: input.updatedBy,
    updatedAt: db.fn.now(),
    ...optional,
  }

  await db('auto_response_settings')
    .insert({
      agencyId: input.agencyId,
      channel: input.channel,
      ...shared,
    })
    .onConflict(['agencyId', 'channel'])
    .merge(shared)
}
