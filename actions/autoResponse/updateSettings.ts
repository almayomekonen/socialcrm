'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { setMasterEnabled, upsertChannelSettings } from '@/db/autoResponseSettings'

export type UpdateAutoResponseInput = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  guidance: string | null
}

export type UpdateAutoResponseResult = { ok: true } | { ok: false; reason: string }

const CHANNEL = 'whatsapp'

export async function updateAutoResponseSettings(input: UpdateAutoResponseInput): Promise<UpdateAutoResponseResult> {
  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  const dailyCap = Number.isFinite(input.dailyCap) ? Math.min(Math.max(Math.floor(input.dailyCap), 0), 100_000) : 200
  const guidance = (input.guidance ?? '').trim().slice(0, 1000) || null

  await setMasterEnabled(user.agencyId, !!input.masterEnabled)
  await upsertChannelSettings({
    agencyId: user.agencyId,
    channel: CHANNEL,
    enabled: !!input.channelEnabled,
    quietHours: {},
    dailyCap,
    guidance,
    updatedBy: user.id,
  })

  revalidatePath('/settings/auto-response')
  return { ok: true }
}
