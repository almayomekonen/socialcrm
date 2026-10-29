import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const comments: I['comments'] = {
  page: {
    title: 'Facebook comments',
    granted: 'Permission approved. You can reply to comments from here.',
    loading: 'Loading comments',
  },
  error: {
    title: "Couldn't load the comments",
    body: 'Something went wrong while loading the Facebook comments. You can try again or go back to conversations.',
  },
  empty: {
    notEnabled: {
      title: 'Facebook comments',
      body: 'Comments will appear here automatically once Facebook comments are turned on and the Page is connected.',
    },
    notConnected: {
      title: 'Your Facebook Page is not connected',
      body: 'To see comments from your Page, connect it in Settings first.',
      action: 'Connect your Facebook Page',
    },
    noComments: {
      title: 'No comments yet',
      body: 'New comments on your Page posts will appear here automatically.',
    },
    noOpen: {
      title: 'No open comments',
      body: 'New comments on your Page posts will appear here automatically. Every comment is listed under "All".',
    },
    noConverted: {
      title: 'No leads created from comments yet',
      body: 'When you create a lead from a comment, it appears here with a link to the lead.',
    },
  },
  filter: {
    label: 'Filter comments',
    all: 'All',
    open: 'Open',
    converted: 'Converted to lead',
  },
  list: {
    label: 'Facebook comments',
    loadMore: 'Load more comments',
    loadingMore: 'Loading comments...',
    loadMoreFailed: "Couldn't load more comments. Try again.",
  },
  card: {
    label: 'Comment by {name}',
    fallbackAuthor: 'Facebook commenter',
    channel: 'Facebook',
    isReply: 'Reply to a comment',
    avatarFallback: 'L',
    reply: 'Reply to comment',
    badge: {
      converted: 'Converted to lead',
      ignored: 'Ignored',
      deleted: 'Deleted on Facebook',
    },
  },
  body: {
    more: 'Show more',
    less: 'Show less',
    noText: "The comment text wasn't received from Facebook",
    photo: 'Photo attached to the comment',
    photoGone: 'The photo attached to the comment is no longer available',
    video: 'Watch the video attached to the comment',
  },
  post: {
    gone: 'The post is no longer available on Facebook',
    onPost: 'Comment on the post',
    inThread: 'Comment in a thread on the post',
    open: 'Open the post on Facebook',
  },
  thread: {
    label: 'Replies in the thread',
    page: 'The Page',
    yourPage: '{name} (your Page)',
    sentHere: 'Sent from SocialCRM',
  },
  reply: {
    label: 'Reply as the Page to {name}',
    labelNoName: 'Reply as the Page to the comment',
    placeholder: 'Write a reply as the Page...',
    publish: 'Post reply',
    publishing: 'Posting...',
    emptyHint: 'Write a reply to post it',
    cancel: 'Cancel',
    published: 'Reply posted on Facebook',
    thrown: "We couldn't post the reply. Check your connection and try again.",
    expired: 'Renewing your subscription restores replying to comments',
    failure: {
      not_enabled: "This feature isn't available on this account",
      not_found: 'Comment not found',
      deleted: "The comment was deleted on Facebook and can't be replied to",
      page_authored: "You can't reply to a comment made by the Page itself",
      empty: 'Write a reply before posting',
      too_long: 'The reply is too long',
      permission_missing: 'Permission to reply to comments is missing. Approve the permission at the top of the page and try again.',
      reconnect_required: 'The connection to your Facebook Page has expired. Reconnect the Page in Settings and try again.',
      comment_unavailable: 'The comment is no longer available on Facebook. It may have been deleted or hidden.',
      rate_limited: 'Facebook is limiting the action rate right now. Try again in a few minutes.',
      blocked: "Facebook has temporarily blocked posting comments from the Page. It's worth checking the notifications on your Facebook Page.",
      meta_error: "Facebook didn't accept the reply. Try again.",
    },
  },
  convert: {
    action: 'Convert to lead',
    converting: 'Converting to lead...',
    open: 'Open lead',
    created: 'Lead created',
    existing: 'This comment is already linked to an existing lead',
    createdToast: 'Lead created · Open lead',
    existingToast: 'This comment is already linked to an existing lead · Open lead',
    thrown: "We couldn't finish creating the lead. Check your connection and try again.",
    expired: 'Renewing your subscription restores converting comments to leads',
    failure: {
      not_found: 'Comment not found. Refresh the page and try again.',
      deleted: "The comment was deleted on Facebook, so a lead can't be created from it.",
      page_authored: "This is a comment by your Page, so a lead can't be created from it.",
      not_enabled: "Creating leads from comments isn't available on this account.",
      quota_exceeded: "You've reached your plan's lead limit. Upgrade your plan to create a lead from this comment.",
      create_failed: "The lead wasn't created. Try again.",
      db_error: "We couldn't finish creating the lead. Try again.",
    },
  },
}
