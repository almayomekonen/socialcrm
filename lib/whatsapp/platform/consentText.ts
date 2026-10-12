/**
 * The consent the user ticks before a code is issued. The version is recorded
 * with the consent: ANY change to the text must bump the version.
 */
export const OWNER_WA_CONSENT = {
  version: 'v2',
  text: 'אני מאשר/ת לקבל מ-SocialCRM תזכורות בוואטסאפ על לידים שמחכים למענה, למספר שממנו אשלח את קוד ההפעלה. אפשר להפסיק בכל רגע: לשלוח "הסר" למספר של SocialCRM או לכבות בדף הזה.',
} as const
