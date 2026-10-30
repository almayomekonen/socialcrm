import InboxListSkeletonMobile from './InboxListSkeletonMobile'
import InboxThreadSkeletonMobile from './InboxThreadSkeletonMobile'
import IntegrationsSkeletonMobile from './IntegrationsSkeletonMobile'
import LeadDetailSkeletonMobile from './LeadDetailSkeletonMobile'
import LeadsSkeletonMobile from './LeadsSkeletonMobile'
import MoreSkeletonMobile from './MoreSkeletonMobile'
import NotificationsSkeletonMobile from './NotificationsSkeletonMobile'
import ReadyMessagesSkeletonMobile from './ReadyMessagesSkeletonMobile'
import TodaySkeletonMobile from './TodaySkeletonMobile'

/**
 * Pick the skeleton that matches the destination, never a desktop table.
 * Every screen-reader line follows the interface language (i18n Phase F1):
 * the inbox skeletons are opted in with `translated`, the others read it
 * themselves (`LoadingStatus`). Hebrew markup is unchanged.
 */
export default function MobileInnerSkeleton({ path }: { path: string }) {
  if (/\/clients\/\d/.test(path)) return <LeadDetailSkeletonMobile />
  if (/\/leads/.test(path) || /\/clients(\/|$|\?)/.test(path)) return <LeadsSkeletonMobile />
  if (/\/inbox/.test(path) && /[?&]conversation=/.test(path)) return <InboxThreadSkeletonMobile translated />
  if (/\/inbox/.test(path)) return <InboxListSkeletonMobile translated />
  if (/\/notifications/.test(path)) return <NotificationsSkeletonMobile />
  if (/\/m(\/|$|\?)/.test(path)) return <MoreSkeletonMobile />
  if (/\/settings\/integrations/.test(path) && /section=templates/.test(path)) {
    return <ReadyMessagesSkeletonMobile />
  }
  if (/\/settings\/integrations/.test(path)) return <IntegrationsSkeletonMobile />
  if (/\/settings/.test(path)) return <MoreSkeletonMobile />
  return <TodaySkeletonMobile />
}
