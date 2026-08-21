import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { getMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'
import AutoResponseMobile from '@/modules/settings/mobile/AutoResponseMobile'

export const metadata: Metadata = { title: 'מענה אוטומטי' }

export default async function AutoResponseSettingsPage() {
  const user = await requireAgencyUser()

  /**
   * MOBILE מענה אוטומטי. The desktop form below is a seven-field configuration
   * screen — daily cap, delay, guidance, reply mode, fixed body, channel and
   * master. On a phone that is desk work, so the mobile branch renders status,
   * the configured message read-only, and the one control that is genuinely
   * urgent away from a computer: the master kill switch.
   *
   * Returned BEFORE the desktop's parallel reads, so a phone does no wasted
   * work and receives no desktop markup (architecture-rules.md §9). The desktop
   * path below is unchanged.
   */
  if (await isMobileWorkspaceRequest(user.agencyId)) {
    return <AutoResponseMobile agencyId={user.agencyId} role={user.role} />
  }

  /*
   * Pure-configuration page: the form's every control calls a
   * requireProductAccess-guarded action (setMasterEnabled, updateSettings), so
   * for a lapsed subscription each one was a doomed request.
   *
   * Placed AFTER the mobile branch above, which is left exactly as it was: the
   * mobile workspace owns its own routing and is out of scope here. That leaves
   * the phone's kill switch ungated — recorded as a known gap rather than fixed
   * by reaching into mobile routing.
   */
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return <SubscriptionExpiredState mode='page' source='auto_response_settings' feature='המענה האוטומטי מושהה.' />
  }

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
      replyMode={channel?.replyMode ?? 'ai'}
      fixedBody={channel?.fixedBody ?? null}
      delaySeconds={channel?.delaySeconds ?? 0}
    />
  )
}
