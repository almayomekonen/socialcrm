/**
 * Fixed data + mutable state behind the MESSENGER and COMMENTS inbox mocks
 * (`/inbox/messenger`, `/inbox/comments`): the Hebrew baseline, the leak gate,
 * the locale and behaviour tests.
 *
 * Customer data is Hebrew on purpose (names, message bodies, comment and post
 * text, saved-reply bodies, button labels the customer tapped): it must reach the
 * screen untouched by any localization.
 */
import { NOW } from './leadsFixtures'

export { NOW }

const MIN = 60_000
const HOUR = 60 * MIN
const ago = (ms: number) => new Date(NOW - ms)

export const MC_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

const MESSENGER_SCOPES = JSON.stringify(['pages_messaging', 'pages_manage_metadata', 'pages_show_list'])
const REPLY_SCOPES = JSON.stringify(['pages_manage_engagement', 'pages_read_user_content', 'pages_show_list'])
export const PAGE_MESSENGER = { page_id: 'p1', granted_scopes: MESSENGER_SCOPES, health_checked_at: null }
export const PAGE_NO_MESSENGER = { page_id: 'p2', granted_scopes: '["pages_show_list"]', health_checked_at: null }
export const PAGE_REPLIES = { page_id: 'p1', granted_scopes: REPLY_SCOPES }
export const PAGE_NO_REPLIES = { page_id: 'p2', granted_scopes: '["pages_show_list"]' }

// ── Messenger ────────────────────────────────────────────────────────────────

const conversation = (id: number, extra: Record<string, unknown>) => ({
  id,
  pageId: 'p1',
  customerName: null,
  leadId: null,
  leadName: null,
  lastMessageAt: ago(id * HOUR),
  lastInboundAt: ago(id * HOUR),
  lastMessageText: null,
  lastDirection: 'inbound',
  unread: false,
  profilePicUrl: null,
  profileStatus: 'ok',
  ...extra,
})

/** Unread + linked lead; replied (outbound last); nameless (fallback) + profile denied. */
export const CONVERSATIONS = [
  conversation(1, {
    customerName: 'נועה ברק',
    leadId: 51,
    leadName: 'נועה ברק',
    lastMessageText: 'שלום, אפשר פרטים על המבצע?',
    unread: true,
  }),
  conversation(2, { customerName: 'אורי שמש', lastDirection: 'outbound', lastMessageText: 'בשמחה, שלחתי מחירון' }),
  conversation(3, { lastMessageText: 'מתי אתם פתוחים?', profileStatus: 'denied', lastMessageAt: ago(30 * HOUR) }),
]

const message = (id: number, minutesAgo: number, extra: Record<string, unknown>) => ({
  id,
  direction: 'inbound',
  source: 'customer',
  text: '',
  attachments: [],
  timestamp: ago(minutesAgo * MIN),
  deliveredAt: null,
  readAt: null,
  ...extra,
})
const out = (id: number, minutesAgo: number, extra: Record<string, unknown>) =>
  message(id, minutesAgo, { direction: 'outbound', source: 'socialcrm', ...extra })

/** Every bubble the thread draws, across two days. */
export const MESSAGES = [
  message(1, 26 * 60, { text: 'שלום, ראיתי את המודעה שלכם' }),
  out(2, 26 * 60 - 5, { text: 'היי נועה, איך אפשר לעזור?', deliveredAt: ago(26 * 60 * MIN), readAt: ago(26 * 60 * MIN) }),
  message(3, 3 * 60, { attachments: [{ type: 'image', url: 'https://cdn.test/a.jpg' }] }),
  message(4, 3 * 60 - 1, { attachments: [{ type: 'image', url: 'https://cdn.test/s.png', sticker: true }] }),
  message(5, 3 * 60 - 2, { attachments: [{ type: 'share', url: 'https://example.test/p', title: 'המבצע של החודש' }] }),
  message(6, 3 * 60 - 3, { attachments: [{ type: 'share', url: null, title: null }] }),
  message(7, 3 * 60 - 4, { attachments: [{ type: 'audio', url: 'https://cdn.test/v.mp4' }] }),
  message(8, 3 * 60 - 5, { attachments: [{ type: 'video', url: 'https://cdn.test/m.mp4' }] }),
  message(9, 3 * 60 - 6, { attachments: [{ type: 'file', url: 'https://cdn.test/f.pdf' }] }),
  message(10, 3 * 60 - 7, { attachments: [{ type: 'unsupported', url: null }] }),
  message(11, 3 * 60 - 8, { attachments: [{ type: 'image', url: null }] }),
  message(12, 3 * 60 - 9, { text: '' }),
  out(13, 2 * 60, { text: 'המחיר 300 ₪ לחודש' }),
  out(14, 110, { text: 'נשלח גם קטלוג', deliveredAt: ago(100 * MIN) }),
  out(15, 100, { source: 'page_inbox', text: 'עניתי גם מהדף' }),
  out(16, 95, { source: 'other_app', text: 'הודעה מאפליקציה אחרת' }),
  message(17, 60, { text: 'תודה, אחשוב על זה', attachments: [{ type: 'image', url: 'https://cdn.test/b.jpg' }] }),
]

/** Postbacks (labelled, Get Started, unlabelled), referrals (known, unknown), opt-in, reactions. */
export const EVENTS = [
  { id: 1, kind: 'referral', title: 'ADS', payload: 'summer', targetMessageId: null, occurredAt: ago(26 * 60 * MIN - 1) },
  { id: 2, kind: 'postback', title: null, payload: 'GET_STARTED', targetMessageId: null, occurredAt: ago(26 * 60 * MIN - 2) },
  { id: 3, kind: 'postback', title: 'לקבוע תור', payload: 'BOOK', targetMessageId: null, occurredAt: ago(150 * MIN) },
  { id: 4, kind: 'postback', title: null, payload: 'MENU_X', targetMessageId: null, occurredAt: ago(140 * MIN) },
  { id: 5, kind: 'referral', title: 'SOMETHING_NEW', payload: null, targetMessageId: null, occurredAt: ago(130 * MIN) },
  { id: 6, kind: 'referral', title: 'SHORTLINK', payload: null, targetMessageId: null, occurredAt: ago(125 * MIN) },
  { id: 7, kind: 'optin', title: null, payload: null, targetMessageId: null, occurredAt: ago(120 * MIN) },
  { id: 8, kind: 'reaction', title: 'react', payload: '❤️', targetMessageId: 13, occurredAt: ago(115 * MIN) },
  { id: 9, kind: 'reaction', title: 'react', payload: null, targetMessageId: 13, occurredAt: ago(114 * MIN) },
]

export const SAVED_REPLIES = [
  { id: 1, title: 'שעות פעילות', body: 'אנחנו פתוחים א׳-ה׳ 9:00-18:00', quickReplies: [], buttons: [], attachmentUrl: null, attachmentType: null },
  {
    id: 2,
    title: 'קביעת תור',
    body: 'רוצה לקבוע תור?',
    quickReplies: [],
    buttons: [{ type: 'postback', title: 'כן', payload: 'YES' }],
    attachmentUrl: null,
    attachmentType: null,
  },
]

export const MESSENGER_DEFAULTS = {
  user: MC_USER as Record<string, unknown>,
  enabled: true,
  mobile: false,
  pages: [PAGE_MESSENGER] as Record<string, unknown>[],
  conversations: CONVERSATIONS as Record<string, unknown>[],
  /** The selected conversation id (`?c=`); null = nothing selected. */
  selectedId: null as number | null,
  /** Overrides for the selected conversation (e.g. a closed window). */
  selectedOverrides: {} as Record<string, unknown>,
  messages: MESSAGES as Record<string, unknown>[],
  hasMore: false,
  events: EVENTS as Record<string, unknown>[],
  savedReplies: SAVED_REPLIES as Record<string, unknown>[],
  delivery: 'ready' as 'ready' | 'not_subscribed' | 'reconnect' | 'unknown',
}

export const messengerEnv = { ...MESSENGER_DEFAULTS }

// ── Comments ─────────────────────────────────────────────────────────────────

const LONG = 'אני מתעניינת מאוד במוצר. '.repeat(14).trim()

const comment = (id: number, extra: Record<string, unknown>) => ({
  id,
  pageId: 'p1',
  commentId: `${9000 + id}`,
  postId: '111_1',
  parentId: '111_1',
  isTopLevel: true,
  authorName: null,
  message: '',
  messageAvailable: true,
  status: 'open',
  convertedLeadId: null,
  createdTime: ago(id * HOUR),
  receivedAt: ago(id * HOUR),
  authorPictureUrl: null,
  attachmentType: null,
  attachmentUrl: null,
  ...extra,
})

/** Open; converted; ignored; deleted; a reply with no text; photo; video; long; nameless on an unavailable post. */
export const COMMENTS = [
  comment(1, { authorName: 'מיכל דוד', message: 'כמה זה עולה?' }),
  comment(2, { authorName: 'יעל גבאי', message: 'שלחתי הודעה', status: 'converted', convertedLeadId: 61 }),
  comment(3, { authorName: 'רון אלון', message: 'לא רלוונטי', status: 'ignored' }),
  comment(4, { authorName: 'גיל נחום', message: 'תגובה שנמחקה', status: 'deleted' }),
  comment(5, { authorName: 'שירה טל', isTopLevel: false, parentId: '9001', messageAvailable: false }),
  comment(6, { authorName: 'עדי לוי', message: 'כזה?', attachmentType: 'photo', attachmentUrl: 'https://cdn.test/c.jpg' }),
  comment(7, { authorName: 'עומר חן', message: 'ראו את הסרטון', attachmentType: 'video', attachmentUrl: 'https://cdn.test/c.mp4' }),
  comment(8, { authorName: 'ליאת כץ', message: LONG }),
  comment(9, { postId: '111_2', parentId: '111_2', message: 'יש משלוחים?' }),
]

export const POSTS = [
  { pageId: 'p1', postId: '111_1', message: 'מבצע סתיו: 20% הנחה על כל החבילות', pictureUrl: 'https://cdn.test/post.jpg', permalinkUrl: null, fetchStatus: 'ok' },
  { pageId: 'p1', postId: '111_2', message: null, pictureUrl: null, permalinkUrl: null, fetchStatus: 'unavailable' },
]

export const REPLIES = [
  { id: 101, pageId: 'p1', commentId: '9101', parentId: '9001', authorName: 'הסטודיו של דנה', authorIsPage: true, sentByUserId: 7, message: 'שלחנו לך פרטים בפרטי', messageAvailable: true, status: 'open', createdTime: ago(50 * MIN), receivedAt: ago(50 * MIN) },
  { id: 102, pageId: 'p1', commentId: '9102', parentId: '9001', authorName: 'אבי רז', authorIsPage: false, sentByUserId: null, message: 'גם אני רוצה', messageAvailable: true, status: 'open', createdTime: ago(40 * MIN), receivedAt: ago(40 * MIN) },
  { id: 103, pageId: 'p1', commentId: '9103', parentId: '9001', authorName: null, authorIsPage: true, sentByUserId: null, message: '', messageAvailable: false, status: 'open', createdTime: ago(30 * MIN), receivedAt: ago(30 * MIN) },
]

export const COMMENTS_DEFAULTS = {
  enabled: true,
  repliesEnabled: true,
  mobile: false,
  pages: [PAGE_REPLIES] as Record<string, unknown>[],
  items: COMMENTS as Record<string, unknown>[],
  replies: REPLIES as Record<string, unknown>[],
  posts: POSTS as Record<string, unknown>[],
  nextCursor: null as { receivedAt: string; id: number } | null,
  openCount: 6 as number | null,
}

export const commentsEnv = { ...COMMENTS_DEFAULTS }

export function resetMessengerCommentsEnv() {
  Object.assign(messengerEnv, MESSENGER_DEFAULTS)
  Object.assign(commentsEnv, COMMENTS_DEFAULTS)
}

export const ACTIVE = { hasAccess: true, status: 'ACTIVE', expiresAt: null }
export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T12:00:00.000Z' }

/** Customer data the screens show verbatim (leak-gate allowances draw only from here). */
export const MC_CUSTOMER_DATA = [
  ...CONVERSATIONS.flatMap((c) => [c.customerName, c.leadName, c.lastMessageText]),
  ...MESSAGES.map((m) => m.text),
  ...EVENTS.map((e) => e.title),
  'המבצע של החודש',
  ...SAVED_REPLIES.flatMap((r) => [r.title, r.body]),
  ...COMMENTS.flatMap((c) => [c.authorName, c.message]),
  ...POSTS.map((p) => p.message),
  ...REPLIES.flatMap((r) => [r.authorName, r.message]),
].filter((v): v is string => typeof v === 'string' && /[֐-׿]/.test(v))
