import CommentsList from '@/modules/facebookComments/components/CommentsList'

/**
 * Phone comments feed: the same cards as desktop — one per row, identity and
 * comment first, post context compact — with 44px tap targets on every action.
 * One card implementation for both, so the two can never drift apart.
 */
export default function CommentsListMobile(props: Parameters<typeof CommentsList>[0]) {
  return <CommentsList {...props} touch />
}
