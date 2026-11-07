/**
 * Read-time wording of STORED notifications (Phase F3). Each sentence is the
 * exact Hebrew an emitter writes (`lib/notifications/copy.ts`, via
 * `NOTIFICATION_REGISTRY`) with its data as a placeholder: `{name}` (a lead,
 * a Messenger / comment author — data, never translated), `{count}` (digits
 * from the stored text), `{provider}` (a `provider.*` label), `{agency}` (the
 * cancelling business's name). A stored row is re-worded only when this
 * catalog's Hebrew, with the values read back from the row, reproduces the
 * stored text byte for byte (`modules/notifications/display.ts`). Otherwise it
 * is shown as stored, inside a Hebrew region. Pinned per type against the
 * emitters by notificationsDisplayPin.test.ts.
 */

export const provider = {
  facebook: 'פייסבוק',
  whatsapp: 'WhatsApp',
} as const

export const title = {
  leadCreated: 'ליד חדש',
  leadCreatedNamed: 'ליד חדש — {name}',
  leadHot: 'ליד חם',
  leadHotNamed: 'ליד חם — {name}',
  questionnaireComplete: 'שאלון הושלם',
  questionnaireCompleteNamed: 'שאלון הושלם — {name}',
  waitingForRep: 'פנייה ממתינה לנציג',
  waitingForRepNamed: 'פנייה ממתינה לנציג — {name}',
  leadAssigned: 'ליד שויך אליך',
  leadAssignedNamed: 'ליד שויך אליך — {name}',
  leadsAssigned: 'לידים שויכו אליך',
  leadsAssignedCount: { one: '{count} לידים שויכו אליך', other: '{count} לידים שויכו אליך' },
  leadActivity: 'פעילות חדשה בליד',
  leadActivityNamed: 'פעילות חדשה בליד — {name}',
  insight: 'כדאי לחזור לליד',
  insightNamed: 'כדאי לחזור לליד — {name}',
  statusChanged: 'סטטוס עודכן',
  statusChangedNamed: 'סטטוס עודכן — {name}',
  messageInbound: 'הודעה חדשה',
  messageInboundNamed: 'הודעה חדשה — {name}',
  messagesInbound: { one: '{count} הודעות חדשות', other: '{count} הודעות חדשות' },
  messagesInboundNamed: { one: '{count} הודעות חדשות — {name}', other: '{count} הודעות חדשות — {name}' },
  messageUnanswered: 'הודעה ממתינה למענה',
  messageUnansweredNamed: 'הודעה ממתינה למענה — {name}',
  messengerInbound: 'הודעת Messenger חדשה',
  messengerInboundNamed: 'הודעת Messenger חדשה — {name}',
  messengerInboundCount: { one: '{count} הודעות Messenger חדשות', other: '{count} הודעות Messenger חדשות' },
  messengerInboundCountNamed: {
    one: '{count} הודעות Messenger חדשות — {name}',
    other: '{count} הודעות Messenger חדשות — {name}',
  },
  comment: 'תגובה חדשה',
  commentNamed: 'תגובה חדשה — {name}',
  followupDue: 'מעקב מתוכנן להיום',
  followupDueNamed: 'מעקב מתוכנן להיום — {name}',
  followupWaiting: 'מעקב ממתין',
  followupWaitingNamed: 'מעקב ממתין — {name}',
  disconnected: 'חיבור נותק',
  disconnectedProvider: 'החיבור ל{provider} נותק',
  connectionError: 'תקלה בחיבור',
  connectionErrorProvider: 'תקלה בחיבור ל{provider}',
  leadNotSaved: 'ליד לא נשמר',
  cancellation: 'ביטול מנוי דורש טיפול',
  reminderFailed: 'תזכורת לא נשלחה',
  reminderUnconfirmed: 'לא ניתן לוודא שתזכורת נשלחה',
} as const

export const body = {
  insight: 'נמצא משהו שכדאי לבדוק. פתח את הליד לפרטים.',
  reconnect: 'נדרש חיבור מחדש בהגדרות',
  leadNotSaved: 'הגיע ליד שלא נשמר במערכת',
  leadNotSavedProvider: 'הגיע ליד מ{provider} שלא נשמר במערכת',
  cancellation: 'עסק ביטל את מנוי SocialCRM. יש לבטל את הוראת הקבע שלו ב-Grow.',
  cancellationNamed: '{agency} ביטל את מנוי SocialCRM. יש לבטל את הוראת הקבע שלו ב-Grow.',
  reminderFailed: 'לא הצלחנו לשלוח לך בוואטסאפ את התזכורת שביקשת.',
  reminderFailedAt: 'לא הצלחנו לשלוח לך בוואטסאפ את התזכורת שביקשת ל-{when}.',
  reminderUnconfirmed: 'לא הצלחנו לוודא שהתזכורת שביקשת הגיעה אליך בוואטסאפ. ייתכן שהיא הגיעה, ולכן היא לא תישלח שוב אוטומטית.',
  reminderUnconfirmedAt: 'לא הצלחנו לוודא שהתזכורת שביקשת ל-{when} הגיעה אליך בוואטסאפ. ייתכן שהיא הגיעה, ולכן היא לא תישלח שוב אוטומטית.',
} as const
