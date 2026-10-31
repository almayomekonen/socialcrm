import { TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing'

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
 * Topics added 2026-10-31 (pricing_trial … recent_updates) are anchored in the
 * feature's own code instead, named in each `source`, and say in their text when
 * a feature is switched on per account: this index is the same for every tenant,
 * so a flag-gated feature must never read as something every owner already has.
 * The price is not retyped here — it is the marketing FAQ's own sentence
 * (`lib/pricing.ts`), so the agent and the site cannot quote different prices.
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
  'pricing_trial',
  'automations',
  'auto_reply',
  'whatsapp_questionnaire',
  'messenger',
  'facebook_comments',
  'meta_ads',
  'deals_and_performance',
  'lead_import',
  'deal_import',
  'recent_updates',
  'not_supported',
] as const

export type ProductTopicId = (typeof PRODUCT_TOPIC_IDS)[number]

export type ProductTopic = {
  id: ProductTopicId
  /** Hebrew title, in the product's own terms. */
  title: string
  /** What reaches the model. Substantive enough to answer from directly. */
  summary: string
  /** Verified in-app destinations the topic mentions (shown to the model), or none. */
  routes?: string[]
  /**
   * The ONE screen this topic is about — what a WhatsApp reply citing it links
   * to. Separate from `routes` because a topic can mention several screens
   * while being about one; omitted when no single screen is the subject
   * (e.g. getting_started), so a reply never links a screen it did not discuss.
   */
  link?: string
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
    link: '/leads',
    source: 'lib/copilot/general/guideMap.ts (importLeads, addLead, pipeline, lead) · lib/education/registry.ts',
  },
  {
    id: 'conversations',
    title: 'שיחות',
    summary:
      'מסך «שיחות» מרכז את שיחות הוואטסאפ הנכנסות ומשם מנהלים את ההתכתבות עם הלידים. השיחה והליד מקושרים, כך שאפשר לראות מה נאמר בפועל לצד מצב הליד.',
    routes: ['/inbox'],
    link: '/inbox',
    source: 'lib/copilot/general/guideMap.ts (guide.inbox) · lib/education/registry.ts',
  },
  {
    id: 'whatsapp',
    title: 'חיבור וואטסאפ',
    summary: 'מחברים וואטסאפ בהגדרות ← אינטגרציות ← וואטסאפ. אחרי החיבור, שיחות נכנסות מגיעות למסך «שיחות».',
    routes: ['/settings/integrations?section=whatsapp', '/inbox'],
    link: '/settings/integrations?section=whatsapp',
    source: 'lib/copilot/general/guideMap.ts (guide.connectWhatsapp)',
  },
  {
    id: 'facebook_instagram',
    title: 'חיבור פייסבוק ואינסטגרם',
    summary: 'מחברים פייסבוק בהגדרות ← אינטגרציות ← פייסבוק. לידים מטפסי הלידים של הערוצים המחוברים נכנסים למסך «לידים».',
    routes: ['/settings/integrations?section=facebook', '/leads'],
    link: '/settings/integrations?section=facebook',
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
      'הסוכן עונה על סמך הנתונים של העסק, ומסביר מה קורה, מה דורש טיפול ומה כדאי לעשות. הוא לא שולח הודעות ללידים ולא משנה סטטוסים. כשמבקשים ממנו, הוא יכול להציע ליצור משימה, לקבוע מעקב או לקבוע פגישה — המערכת מאמתת את הפעולה ומודיעה מה קרה. בוואטסאפ הוא זמין בפיילוט, ושם רק פגישה, ורק אחרי לחיצה על כפתור האישור. כשאין לו נתון, הוא אומר זאת במקום לנחש.',
    routes: ['/agent'],
    link: '/agent',
    source: 'lib/agent/tools/index.ts (read tools) · lib/agent/actions (create_task / create_follow_up / create_meeting) · lib/waAssistant/worker.ts (WhatsApp: meetings only, WA_ASSISTANT_*)',
  },
  {
    id: 'pricing_trial',
    title: 'מחיר ותקופת ניסיון',
    summary: `${TRIAL_OFFER_FAQ_ANSWER} מסלול אחד (Pro), חיוב חודשי, בלי תוספת לכל נציג. כשתקופת הניסיון מסתיימת בלי מנוי, הלידים והנתונים נשמרים, וכדי להמשיך לעבוד צריך לשדרג.`,
    routes: ['/pricing'],
    link: '/pricing',
    source: 'lib/pricing.ts (PRICING, TRIAL_OFFER_FAQ_ANSWER) · lib/trial/index.ts (TRIAL_LENGTH_DAYS) · components/lumen/sections/pricing.tsx · lib/i18n/messages/he/trial/gate.ts',
  },
  {
    id: 'automations',
    title: 'אוטומציות',
    summary:
      'אוטומציה היא כלל של "כש... אז...": כשנכנס ליד חדש, כשסטטוס של ליד משתנה, כשנקבעת פגישה או כשנשלח טופס מהאתר — לשלוח מייל, לשלוח תבנית וואטסאפ מאושרת, ליצור משימה לנציג או להכין טיוטת הצעת מחיר. אפשר להריץ מיד, אחרי השהיה או לפני פגישה, ויש תבניות מוכנות. לידים מייבוא לא מפעילים אוטומציות. מוגדר בהגדרות ← אוטומציות, למנהלים בלבד, והאפשרות מופעלת לחשבונות שנבחרו.',
    routes: ['/settings/automations', '/settings/automation-templates'],
    link: '/settings/automations',
    source: 'lib/automations/types.ts · lib/automations/catalog/entries · lib/automations/emit.ts · lib/automations/flags.ts (AUTOMATIONS_ENABLED, AUTOMATIONS_AGENCY_ALLOWLIST, AUTOMATIONS_SEND_MODE)',
  },
  {
    id: 'auto_reply',
    title: 'מענה אוטומטי בוואטסאפ',
    summary:
      'מענה אוטומטי (הגדרות ← מענה אוטומטי, למנהלים) עונה ללידים שפונים בוואטסאפ: הודעה קבועה אחת, או מענה חכם שנכתב לפי תיאור העסק שהמנהל מזין. כשנציג עונה בעצמו, המענה האוטומטי מפסיק בשיחה הזו. שיחת בירור מלאה עם הליד מופעלת לחשבונות שנבחרו. זה עובד בוואטסאפ בלבד.',
    routes: ['/settings/auto-response'],
    link: '/settings/auto-response',
    source: 'app/(app)/settings/(admin_settings)/auto-response · lib/inbox/autoresponse (enqueueInboundAutoResponse: whatsapp only) · lib/inbox/humanTakeover.ts · lib/flags/smartReplyAgentFlags.ts',
  },
  {
    id: 'whatsapp_questionnaire',
    title: 'שאלון וואטסאפ',
    summary:
      'שאלון וואטסאפ שואל את הליד שאלות קבועות עם אפשרויות בחירה, והתשובות נשמרות על הליד; בסוף הצוות מקבל סיכום. בונים אותו בהגדרות ← שאלון וואטסאפ (למנהלים), עם בדיקה בצ׳אט לפני פרסום. השאלון מופעל לחשבונות שנבחרו, ועובד בוואטסאפ בלבד.',
    routes: ['/settings/questionnaire'],
    link: '/settings/questionnaire',
    source: 'lib/inbox/autoresponse/questionnaire/definition.ts · questionnaire/finalize.ts · app/(app)/settings/(admin_settings)/questionnaire/page.tsx · lib/flags/questionnaireBuilderFlags.ts · lib/flags/whatsappQuestionnaireFlags.ts',
  },
  {
    id: 'messenger',
    title: 'פייסבוק מסנג׳ר',
    summary:
      'הודעות מסנג׳ר לעמוד הפייסבוק מגיעות ללשונית מסנג׳ר במסך «שיחות», ואפשר לענות מהמערכת עד 24 שעות מההודעה האחרונה של הפונה, ולהפוך שיחה לליד. לפעמים שם ותמונת הפונה לא מוצגים בגלל הרשאה של Meta. מחברים עמוד פייסבוק (מנהל), והיכולת מופעלת לחשבונות שנבחרו. הודעות פרטיות באינסטגרם לא נתמכות.',
    routes: ['/inbox/messenger'],
    link: '/inbox/messenger',
    source: 'app/(app)/inbox/messenger/page.tsx · lib/facebook/messenger/rules.ts (24h) · modules/messenger/leadActions.ts · lib/facebook/permissions.ts (FACEBOOK_MESSENGER_*) · lib/product/capabilities.ts (no Instagram DM)',
  },
  {
    id: 'facebook_comments',
    title: 'תגובות מפייסבוק',
    summary:
      'תגובות על פוסטים בעמוד הפייסבוק יכולות להופיע בלשונית תגובות במסך «שיחות», ומשם אפשר להפוך תגובה לליד, ובחלק מהחשבונות גם להשיב כעמוד. התגובות מופעלות לחשבונות שנבחרו.',
    routes: ['/inbox/comments'],
    link: '/inbox/comments',
    source: 'app/(app)/inbox/comments/page.tsx · modules/facebookComments/actions.ts · lib/facebook/comments/capability.ts (FACEBOOK_COMMENTS_*, FACEBOOK_COMMENT_REPLIES_*)',
  },
  {
    id: 'meta_ads',
    title: 'מודעות פייסבוק ואינסטגרם',
    summary:
      'לידים מטפסי לידים של מודעות פייסבוק ואינסטגרם נכנסים אוטומטית ל«לידים», כולל תשובות הטופס. דוח מודעות (ביצועים ← מודעות, למנהלים) מראה הוצאה, חשיפות, קליקים ולידים לכל קמפיין, ומה קרה בפועל עם הלידים שהגיעו ממנו. דוח המודעות מופעל לחשבונות שנבחרו.',
    routes: ['/sum_sales/ads', '/leads'],
    link: '/sum_sales/ads',
    source: 'app/api/webhooks/facebook/route.ts (Lead Ads) · lib/facebook/leadFormAnswers.ts · lib/facebook/ads/metrics.ts · lib/facebook/ads/crmOutcomes.ts · app/(app)/sum_sales/layout.tsx (FACEBOOK_ADS_REPORTING_*, admin)',
  },
  {
    id: 'deals_and_performance',
    title: 'עסקאות, ביצועים והכנסות',
    summary:
      'עסקה שייכת לליד ויש לה סכום וסטטוס (חדש, בהצעה, במו"מ, ממתין לתשלום, שולם, בוטל). מסך «ביצועים» מציג את סך ההכנסות מעסקאות ששולמו, את מספר העסקאות שנסגרו ואת שווי העסקאות שעדיין בתהליך, לפי תקופה שבוחרים (החודש, השנה, השנה הקודמת ועוד). שם רואים כמה העסק הכניס — לפי העסקאות שנרשמו במערכת. מסך «עסקאות» מציג את העסקאות עצמן. שני המסכים זמינים במחשב.',
    routes: ['/sum_sales', '/deals'],
    link: '/sum_sales',
    source: 'db/helpers/sum_helpers.ts (saleStats: totalRevenue = status שולם, pipelineValue) · components/sumSales/AllNumbox.tsx · types/lists.ts (statuses) · components/filter/SelectDateRange.tsx',
  },
  {
    id: 'lead_import',
    title: 'ייבוא לידים',
    summary:
      'ייבוא לידים («העלה לידים» במסך «לידים»): קובץ אקסל או CSV, או הדבקה. כל שורה צריכה שם פרטי וטלפון או תעודת זהות; טלפון שכבר קיים לא ייובא פעמיים, והלידים נכנסים בסטטוס חדש ולא מפעילים אוטומציות.',
    routes: ['/leads'],
    link: '/leads',
    source: 'lib/leads/importMapping.ts · actions/clients.ts (import, duplicates) · lib/automations/emit.ts (imports never trigger)',
  },
  {
    id: 'deal_import',
    title: 'ייבוא עסקאות',
    summary:
      'ייבוא עסקאות (במסך «עסקאות»): קובץ אקסל עם עמודת סכום ועמודת טלפון או מייל. כל שורה מותאמת לליד קיים לפי טלפון ואז מייל, וסטטוס ריק נחשב חדש. הייבוא לא משנה את סטטוס הליד ולא מפעיל אוטומציות.',
    routes: ['/deals'],
    link: '/deals',
    source: 'lib/deals/importMapping.ts · actions/dealImport.ts · components/sales/UploadDealsData.tsx',
  },
  {
    id: 'recent_updates',
    title: 'מה חדש במערכת',
    summary:
      'נוספו לאחרונה (ספטמבר–אוקטובר 2026): ייבוא עסקאות מאקסל, זמין לכולם. נפתחים בהדרגה לחשבונות שנבחרו: הודעות מסנג׳ר בתוך «שיחות», תגובות מפייסבוק כלידים, דוח מודעות פייסבוק עם מה שקרה ללידים מכל קמפיין, בונה שאלון וואטסאפ, ממשק באנגלית, והסוכן בוואטסאפ — שאפשר לשאול אותו על העסק ולקבוע דרכו פגישה. אם יכולת לא מופיעה אצלך, היא עוד לא הופעלה בחשבון שלך.',
    source: 'git origin/main merges 2026-09-23 → 2026-10-31 (#65/#66 Messenger, #97–#99 deal import, #113 comments, #116 ads, #121/#122 questionnaire builder, #157/#158 WhatsApp assistant, #165–#175 i18n) · each feature flag file named in its own topic',
  },
  {
    id: 'not_supported',
    title: 'מה המערכת לא עושה',
    summary:
      'SocialCRM היא לא מערכת ביטוח, לא ERP ולא CRM ארגוני עם תהליכים מרובי שלבים. אין דוח של שיעור המרה, ואין חיזוי הכנסות. את ההכנסות מעסקאות ששולמו רואים במסך «ביצועים» — אבל הסוכן עצמו עדיין לא קורא את נתוני העסקאות וההכנסות, ולכן לא יכול לומר סכום. אין מענה אוטומטי ואין תיבת הודעות להודעות פרטיות באינסטגרם. הסוכן לא מבצע מחקר שוק ולא בודק מתחרים.',
    source: 'claude/product.md §9 · lib/agent/tools/index.ts (no revenue tool) · db/helpers/sum_helpers.ts (revenue lives in Performance) · lib/product/capabilities.ts (no Instagram DM)',
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
 * It stays an INDEX, not a manual — about twenty entries — so the prompt keeps
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
