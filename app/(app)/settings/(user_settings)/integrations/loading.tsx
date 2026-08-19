import Loading from '@/components/ui/Loading'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import IntegrationsSkeletonMobile from '@/components/mobile/skeletons/IntegrationsSkeletonMobile'
import ReadyMessagesSkeletonMobile from '@/components/mobile/skeletons/ReadyMessagesSkeletonMobile'
import { requestPathHint } from '@/components/mobile/skeletons/pathHint'

export default async function IntegrationsLoading() {
  if (await isPhoneEntity()) {
    const url = await requestPathHint()
    if (/section=templates/.test(url)) return <ReadyMessagesSkeletonMobile />
    return <IntegrationsSkeletonMobile />
  }
  return <Loading />
}
