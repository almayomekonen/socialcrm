import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'
import CommentsRouteSkeleton from '@/modules/facebookComments/components/CommentsRouteSkeleton'

/**
 * Content-shaped skeleton — mirrors the comment row layout (avatar, name line,
 * body, footer) so the shell stays put while the list loads.
 * `frontend-experience-guidelines.md` §3: skeletons shadow the destination
 * layout; they never invent one, and they respect reduced motion.
 *
 * Phone never receives the desktop `grid` fallback in the committed tree.
 */
export default function Loading() {
  return (
    <EntityLoading
      phone={<InboxListSkeletonMobile translated />}
      desktop={<CommentsRouteSkeleton />}
    />
  )
}
