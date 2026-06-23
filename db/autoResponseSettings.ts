/**
 * Instant Response Engine settings (Phase 1). Workspace master switch lives on
 * agencies.autoResponseEnabled; per-channel config in auto_response_settings.
 * Additive, read/write only — no business logic. Re-engage fields (mode,
 * cooldown) are Phase 2.
 */
import { db } from '@/config/db'

export interface AutoResponseSettings {
  agencyId: number
  channel: string
  enabled: boolean
  quietHours: { tz?: string; startHour?: number; endHour?: number }
  dailyCap: number
  guidance: string | null
}

interface SettingsRow {
  agencyId: number
  channel: string
  enabled: boolean
  quietHours: AutoResponseSettings['quietHours'] | null
  dailyCap: number
  guidance: string | null
}

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
  return {
    agencyId: row.agencyId,
    channel: row.channel,
    enabled: row.enabled,
    quietHours: row.quietHours ?? {},
    dailyCap: row.dailyCap,
    guidance: row.guidance,
  }
}

export async function upsertChannelSettings(input: AutoResponseSettings & { updatedBy: number }): Promise<void> {
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
