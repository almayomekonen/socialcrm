/**
 * Why contacts show initials instead of real names and pictures.
 *
 * Shown ONLY when Meta has actually refused this app profile access (a
 * conversation recorded `profileStatus = 'denied'`) and ONLY to an admin — the
 * person who can do something about it. A rep cannot request a Meta feature, so
 * telling them would be noise they cannot act on (care charter, Law 7).
 *
 * It states a fact and a consequence, and stops. No badge, no count of affected
 * contacts, no "fix this" nag: messaging works perfectly without profile access,
 * and this is a cosmetic gap, not a failure. It is deliberately NOT an error
 * style — nothing is broken.
 */
export default function MessengerProfileAccessNotice() {
  return (
    <p role='status' className='border-b border-gray-100 px-3 py-2 text-[11px] leading-relaxed text-gray-500'>
      שמות ותמונות של פונים אינם זמינים: Meta טרם אישרה לאפליקציה גישה לפרטי הפרופיל
      (<span dir='ltr'>Business Asset User Profile Access</span>). שליחה וקבלה של הודעות פועלות כרגיל.
    </p>
  )
}
