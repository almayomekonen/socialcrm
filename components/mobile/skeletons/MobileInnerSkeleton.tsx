import InboxListSkeletonMobile from './InboxListSkeletonMobile'
import InboxThreadSkeletonMobile from './InboxThreadSkeletonMobile'
import IntegrationsSkeletonMobile from './IntegrationsSkeletonMobile'
import LeadDetailSkeletonMobile from './LeadDetailSkeletonMobile'
import LeadsSkeletonMobile from './LeadsSkeletonMobile'
import MoreSkeletonMobile from './MoreSkeletonMobile'
import NotificationsSkeletonMobile from './NotificationsSkeletonMobile'
import ReadyMessagesSkeletonMobile from './ReadyMessagesSkeletonMobile'
import TodaySkeletonMobile from './TodaySkeletonMobile'

/** Pick the skeleton that matches the destination, never a desktop table. */
export default function MobileInnerSkeleton({ path }: { path: string }) {
  if (/\/clients\/\d/.test(path)) return <LeadDetailSkeletonMobile />
  if (/\/leads/.test(path) || /\/clients(\/|$|\?)/.test(path)) return <LeadsSkeletonMobile />
  if (/\/inbox/.test(path) && /[?&]conversation=/.test(path)) return <InboxThreadSkeletonMobile />
  if (/\/inbox/.test(path)) return <InboxListSkeletonMobile />
  if (/\/notifications/.test(path)) return <NotificationsSkeletonMobile />
  if (/\/m(\/|$|\?)/.test(path)) return <MoreSkeletonMobile />
  if (/\/settings\/integrations/.test(path) && /section=templates/.test(path)) {
    return <ReadyMessagesSkeletonMobile />
  }
  if (/\/settings\/integrations/.test(path)) return <IntegrationsSkeletonMobile />
  if (/\/settings/.test(path)) return <MoreSkeletonMobile />
  return <TodaySkeletonMobile />
}
