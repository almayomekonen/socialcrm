/**
 * First-run activation copy (desktop + mobile screens, paste panel, first
 * import banner). The Hebrew is the text of `lib/activation/firstRunCopy.ts`,
 * which now reads it from here — one source, so the two cannot drift.
 */
export const firstRun = {
  headline: 'סביבת העבודה שלכם פתוחה, עכשיו נכניס את הלידים',
  subhead: 'SocialCRM מרכז את הלידים מוואטסאפ וממודעות פייסבוק ואינסטגרם לרשימה אחת, עם סטטוס ומעקב לכל ליד.',
  connect: {
    heading: 'חברו את המקור שממנו מגיעים הלידים',
    rationale: 'מהרגע שתחברו, כל פנייה חדשה נכנסת לכאן אוטומטית, בלי להעתיק ידנית.',
    recommendedBadge: 'מומלץ',
    whatsapp: { title: 'וואטסאפ', description: 'כל הודעה נכנסת נפתחת כליד, והשיחה נשמרת כאן' },
    meta: { title: 'פייסבוק ואינסטגרם', description: 'לידים מהמודעות שלכם נכנסים אוטומטית' },
  },
  own: {
    heading: 'הכניסו את הלידים שיש לכם עכשיו',
    rationale: 'תוך דקה תראו רשימה אחת של כל מי שצריך לחזור אליו.',
    recommendedBadge: 'הכי מהיר',
    import: { title: 'הרשימה שלכם, מסודרת', description: 'קובץ אקסל, או פשוט הדביקו מספרי טלפון' },
    add: { title: 'הוסף ליד אחד', description: 'ידנית, כשאין רשימה לייבא' },
  },
  paste: {
    tabFile: 'קובץ',
    tabPaste: 'הדבקת מספרים',
    label: 'הדביקו מספרי טלפון, אחד בכל שורה',
    placeholder: '0521234567\nדנה לוי, 0537654321',
    hint: 'אפשר גם "שם, טלפון" בכל שורה.',
    submit: { one: 'הוסף ליד אחד', other: 'הוסף {count} לידים' },
    submitEmpty: 'הוסף לידים',
    pending: 'מוסיף…',
    skipped: { one: 'שורה אחת לא נקראה ולא תתווסף', other: '{count} שורות לא נקראו ולא יתווספו' },
    truncated: 'נוספו 1000 השורות הראשונות. אפשר להדביק את השאר אחר כך.',
    empty: 'לא זיהינו מספרי טלפון בטקסט שהודבק.',
    failed: 'לא הצלחנו להוסיף את הלידים. נסו שוב.',
    quota: 'הגעתם למכסת הלידים ({limit}). לא הוספנו את הרשימה.',
  },
  connected: {
    headline: 'אין עדיין לידים',
    subhead: 'חשבון ה־Meta שלך מחובר. הליד הראשון יופיע כאן אוטומטית ברגע שיגיע.',
  },
  statusConnected: 'מחובר',
  firstImport: {
    title: { one: 'הליד שלכם נכנס', other: '{count} לידים נכנסו' },
    body: 'הצעד הבא: פתחו את הראשון וקבעו מתי לחזור אליו.',
    skipped: { one: 'שורה אחת בקובץ לא נקראה ולא נוספה', other: '{count} שורות בקובץ לא נקראו ולא נוספו' },
    cta: 'פתח את הליד הראשון',
    dismiss: 'סגירה',
  },
} as const
