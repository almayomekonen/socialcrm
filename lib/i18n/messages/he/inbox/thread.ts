/**
 * Inbox THREAD chrome (`/inbox`, desktop): the conversation header, bubble
 * labels for assistive tech, delivery states, failure copy (by persisted
 * CATEGORY), reactions, quotes, media. Hebrew copied verbatim.
 *
 * Never here: message bodies, captions, quoted text, emoji, file names,
 * contact names and numbers — data, rendered exactly as stored.
 */
export const header = {
  title: 'שיחת WhatsApp',
  lastActivity: 'פעילות אחרונה {date}',
  needsReply: 'דורש מענה',
  repReplied: 'הנציג השיב לאחרונה',
  call: 'התקשר',
  leadCard: 'כרטיס ליד',
}

export const conversation = {
  emptyTitle: 'אין הודעות WhatsApp עדיין',
  emptyLead: 'כשהליד יכתוב, ההודעות יופיעו כאן.',
  emptyContact: 'כשתגיע הודעה, היא תופיע כאן.',
  messages: 'הודעות השיחה',
  inbound: 'הודעה נכנסת',
  outbound: 'הודעה שנשלחה מהמערכת',
  newMessage: 'התקבלה הודעת WhatsApp חדשה',
}

export const status = {
  sent: 'נשלח — ממתין לאישור מסירה',
  delivered: 'נמסר',
  read: 'נקרא',
  failed: 'לא נשלח',
}

/** Failure copy keyed on the persisted category (`inbox_messages.errorReason`). */
export const failure = {
  window_expired: 'ההודעה לא נשלחה — עברו יותר מ־24 שעות מאז שהליד כתב. אפשר להתקשר אליו.',
  recipient: 'ההודעה לא נשלחה — המספר אינו פעיל ב־WhatsApp.',
  account: 'ההודעה לא נשלחה — שליחת הודעות מושבתת כרגע. נדרשת בדיקה בהגדרות החשבון.',
  generic: 'ההודעה לא נשלחה. נסה שוב.',
}

export const tooltip = {
  window_expired: {
    title: 'לא ניתן לשלוח את ההודעה',
    explanation: 'WhatsApp מאפשרת לשלוח הודעה רגילה רק עד 24 שעות מההודעה האחרונה של הלקוח.',
    action: 'כדי ליצור איתו קשר עכשיו, אפשר להתקשר אליו.',
  },
  recipient: {
    title: 'לא ניתן לשלוח את ההודעה',
    explanation: 'נראה שהמספר הזה לא זמין ב־WhatsApp.',
    action: 'בדוק שהמספר נכון או צור קשר עם הלקוח בדרך אחרת.',
  },
  account: {
    title: 'לא ניתן לשלוח הודעות כרגע',
    explanation: 'WhatsApp לא מאפשרת כרגע לשלוח הודעות מהחשבון המחובר.',
    action: 'בדוק את חשבון WhatsApp המחובר ל־SocialCRM.',
  },
  generic: {
    title: 'ההודעה לא נשלחה',
    explanation: 'WhatsApp לא הצליחה לשלוח את ההודעה.',
    action: 'אפשר לנסות שוב בעוד כמה רגעים.',
  },
}

export const reaction = {
  list: 'תגובות להודעה',
  sent: 'תגובה שנשלחה',
  received: 'תגובה נכנסת',
  onEarlier: 'על הודעה קודמת',
}

export const quote = {
  label: 'ציטוט',
  notFound: 'תגובה להודעה קודמת',
}

/** What a quoted message WAS, when it has no text (by message type). */
export const kind = {
  image: 'תמונה',
  video: 'סרטון',
  document: 'מסמך',
  audio: 'הודעה קולית',
  sticker: 'מדבקה',
  location: 'מיקום',
  contacts: 'איש קשר',
  message: 'הודעה',
}

export const media = {
  unsupported: 'הודעה מסוג שאינו נתמך עדיין',
  unnamedFile: 'קובץ מוואטסאפ',
  unnamedAudio: 'הקלטה מוואטסאפ',
  kindImage: 'תמונה',
  kindAudio: 'הקלטה',
  kindVideo: 'וידאו',
  imageAlt: 'תמונה שהתקבלה בוואטסאפ',
  showImage: 'הצג את התמונה {name}',
  openFile: 'פתח את הקובץ {name}',
  open: 'פתח',
  play: 'נגן הקלטה',
  pause: 'השהה הקלטה',
  seek: 'מיקום בהקלטה',
  viewer: 'תצוגת תמונה',
}
