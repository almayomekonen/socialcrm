/**
 * Instant Response Engine settings (Phase 1). Workspace master switch lives on
 * agencies.autoResponseEnabled; per-channel config in auto_response_settings.
 * Additive, read/write only — no business logic. Re-engage fields (mode,
 * cooldown) are Phase 2.
 */
import { db } from '@/config/db'

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
  guidance: string | null
  // Qualifier (P0b additive). Defaults reproduce one-shot acknowledge behavior.
  mode: 'acknowledge' | 'qualify'
  maxTurns: number
  collectFields: CollectFields
  draft: boolean
}

interface SettingsRow {
  agencyId: number
  channel: string
  enabled: boolean
  quietHours: AutoResponseSettings['quietHours'] | null
  dailyCap: number
  guidance: string | null
  mode: string | null
  maxTurns: number | null
  collectFields: CollectFields | string | null
  draft: boolean | null
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
  const row = (await db('auto_response_settings').where({ agencyId, channel }).first()) as SettingsRow | undefined
  if (!row) return null
  const cf = row.collectFields
  return {
    agencyId: row.agencyId,
    channel: row.channel,
    enabled: row.enabled,
    quietHours: row.quietHours ?? {},
    dailyCap: row.dailyCap,
    guidance: row.guidance,
    mode: row.mode === 'qualify' ? 'qualify' : 'acknowledge',
    maxTurns: row.maxTurns ?? 5,
    collectFields: (typeof cf === 'string' ? JSON.parse(cf) : (cf ?? DEFAULT_COLLECT)) as CollectFields,
    draft: row.draft ?? false,
  }
}

export type UpsertChannelSettingsInput = Pick<
  AutoResponseSettings,
  'agencyId' | 'channel' | 'enabled' | 'quietHours' | 'dailyCap' | 'guidance'
> & { updatedBy: number }

export async function upsertChannelSettings(input: UpsertChannelSettingsInput): Promise<void> {
  await db('auto_response_settings')
    .insert({
      agencyId: input.agencyId,
      channel: input.channel,
      enabled: input.enabled,
      quietHours: JSON.stringify(input.quietHours ?? {}),
      dailyCap: input.dailyCap,
      guidance: input.guidance,
      updatedBy: input.updatedBy,
      updatedAt: db.fn.now(),
    })
    .onConflict(['agencyId', 'channel'])
    .merge({
      enabled: input.enabled,
      quietHours: JSON.stringify(input.quietHours ?? {}),
      dailyCap: input.dailyCap,
      guidance: input.guidance,
      updatedBy: input.updatedBy,
      updatedAt: db.fn.now(),
    })
}
