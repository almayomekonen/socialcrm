import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'

export const metadata: Metadata = { title: 'מענה אוטומטי' }

export default async function AutoResponseSettingsPage() {
  const user = await requireAgencyUser()
  const [master, channel] = await Promise.all([
    getMasterEnabled(user.agencyId),
    getChannelSettings(user.agencyId, 'whatsapp'),
  ])

  return (
    <AutoResponseSettingsForm
      masterEnabled={master}
      channelEnabled={channel?.enabled ?? false}
      dailyCap={channel?.dailyCap ?? 200}
      guidance={channel?.guidance ?? null}
    />
  )
}
