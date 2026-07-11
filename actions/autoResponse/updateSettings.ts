'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import {
  setMasterEnabled,
  upsertChannelSettings,
  parseReplyMode,
  clampDelaySeconds,
  MAX_FIXED_BODY_LENGTH,
  type AutoResponseReplyMode,
} from '@/db/autoResponseSettings'

export type UpdateAutoResponseInput = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  guidance: string | null
  replyMode: AutoResponseReplyMode
  fixedBody: string | null
  delaySeconds: number
}

export type UpdateAutoResponseResult = { ok: true } | { ok: false; reason: string }

const CHANNEL = 'whatsapp'

export async function updateAutoResponseSettings(input: UpdateAutoResponseInput): Promise<UpdateAutoResponseResult> {
  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  const dailyCap = Number.isFinite(input.dailyCap) ? Math.min(Math.max(Math.floor(input.dailyCap), 0), 100_000) : 200
  const guidance = (input.guidance ?? '').trim().slice(0, 1000) || null
  const replyMode = parseReplyMode(input.replyMode)
  const delaySeconds = clampDelaySeconds(input.delaySeconds)
  const fixedBody =
    replyMode === 'fixed' ? (input.fixedBody ?? '').trim().slice(0, MAX_FIXED_BODY_LENGTH) || null : (input.fixedBody ?? null)

  if (replyMode === 'fixed' && !fixedBody) {
    return { ok: false, reason: 'fixed_body_required' }
  }

  await setMasterEnabled(user.agencyId, !!input.masterEnabled)
  await upsertChannelSettings({
    agencyId: user.agencyId,
    channel: CHANNEL,
    enabled: !!input.channelEnabled,
    quietHours: {},
    dailyCap,
    guidance,
    replyMode,
    fixedBody,
    delaySeconds,
    updatedBy: user.id,
  })

  revalidatePath('/settings/auto-response')
  return { ok: true }
}
