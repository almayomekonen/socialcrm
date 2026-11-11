/**
 * Instant Response Engine settings. Workspace master switch lives on
 * agencies.autoResponseEnabled; per-channel config in auto_response_settings.
 * Additive, read/write only — no business logic.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { parseBusinessProfile, type BusinessProfile } from '@/lib/inbox/autoresponse/businessProfileParse'
import { normalizeAgentProfile, storableAgentProfile, type AgentProfile } from '@/lib/inbox/autoresponse/conversational/agentProfile'
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
  /**
   * WHICH ENGINE ANSWERS: the AI agent, or the deterministic questionnaire.
   *
   * Separate from `mode` on purpose. The owner-facing save derives `mode` from
   * `replyMode`, and an unrecognised `mode` is read back as 'acknowledge' — so a
   * questionnaire expressed as a third `mode` value would be one owner save, or
   * one rollback, away from sending an AI reply. This column is never written by
   * `upsertChannelSettings`; only the staff config path sets it.
   *
   * Optional on the type, never on a row `getChannelSettings` returns: absent
   * means the agent, which is what every caller that predates the questionnaire
   * should mean, including a settings object built in a test.
   */
  responder?: 'agent' | 'questionnaire'
  /** The questionnaire definition, unvalidated here. Parsed by the worker. */
  questionnaire?: unknown
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
  responder: string | null
  questionnaire: unknown
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

/** `conn` lets a caller write this inside its own transaction; default is the pool. */
export async function setMasterEnabled(agencyId: number, enabled: boolean, conn: Knex | Knex.Transaction = db): Promise<void> {
  await conn('agencies').where({ id: agencyId }).update({ autoResponseEnabled: enabled })
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
      'responder',
      'questionnaire',
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
    // Anything that is not exactly 'questionnaire' is the agent, so a database
    // that predates the column, or a value nobody recognises, keeps today's
    // behaviour rather than silencing a business.
    responder: row.responder === 'questionnaire' ? 'questionnaire' : 'agent',
    questionnaire: row.questionnaire ?? null,
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
  /** Written only by the response-method save (lib/inbox/autoresponse/responseMethod). Undefined leaves it alone. */
  responder?: 'agent' | 'questionnaire'
  /**
   * `undefined` leaves the stored profile alone; `null` clears it. Clearing
   * matters: a description saved while derivation was down must not keep serving
   * the profile built from the previous text.
   */
  businessProfile?: BusinessProfile | null
  /** Undefined leaves the stored profile untouched. */
  agentProfile?: AgentProfile | null
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
export async function upsertChannelSettings(input: UpsertChannelSettingsInput, conn: Knex | Knex.Transaction = db): Promise<void> {
  const replyMode = parseReplyMode(input.replyMode)
  const delaySeconds = clampDelaySeconds(input.delaySeconds)
  const fixedBody =
    replyMode === 'fixed' ? (input.fixedBody ?? '').trim().slice(0, MAX_FIXED_BODY_LENGTH) || null : input.fixedBody

  const optional: Record<string, unknown> = {}
  if (input.mode !== undefined) optional.mode = input.mode === 'qualify' ? 'qualify' : 'acknowledge'
  if (input.responder !== undefined) optional.responder = input.responder === 'questionnaire' ? 'questionnaire' : 'agent'
  if (input.businessProfile !== undefined) {
    optional.businessProfile = input.businessProfile ? JSON.stringify(input.businessProfile) : null
  }
  if (input.agentProfile !== undefined) {
    const stored = input.agentProfile ? storableAgentProfile(normalizeAgentProfile(input.agentProfile)) : null
    optional.agentProfile = stored ? JSON.stringify(stored) : null
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
    updatedAt: conn.fn.now(),
    ...optional,
  }

  await conn('auto_response_settings')
    .insert({
      agencyId: input.agencyId,
      channel: input.channel,
      ...shared,
    })
    .onConflict(['agencyId', 'channel'])
    .merge(shared)
}

/**
 * The owner's structured agent profile. A query of its own, and only ever made
 * for an agency on the conversational agent (IRE_CONVERSATIONAL_AGENCY_IDS):
 * `getChannelSettings` deliberately does not select the column, so every other
 * agency's reply path is unaffected even before the migration that adds it.
 */
export async function getAgentProfile(agencyId: number, channel: string): Promise<AgentProfile | null> {
  const row = (await db('auto_response_settings').where({ agencyId, channel }).first('agencyId', 'agentProfile')) as
    | { agencyId: number; agentProfile: unknown }
    | undefined
  if (!row || Number(row.agencyId) !== agencyId) return null
  return normalizeAgentProfile(row.agentProfile)
}
