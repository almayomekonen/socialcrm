/**
 * Links back to the comment on Facebook, so a rep can see the post it was left
 * on and confirm a reply landed. Built from ids we already store — no Graph
 * call, no token. Post ids arrive as `{pageId}_{postId}`, which facebook.com
 * resolves directly; `comment_id` on the post URL opens that comment.
 */

const SAFE_ID = /^[0-9_]+$/

export function facebookPostUrl(postId: string): string | null {
  return SAFE_ID.test(postId) ? `https://www.facebook.com/${postId}` : null
}

export function facebookCommentUrl(postId: string, commentId: string): string | null {
  const post = facebookPostUrl(postId)
  if (!post || !SAFE_ID.test(commentId)) return null
  const tail = commentId.includes('_') ? commentId.split('_').pop()! : commentId
  return `${post}?comment_id=${tail}`
}
