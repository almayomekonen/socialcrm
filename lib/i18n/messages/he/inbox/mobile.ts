/**
 * MOBILE inbox chrome (`/inbox` on a phone, `modules/inbox/mobile/**`) — only
 * the copy the desktop does not already have as the same sentence. Everything
 * else the phone shows reuses the desktop's `inbox.*` keys (and
 * `leadDetail.readyMessage.*` for the ready-message sheet). Hebrew copied
 * verbatim from the components it came from.
 *
 * Never here: names, numbers, previews, message bodies, template titles and
 * bodies, the rep's search text — data, rendered exactly as stored.
 */
export const mobile = {
  thread: {
    openLead: 'פתח את הליד {name}',
    missingBody: 'ייתכן שהיא נמחקה או שאין לך גישה אליה.',
    empty: 'אין הודעות בשיחה הזו עדיין.',
    composerLabel: 'כתיבת הודעה',
    composerPlaceholder: 'כתיבת הודעה...',
    send: 'שלח',
    actions: 'פעולות הודעה',
    copy: 'העתק',
    copied: 'ההודעה הועתקה',
    copyFailed: 'לא הצלחנו להעתיק את ההודעה',
  },
  /** Refusals of `sendWhatsappReply`, keyed on the reason CODE the action returns. */
  send: {
    noConnection: 'אין חיבור וואטסאפ פעיל. אפשר לחבר אותו בהגדרות האינטגרציות.',
    noRecipient: 'אין מספר וואטסאפ תקין לליד הזה.',
    leadNotFound: 'הליד לא נמצא.',
    leadless: 'לא ניתן לשלוח הודעה משיחה בלי ליד.',
    sendFailed: 'וואטסאפ לא קיבל את ההודעה. נסה שוב בעוד רגע.',
    persistFailed: 'ההודעה נשלחה, אך לא נשמרה בשיחה. רענן את המסך.',
    tooLong: 'ההודעה ארוכה מדי.',
    invalidInput: 'לא ניתן לשלוח את ההודעה.',
    empty: 'אי אפשר לשלוח הודעה ריקה.',
    generic: 'לא הצלחנו לשלוח את ההודעה. נסה שוב.',
  },
  list: {
    /** "You:" before an outbound preview; the space after it is added by the row. */
    you: 'את/ה:',
    noMessages: 'אין הודעות עדיין',
    loadMore: 'טען עוד שיחות',
    searchPlaceholder: 'חיפוש שיחה',
    count: { other: '{count} שיחות' },
    deleteFailed: 'מחיקת השיחות נכשלה. נסה שוב.',
    deletePartial: 'חלק מהשיחות לא נמחקו. נסה שוב.',
    markReadFailed: 'לא הצלחנו לסמן כנקרא. נסה שוב.',
  },
  selection: {
    markRead: 'סמן כנקרא',
    delete: 'מחק',
    confirmTitle: 'מחיקת שיחות',
    confirmBody: {
      one: 'האם למחוק שיחה אחת?\nלא ניתן לשחזר את השיחות לאחר המחיקה.',
      other: 'האם למחוק {count} שיחות?\nלא ניתן לשחזר את השיחות לאחר המחיקה.',
    },
    confirm: { one: 'מחק שיחה', other: 'מחק שיחות' },
  },
  empty: {
    noResultsBody: 'אין תוצאות עבור "{q}".',
    noneTitle: 'אין עדיין שיחות',
    noneBody: 'כשלקוח ישלח הודעה בוואטסאפ, השיחה תופיע כאן.',
    settings: 'הגדרות וואטסאפ',
  },
  /** Relative time; the counted forms come from `Intl.RelativeTimeFormat` outside Hebrew. */
  time: {
    now: 'עכשיו',
  },
  /** Our label for a ready message whose title is a WhatsApp slug (`readyMessageTitle`). */
  readyTitle: {
    lead_first_contact: 'יצירת קשר ראשוני',
    follow_up: 'מעקב',
    ready_message: 'הודעה מוכנה',
  },
}
