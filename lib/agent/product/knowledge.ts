/**
 * Canonical SocialCRM product knowledge — the agent's non-CRM knowledge domain.
 *
 * WHY THIS EXISTS. The agent could only answer from CRM evidence, so "למה
 * המערכת הזו טובה?" and "איך מתחילים?" came back as "לא מצאתי מספיק נתונים" —
 * a question about the product answered as if it were a question about the
 * customer's data. Product knowledge is a different domain with a different
 * source of truth, and this is that source.
 *
 * EVERY LINE IS DERIVED, NOT INVENTED. Each topic records where in this
 * repository its claim is anchored, and the content is a restatement of copy the
 * product already ships:
 *
 *   · `lib/copilot/general/guideMap.ts`  — the hand-authored guide whose answers
 *     and routes are already verified against the app's real pages.
 *   · `lib/education/registry.ts`        — the product tour's own description of
 *     each area, written for this product.
 *   · `lib/navs/Nav.tsx`                 — which destinations actually exist.
 *   · `claude/product.md`                — the product definition (core value,
 *     target user, what this is deliberately NOT).
 *
 * A capability that is not in one of those is not in here. That constraint is
 * the whole point: an agent that oversells is worse than one that says less,
 * because the first customer to act on an invented feature stops believing the
 * rest.
 *
 * NOT A DOCUMENTATION SYSTEM. It is deliberately small — a topic is an id, a
 * title, and enough text to answer with. `summary` is what reaches the model;
 * `body` exists for the retrieval tool a later phase will add when detail is
 * genuinely needed. Nothing here is per-tenant, so it needs no scoping.
 */

export const PRODUCT_TOPIC_IDS = [
  'what_is_socialcrm',
  'core_value',
  'lead_management',
  'conversations',
  'whatsapp',
  'facebook_instagram',
  'tasks_followups',
  'today_and_performance',
  'team',
  'getting_started',
  'the_agent',
  'not_supported',
] as const

export type ProductTopicId = (typeof PRODUCT_TOPIC_IDS)[number]

export type ProductTopic = {
  id: ProductTopicId
  /** Hebrew title, in the product's own terms. */
  title: string
  /** What reaches the model. Substantive enough to answer from directly. */
  summary: string
  /** Verified in-app destinations, or none when the topic is not a screen. */
  routes?: string[]
  /** Where in the repo this claim is anchored. Auditable, not decorative. */
  source: string
}

export const PRODUCT_TOPICS: readonly ProductTopic[] = [
  {
    id: 'what_is_socialcrm',
    title: 'מה זה SocialCRM',
    summary:
      'מערכת לניהול לידים שמגיעים מרשתות חברתיות ומוואטסאפ. כל הלידים מכל הערוצים מרוכזים במקום אחד, עם סטטוס לכל ליד, כדי שאפשר יהיה לראות מי חדש, מי בטיפול ומי דורש תשומת לב. מיועדת לעסקים קטנים ולנציגי מכירות שמקבלים פניות במשך היום, לא למחלקות מכירה גדולות.',
    source: 'claude/product.md · lib/education/registry.ts (סיור לידים)',
  },
  {
    id: 'core_value',
    title: 'הערך המרכזי',
    summary:
      'הבעיה שהמערכת פותרת: פניות מגיעות מהרבה מקומות, נקברות בצ׳אטים ובאקסלים, ואי אפשר לדעת למי כבר חזרת ולמי לא. SocialCRM הופכת פניות מפוזרות לרשימה אחת ברורה של אנשים לחזור אליהם, כדי ששום ליד לא ייפול בין הכיסאות. במקום לזכור בראש למי צריך לחזור ומה קרה עם כל אחד, התהליך מנוהל במקום אחד.',
    source: 'claude/product.md §5 (core value) · §2 (core problem)',
  },
  {
    id: 'lead_management',
    title: 'ניהול לידים',
    summary:
      'מסך «לידים» מרכז את כל הלידים מכל הערוצים ומשם מתחילה העבודה היומיומית. אפשר להוסיף ליד ידנית («הוסף ליד»), לייבא לידים מקובץ אקסל («העלה לידים»), או לקבל אותם אוטומטית מהערוצים המחוברים. לשוניות הסטטוס מראות מי חדש, מי בטיפול ומי דורש תשומת לב. פותחים ליד כדי לראות פרטים, ליצור קשר ולעדכן את הפעולה הבאה. ליד שנסגר ממשיך להיות מנוהל דרך מסך «לקוחות».',
    routes: ['/leads', '/clients'],
    source: 'lib/copilot/general/guideMap.ts (importLeads, addLead, pipeline, lead) · lib/education/registry.ts',
  },
  {
    id: 'conversations',
    title: 'שיחות',
    summary:
      'מסך «שיחות» מרכז את שיחות הוואטסאפ הנכנסות ומשם מנהלים את ההתכתבות עם הלידים. השיחה והליד מקושרים, כך שאפשר לראות מה נאמר בפועל לצד מצב הליד.',
    routes: ['/inbox'],
    source: 'lib/copilot/general/guideMap.ts (guide.inbox) · lib/education/registry.ts',
  },
  {
    id: 'whatsapp',
    title: 'חיבור וואטסאפ',
    summary: 'מחברים וואטסאפ בהגדרות ← אינטגרציות ← וואטסאפ. אחרי החיבור, שיחות נכנסות מגיעות למסך «שיחות».',
    routes: ['/settings/integrations?section=whatsapp', '/inbox'],
    source: 'lib/copilot/general/guideMap.ts (guide.connectWhatsapp)',
  },
  {
    id: 'facebook_instagram',
    title: 'חיבור פייסבוק ואינסטגרם',
    summary: 'מחברים פייסבוק בהגדרות ← אינטגרציות ← פייסבוק. לידים מטפסי הלידים של הערוצים המחוברים נכנסים למסך «לידים».',
    routes: ['/settings/integrations?section=facebook', '/leads'],
    source: 'lib/copilot/general/guideMap.ts (guide.connectFacebook) · lib/education/registry.ts (ליד חדש)',
  },
  {
    id: 'tasks_followups',
    title: 'משימות ומעקב',
    summary:
      'אחרי שיחה מעדכנים את הסטטוס של הליד וקובעים מעקב, והמערכת מזכירה בזמן. מסך «משימות» מרכז את מה שצריך לסגור, ומסך «פגישות» מציג את הפגישות הקרובות.',
    routes: ['/tasks', '/calendar'],
    source: 'lib/copilot/general/guideMap.ts (guide.lead, guide.calendar) · lib/education/registry.ts',
  },
  {
    id: 'today_and_performance',
    title: 'היום וביצועים',
    summary:
      'מסך «היום» מרכז מה דורש תשומת לב עכשיו — זו נקודת הפתיחה של יום העבודה. מסך «ביצועים» מראה איך העבודה מתקדמת, ומסך «עסקאות» עוקב אחרי עסקאות שבתהליך.',
    routes: ['/dashboard', '/sum_sales', '/deals'],
    source: 'lib/education/registry.ts (היום, ביצועים, עסקאות) · lib/navs/Nav.tsx',
  },
  {
    id: 'team',
    title: 'צוות והרשאות',
    summary:
      'אפשר להוסיף נציגים ולחלק אותם לצוותים דרך ההגדרות. לכל ליד יש נציג מטפל, וכל נציג רואה את הלידים שבהרשאתו.',
    routes: ['/settings/edit_users', '/settings/edit_teams'],
    source: 'components/mobile/moreDestinations.ts (צוותים, משתמשים) · db/briefing.ts (scopedLeads / gotPermIds)',
  },
  {
    id: 'getting_started',
    title: 'איך מתחילים',
    summary:
      'הסדר המעשי: (1) לחבר בהגדרות את הערוצים שמביאים פניות — וואטסאפ ופייסבוק; (2) לוודא שלידים נכנסים — אוטומטית מהערוצים, בייבוא אקסל, או בהוספה ידנית במסך «לידים»; (3) לפתוח את «היום» כדי לראות מה דורש טיפול; (4) לענות ללידים הפעילים דרך «שיחות»; (5) לעדכן סטטוס ולקבוע מעקב אחרי כל שיחה כדי ששום פנייה לא תישכח.',
    routes: ['/settings/integrations', '/leads', '/dashboard', '/inbox'],
    source: 'lib/copilot/general/guideMap.ts · lib/education/registry.ts (סיור כללי) · claude/product.md §6',
  },
  {
    id: 'the_agent',
    title: 'הסוכן שלך',
    summary:
      'הסוכן עונה על סמך הנתונים של העסק בלבד, ומסביר מה קורה, מה דורש טיפול ומה כדאי לעשות. הוא קורא בלבד — הוא לא שולח הודעות, לא משנה סטטוסים ולא מבצע פעולות. כשאין לו נתון, הוא אומר זאת במקום לנחש.',
    routes: ['/agent'],
    source: 'lib/agent/tools/index.ts (read-only surface) · lib/agent/validate.ts (evidence gate)',
  },
  {
    id: 'not_supported',
    title: 'מה המערכת לא עושה',
    summary:
      'SocialCRM היא לא מערכת ביטוח, לא ERP ולא CRM ארגוני עם תהליכים מרובי שלבים. אין כרגע דוח המרות או דוח הכנסות מלא, ולכן אי אפשר לחשב שיעור המרה או הכנסה צפויה בצורה אמינה. הסוכן לא מבצע מחקר שוק ולא בודק מתחרים.',
    source: 'claude/product.md §9 (what we are not) · lib/agent/tools/index.ts (the six read tools)',
  },
]

const BY_ID = new Map<string, ProductTopic>(PRODUCT_TOPICS.map((t) => [t.id, t]))

/** Is this a real topic id? The membership check the validator uses. */
export function isProductTopic(id: string): boolean {
  return BY_ID.has(id)
}

export function getProductTopic(id: string): ProductTopic | undefined {
  return BY_ID.get(id)
}

/**
 * The compact index handed to the model in the system prompt.
 *
 * IN THE PROMPT RATHER THAN BEHIND A TOOL, deliberately. A product question is
 * not a data question: nothing here is per-tenant, nothing needs scoping, and
 * the answer does not depend on the customer's rows — so a tool call would add a
 * round trip (and seconds) to fetch constants. Keeping it inline is what lets
 * "למה המערכת טובה?" answer without touching the CRM at all.
 *
 * It stays an INDEX, not a manual — around a dozen entries — so the prompt keeps
 * defining behaviour while this supplies knowledge. When a topic needs more
 * depth than a summary, that is the moment to add a retrieval tool, not to grow
 * this text.
 */
export function productKnowledgeIndex(): string {
  return PRODUCT_TOPICS.map((t) => {
    const routes = t.routes?.length ? ` [${t.routes.join(' , ')}]` : ''
    return `- ${t.id} · ${t.title}${routes}\n  ${t.summary}`
  }).join('\n')
}
