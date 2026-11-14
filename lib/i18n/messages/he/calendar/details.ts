/**
 * The meeting details dialog, outcome marking and the lead-status nudge, and
 * the two status badges (Phase E1). Hebrew copied verbatim. Badge labels are
 * keyed by the stored `meetings.sync_status` / `meetings.status` codes.
 */
export const details = {
  time: 'זמן',
  lead: 'ליד',
  viewLead: 'צפה בליד ←',
  syncError: 'פרטי כשל: ',
  openMeet: 'פתח Google Meet',
  marking: 'מסמן…',
  markCompleted: 'סמן כהושלמה',
  markNoShow: 'סמן כלא הגיע',
  close: 'סגור',
  retrying: 'מסנכרן…',
  retry: 'נסה לסנכרן שוב',
  edit: 'עריכת פגישה',
  cancelling: 'מבטל…',
  cancel: 'ביטול הפגישה',
  cancelConfirm: 'לבטל את הפגישה "{title}"?\nהמשתתפים יקבלו הודעת ביטול.',
} as const

/** Outcome marking (`markMeetingCompleted` / `markMeetingNoShow`) and the nudge's lead update. */
export const outcome = {
  completed: 'סומן כהושלמה',
  noShow: 'סומן כלא הגיע',
  failed: 'עדכון הפגישה נכשל',
  unexpected: 'אירעה שגיאה. נסה שוב.',
  leadUpdated: 'סטטוס הליד עודכן',
  leadUpdateFailed: 'עדכון הליד נכשל',
  error: {
    invalid_input: 'קלט לא תקין',
    not_found: 'הפגישה לא נמצאה',
    not_owner: 'אינך מורשה לעדכן פגישה זו',
    already_cancelled: 'הפגישה כבר בוטלה',
    already_completed: 'הפגישה כבר סומנה כהושלמה',
    already_no_show: 'הפגישה כבר סומנה כלא הגיע',
  },
  /** The nudge sentence ends with the suggested status pill. */
  nudge: 'סימנת את הפגישה כהושלמה. מומלץ לעדכן את סטטוס הליד ל-',
  notNow: 'לא עכשיו',
  updating: 'מעדכן…',
  apply: 'עדכן סטטוס ל{status}',
} as const

export const badge = {
  sync: { pending: 'מסונכרן…', synced: 'מסונכרן', failed: 'סנכרון נכשל', reauth_required: 'דרוש חיבור מחדש' },
  outcome: { completed: 'הושלמה', no_show: 'לא הגיע', cancelled: 'בוטלה' },
} as const
