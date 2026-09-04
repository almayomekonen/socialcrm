/**
 * First-run activation copy — ONE source of truth for desktop and mobile.
 *
 * WHY THIS FILE EXISTS. The two first-run screens had already drifted into
 * different products. Desktop opened with "בוא נכניס את הלידים שלך ל־SocialCRM";
 * mobile opened with "בואו נתחיל" — a greeting carrying no information at all.
 * Desktop described WhatsApp as "נהל שיחות עם לקוחות במקום אחד"; mobile labelled
 * the same row "לא מחובר". Neither screen contained a single sentence saying what
 * SocialCRM would do for the business reading it.
 *
 * Layout stays platform-specific — a phone list and a desktop tile grid are
 * genuinely different jobs. The MESSAGE does not get to differ, so it lives here
 * where it cannot drift again.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THE COPY FOLLOWS: outcome before work.
 *
 * A brand-new user is asked to do something only after being told what it will
 * produce. Every string below names a result, never a mechanism and never a
 * configuration state. Production evidence for why: four consecutive mobile
 * signups reached the workspace, were shown four things to do and no reason to
 * do any of them, and left within 4–8 seconds without touching a control.
 *
 * ---------------------------------------------------------------------------
 * HONESTY CONSTRAINTS — each of these was checked against the code, not assumed.
 * `care-charter.md` Law 1: the product never claims a capability it lacks.
 *
 *  · "מהמודעות" is load-bearing and must not be dropped from the Meta line.
 *    Meta ingestion is LEAD ADS only (`lib/system/createClientFromWebhook.ts`,
 *    driven by the leadgen webhook). Facebook and Instagram DMs are NOT
 *    ingested. "לידים מפייסבוק ואינסטגרם" without "מהמודעות" would promise a
 *    product that does not exist.
 *  · The WhatsApp line claims two things and both are true:
 *    `lib/system/createLeadFromWhatsappWebhook.ts` creates the lead, and the
 *    inbox retains the conversation.
 *  · No volume, count, or timing promise anywhere. Nothing like "leads within
 *    24 hours" — we do not control when someone's ad delivers.
 *  · Terminology is `ux-guidelines.md` §6: ליד / לידים only. This file replaces
 *    two live uses of "לקוחות" on the desktop screen.
 *  · No emoji (`CLAUDE.md` §12).
 *
 * ---------------------------------------------------------------------------
 * VOICE. Prose addresses the user in the plural (חברו / הוסיפו); button labels
 * stay singular imperative (הוסף ליד), which is the convention already used
 * across the app's controls. Desktop previously mixed singular prose into the
 * same screen as plural mobile prose; unifying on plural gives the product one
 * voice, per `frontend-experience-guidelines.md` §22.
 */

export const FIRST_RUN_COPY = {
  /**
   * The sentence the screen never had. Answers "what is this" before anything
   * is asked of the reader. Verb-free on purpose so one string serves both
   * surfaces without a singular/plural fork.
   */
  /**
   * States the true state of the account: OPEN, and empty. Never "ready".
   *
   * "מוכן" was the product's habit — the welcome modal said the Pro plan was
   * ready, the activation screen said the workspace was ready — and both were
   * true about the software while the user still had nothing. A new user heard
   * a claim about their business, went looking for the part that was ready,
   * and left. Naming the emptiness is what makes the next line worth reading.
   */
  headline: 'סביבת העבודה שלכם פתוחה — עכשיו נכניס את הלידים',
  subhead:
    'SocialCRM מרכז את הלידים מוואטסאפ וממודעות פייסבוק ואינסטגרם לרשימה אחת, עם סטטוס ומעקב לכל ליד.',

  /**
   * PATH 1 — the product promise. Connecting is what makes the CRM fill itself,
   * so it is recommended. It is not the only legitimate path: it delivers zero
   * leads today and only pays off on the next inbound.
   */
  connect: {
    heading: 'חברו את המקור שממנו מגיעים הלידים',
    rationale: 'מהרגע שתחברו, כל פנייה חדשה נכנסת לכאן אוטומטית, בלי להעתיק ידנית.',
    recommendedBadge: 'מומלץ',
    whatsapp: {
      title: 'וואטסאפ',
      description: 'כל הודעה נכנסת נפתחת כליד, והשיחה נשמרת כאן',
      href: '/settings/integrations?section=whatsapp',
    },
    meta: {
      title: 'פייסבוק ואינסטגרם',
      description: 'לידים מהמודעות שלכם נכנסים אוטומטית',
      href: '/settings/integrations?section=facebook',
    },
  },

  /**
   * PATH 2 — immediate value, and deliberately NOT framed as a fallback.
   *
   * `product.md` §7 names the Excel import as the product's first success
   * moment ("within 60 seconds they can see all their leads organized"), and it
   * is the only path that delivers real data on day one. It gets its own
   * heading and its own reason to exist, not a footnote under the "real" option.
   */
  own: {
    heading: 'הכניסו את הלידים שיש לכם עכשיו',
    rationale: 'תוך דקה תראו רשימה אחת של כל מי שצריך לחזור אליו.',
    recommendedBadge: 'הכי מהיר',
    /**
     * Named by its OUTCOME, not by its file format. "ייבוא מאקסל" describes a
     * mechanism the user has no appetite for; "הרשימה שלכם, מסודרת" describes
     * the thing they came to get. The formats belong in the description, where
     * they answer "can I?" instead of asking "do you want to?".
     */
    import: {
      title: 'הרשימה שלכם, מסודרת',
      description: 'קובץ אקסל, או פשוט הדביקו מספרי טלפון',
    },
    add: { title: 'הוסף ליד אחד', description: 'ידנית, כשאין רשימה לייבא' },
  },

  /**
   * The paste path. On a phone — and especially inside Facebook's in-app
   * browser, where a measurable share of signups land — there is no spreadsheet
   * to pick, so a file input is a dead end. A column of numbers from WhatsApp
   * is the list these users actually have.
   */
  paste: {
    tabFile: 'קובץ',
    tabPaste: 'הדבקת מספרים',
    label: 'הדביקו מספרי טלפון, אחד בכל שורה',
    placeholder: '0521234567\nדנה לוי, 0537654321',
    hint: 'אפשר גם "שם, טלפון" בכל שורה.',
    /** Count is filled in by the caller — never a promise before parsing. */
    submit: (n: number) => (n === 1 ? 'הוסף ליד אחד' : `הוסף ${n} לידים`),
    submitEmpty: 'הוסף לידים',
    pending: 'מוסיף…',
    skipped: (n: number) => (n === 1 ? 'שורה אחת לא נקראה ולא תתווסף' : `${n} שורות לא נקראו ולא יתווספו`),
    truncated: 'נוספו 1000 השורות הראשונות. אפשר להדביק את השאר אחר כך.',
    empty: 'לא זיהינו מספרי טלפון בטקסט שהודבק.',
  },

  /**
   * The workspace has a connected Meta account but no leads yet. A DIFFERENT
   * situation from first run and it keeps different copy: this user has already
   * acted, so the screen's job is reassurance that the action worked, not
   * persuasion. "אין עדיין לידים" is honest here precisely because the wait is
   * expected and explained.
   */
  connected: {
    headline: 'אין עדיין לידים',
    subhead: 'חשבון ה־Meta שלך מחובר. הליד הראשון יופיע כאן אוטומטית ברגע שיגיע.',
  },

  /**
   * Shown ONLY when true. A first-time visitor is never greeted by a column of
   * "לא מחובר" labels, which read as a broken setup checklist rather than an
   * offer — the single most damaging detail on the current mobile screen.
   */
  statusConnected: 'מחובר',

  /**
   * THE STATE NOBODY HAD DESIGNED: leads just landed, and now what?
   *
   * Import used to drop the user straight into an ordinary table. In production
   * five of six leads created by new agencies were never opened again, and
   * `first_follow_up_set` had never fired once in the product's history — the
   * loop simply had no next step after the data arrived.
   *
   * This names the one action worth taking, and points at a specific lead, so
   * the user leaves with a follow-up set instead of a list to admire.
   */
  firstImport: {
    title: (n: number) => (n === 1 ? 'הליד שלכם נכנס' : `${n} לידים נכנסו`),
    body: 'הצעד הבא: פתחו את הראשון וקבעו מתי לחזור אליו.',
    /**
     * Rows the file carried that we could not turn into לידים. Reported here
     * because routing straight to the list skips the importer's own invalid
     * panel — and a customer silently losing rows from their file is exactly
     * the kind of quiet data loss `care-charter.md` Law 1 forbids.
     */
    skipped: (n: number) =>
      n === 1 ? 'שורה אחת בקובץ לא נקראה ולא נוספה' : `${n} שורות בקובץ לא נקראו ולא נוספו`,
    cta: 'פתח את הליד הראשון',
    dismiss: 'סגירה',
  },
} as const

/**
 * First-lead guidance — the words the desktop `FirstLeadCallout` already uses,
 * lifted here so the phone says the same thing. Same rule as FIRST_RUN_COPY:
 * layout may differ per surface, the message may not.
 */
export const FIRST_LEAD_MOBILE = {
  title: 'הליד הראשון שלך בפנים',
  body: 'קבעו מתי לחזור אליו, ו־SocialCRM ידאג להזכיר לכם בזמן.',
  cta: 'קבע מתי לחזור אליו',
} as const
