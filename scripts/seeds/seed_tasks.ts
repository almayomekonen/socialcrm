import { db } from '@/config/db'

const USERS = [208, 219, 234, 114, 72, 86, 237]
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const daysFromNow = (n: number) => new Date(Date.now() + n * 864e5).toISOString().split('T')[0]
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().split('T')[0]

// Exact shape required by the app: TaskItem[]
// { title, isCompleted, subTasks: { title, desc, isCompleted }[] }

const tasks = [
  {
    title: 'אונבורדינג לקוח חדש',
    status: 'פתוח',
    dueDate: daysFromNow(7),
    completed: false,
    tasks: [
      {
        title: 'קבלת גישות',
        isCompleted: true,
        subTasks: [
          { title: 'גישה לעמוד פייסבוק', desc: 'בקש Admin access לעמוד', isCompleted: true },
          { title: 'גישה ל-Ad Account', desc: 'שתף את הבינדר לחשבון הפרסום', isCompleted: true },
          { title: 'גישה ל-Google Analytics', desc: 'הוסף מנהל נוסף לחשבון', isCompleted: false },
        ],
      },
      {
        title: 'חתימת הסכם',
        isCompleted: false,
        subTasks: [
          { title: 'שלח הסכם לחתימה דיגיטלית', desc: '', isCompleted: false },
          { title: 'וודא קבלת העתק חתום', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'פגישת קיק-אוף',
        isCompleted: false,
        subTasks: [
          { title: 'שלח דאודליין לתיאום', desc: '', isCompleted: false },
          { title: 'הכן שאלון צרכים', desc: 'עסק, מתחרים, קהל יעד, יעדים', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'ירין סררו', content: 'הלקוח ביקש להתחיל בחודש הבא', createdAt: new Date() }],
  },

  {
    title: 'ניהול קמפיין ממומן - Meta',
    status: 'פתוח',
    dueDate: daysFromNow(30),
    completed: false,
    tasks: [
      {
        title: 'מחקר קהל יעד',
        isCompleted: true,
        subTasks: [
          { title: 'הגדרת Lookalike Audiences', desc: '', isCompleted: true },
          { title: 'בניית Retargeting', desc: 'פיקסל + רשימות לקוחות', isCompleted: true },
        ],
      },
      {
        title: 'הכנת קריאייטיב',
        isCompleted: true,
        subTasks: [
          { title: 'עיצוב בנרים (1080x1080, 1200x628)', desc: '', isCompleted: true },
          { title: 'כתיבת טקסטים לפרסומות', desc: '3 גרסאות לכל מודעה', isCompleted: false },
        ],
      },
      {
        title: 'השקת קמפיין',
        isCompleted: false,
        subTasks: [
          { title: 'הגדרת Ad Sets', desc: 'תקציב יומי, לו"ז, ביד', isCompleted: false },
          { title: 'אישור מהלקוח לפני השקה', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'מעקב ואופטימיזציה',
        isCompleted: false,
        subTasks: [
          { title: 'בדיקת CPL ו-ROAS שבועית', desc: '', isCompleted: false },
          { title: 'דוח ביצועים ב-7 ו-30 יום', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'בניית אתר עסקי',
    status: 'ממתין לאישור הצעה',
    dueDate: daysFromNow(21),
    completed: false,
    tasks: [
      {
        title: 'ברייפינג ועיצוב',
        isCompleted: true,
        subTasks: [
          { title: 'קבלת חומרי מיתוג', desc: 'לוגו, פלטת צבעים, פונטים', isCompleted: true },
          { title: 'Wire-frame ראשוני', desc: '', isCompleted: true },
          { title: 'אישור עיצוב מהלקוח', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'פיתוח',
        isCompleted: false,
        subTasks: [
          { title: 'בניית עמוד הבית', desc: '', isCompleted: false },
          { title: 'עמוד "אודות" + "שירותים"', desc: '', isCompleted: false },
          { title: 'טופס יצירת קשר', desc: 'חיבור ל-CRM', isCompleted: false },
          { title: 'אדפטציה למובייל', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'מסירה',
        isCompleted: false,
        subTasks: [
          { title: 'בדיקות QA', desc: 'קישורים, מהירות, נגישות', isCompleted: false },
          { title: 'העלאה לדומיין הלקוח', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'אביב ברק', content: 'ממתינים לאישור הצעת המחיר', createdAt: new Date() }],
  },

  {
    title: 'דוח ביצועים חודשי',
    status: 'רכש והסתיים טיפול',
    dueDate: daysAgo(2),
    completed: true,
    tasks: [
      {
        title: 'איסוף נתונים',
        isCompleted: true,
        subTasks: [
          { title: 'ייצוא מ-Meta Ads Manager', desc: '', isCompleted: true },
          { title: 'ייצוא מ-Google Analytics 4', desc: '', isCompleted: true },
          { title: 'נתוני מכירות מה-CRM', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'עיבוד ונרטיב',
        isCompleted: true,
        subTasks: [
          { title: 'בניית Dashboard בגוגל שיטס', desc: '', isCompleted: true },
          { title: 'כתיבת סיכום מנהלים', desc: 'מה עבד, מה לא, המלצות', isCompleted: true },
        ],
      },
      {
        title: 'הצגה ללקוח',
        isCompleted: true,
        subTasks: [{ title: 'שליחת מצגת', desc: '', isCompleted: true }],
      },
    ],
    notes: [{ userName: 'מורין אלמוג', content: 'הלקוח מרוצה מהתוצאות', createdAt: new Date(Date.now() - 2 * 864e5) }],
  },

  {
    title: 'הגשת הצעת מחיר',
    status: 'ממתין לחתימת לקוח',
    dueDate: daysFromNow(3),
    completed: false,
    tasks: [
      {
        title: 'הכנת ההצעה',
        isCompleted: true,
        subTasks: [
          { title: 'הבנת צרכי הלקוח', desc: 'שיחת גילוי צרכים', isCompleted: true },
          { title: 'בחירת חבילת שירות מתאימה', desc: '', isCompleted: true },
          { title: 'תמחור + תנאי תשלום', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'שליחה ומעקב',
        isCompleted: false,
        subTasks: [
          { title: 'שליחת PDF + מייל', desc: '', isCompleted: true },
          { title: 'שיחת מעקב אחרי 48 שעות', desc: '', isCompleted: false },
          { title: 'עדכון סטטוס ב-CRM', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'ניהול מדיה חברתית - חודש אפריל',
    status: 'פתוח',
    dueDate: daysFromNow(30),
    completed: false,
    tasks: [
      {
        title: 'תכנית תוכן',
        isCompleted: true,
        subTasks: [
          { title: 'בניית לוח תוכן (16 פוסטים)', desc: '', isCompleted: true },
          { title: 'אישור לקוח', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'ייצור תוכן',
        isCompleted: false,
        subTasks: [
          { title: 'עיצוב גרפיקות', desc: 'Canva / Figma', isCompleted: true },
          { title: 'כתיבת קאפשנס', desc: '', isCompleted: false },
          { title: 'צילום Stories', desc: '4 Stories לשבוע', isCompleted: false },
        ],
      },
      {
        title: 'פרסום ומעקב',
        isCompleted: false,
        subTasks: [
          { title: 'תזמון פוסטים ב-Buffer', desc: '', isCompleted: false },
          { title: 'ניטור תגובות + DMs', desc: 'מענה בתוך 2 שעות', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'קמפיין Google Ads - חיפוש',
    status: 'חדש',
    dueDate: daysFromNow(14),
    completed: false,
    tasks: [
      {
        title: 'מחקר מילות מפתח',
        isCompleted: false,
        subTasks: [
          { title: 'Google Keyword Planner', desc: 'מינימום 50 מילות מפתח', isCompleted: false },
          { title: 'מחקר מתחרים (SEMrush)', desc: '', isCompleted: false },
          { title: 'בחירת 20 מילות מפתח עיקריות', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'כתיבת מודעות',
        isCompleted: false,
        subTasks: [
          { title: '3 כותרות + 2 תיאורים לכל Ad Group', desc: '', isCompleted: false },
          { title: 'הגדרת Extensions', desc: 'Sitelinks, Callouts, Call', isCompleted: false },
        ],
      },
      {
        title: 'הגדרה ובדיקה',
        isCompleted: false,
        subTasks: [
          { title: 'הגדרת Conversion Tracking', desc: '', isCompleted: false },
          { title: 'בדיקת תצוגה מקדימה', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'צילום תוכן לרשתות חברתיות',
    status: 'ממתין לפנייה ללקוח',
    dueDate: daysFromNow(10),
    completed: false,
    tasks: [
      {
        title: 'הכנה לצילום',
        isCompleted: true,
        subTasks: [
          { title: 'Brief לצלם', desc: 'סגנון, לוקיישן, שעת יום', isCompleted: true },
          { title: 'תאום תאריך עם הלקוח', desc: '', isCompleted: true },
          { title: 'רשימת שוטים נדרשים', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'יום צילום',
        isCompleted: false,
        subTasks: [
          { title: 'צילום Stills', desc: '20+ תמונות שמישות', isCompleted: false },
          { title: 'צילום Reels', desc: '3 קליפים קצרים', isCompleted: false },
        ],
      },
      {
        title: 'עריכה ומסירה',
        isCompleted: false,
        subTasks: [
          { title: 'עריכת תמונות (Lightroom)', desc: '', isCompleted: false },
          { title: 'עריכת וידאו', desc: '', isCompleted: false },
          { title: 'אישור סופי מהלקוח', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'חידוש חוזה שנתי',
    status: 'ממתין לחתימת לקוח',
    dueDate: daysFromNow(5),
    completed: false,
    tasks: [
      {
        title: 'הכנת הצעה לחידוש',
        isCompleted: true,
        subTasks: [
          { title: 'סיכום שנה קודמת', desc: 'ביצועים, ROI, הישגים', isCompleted: true },
          { title: 'הצעת מחיר מעודכנת', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'שיחת חידוש',
        isCompleted: false,
        subTasks: [
          { title: 'קביעת פגישה', desc: '', isCompleted: true },
          { title: 'הצגת ערך + מכירה', desc: '', isCompleted: false },
          { title: 'חתימה על הסכם מעודכן', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'עדן כהן', content: 'הלקוח שואל על הנחת נאמנות', createdAt: new Date(Date.now() - 1 * 864e5) }],
  },

  {
    title: 'SEO — אופטימיזציה לאתר',
    status: 'פתוח',
    dueDate: daysFromNow(45),
    completed: false,
    tasks: [
      {
        title: 'ביקורת SEO ראשונית',
        isCompleted: true,
        subTasks: [
          { title: 'ריצת Screaming Frog', desc: '', isCompleted: true },
          { title: 'בדיקת Core Web Vitals', desc: '', isCompleted: true },
          { title: 'דוח ממצאים ועדיפויות', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'תוכן ומילות מפתח',
        isCompleted: false,
        subTasks: [
          { title: 'מחקר מילות מפתח לעמודים עיקריים', desc: '', isCompleted: true },
          { title: 'כתיבת Meta Titles + Descriptions', desc: '', isCompleted: false },
          { title: 'תיקון Heading Structure', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'Technical SEO',
        isCompleted: false,
        subTasks: [
          { title: 'תיקון שגיאות Crawl', desc: '', isCompleted: false },
          { title: 'שיפור מהירות עמוד', desc: 'LazyLoad, Compression', isCompleted: false },
          { title: 'הגשת Sitemap ל-Google Search Console', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'השקת ניוזלטר חודשי',
    status: 'פתוח',
    dueDate: daysFromNow(12),
    completed: false,
    tasks: [
      {
        title: 'תכנון ותוכן',
        isCompleted: false,
        subTasks: [
          { title: 'בחירת נושא מרכזי', desc: '', isCompleted: true },
          { title: 'כתיבת תוכן', desc: '500-800 מילה', isCompleted: false },
          { title: 'הכנת קריאייטיב לאימייל', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'שליחה',
        isCompleted: false,
        subTasks: [
          { title: 'בנייה ב-Mailchimp', desc: '', isCompleted: false },
          { title: 'שליחת Test לפני', desc: '5 כתובות בדיקה', isCompleted: false },
          { title: 'שליחה לרשימה', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'ניתוח',
        isCompleted: false,
        subTasks: [
          { title: 'Open Rate + CTR', desc: 'אחרי 48 שעות', isCompleted: false },
          { title: 'דוח ללקוח', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'טסט A/B לדפי נחיתה',
    status: 'חדש',
    dueDate: daysFromNow(20),
    completed: false,
    tasks: [
      {
        title: 'הכנת גרסאות',
        isCompleted: false,
        subTasks: [
          { title: 'גרסה A — עיצוב נוכחי', desc: 'בסיס להשוואה', isCompleted: true },
          { title: 'גרסה B — שינוי כפתור CTA', desc: '', isCompleted: false },
          { title: 'גרסה C — Headline שונה', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'הפעלה',
        isCompleted: false,
        subTasks: [
          { title: 'הגדרת ב-Google Optimize', desc: '', isCompleted: false },
          { title: 'הפעלת ניסוי (מינימום 500 כניסות)', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'ניתוח ומסקנות',
        isCompleted: false,
        subTasks: [
          { title: 'Statistical Significance', desc: 'מינימום 95%', isCompleted: false },
          { title: 'יישום הגרסה המנצחת', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'טיפול בפידבק שלילי',
    status: 'ריג\'קט לטיפול',
    dueDate: daysAgo(1),
    completed: false,
    tasks: [
      {
        title: 'זיהוי הבעיה',
        isCompleted: true,
        subTasks: [
          { title: 'קריאת התלונה', desc: '', isCompleted: true },
          { title: 'בירור פנימי', desc: 'מה קרה? מי אחראי?', isCompleted: true },
        ],
      },
      {
        title: 'מענה ללקוח',
        isCompleted: false,
        subTasks: [
          { title: 'שיחה טלפונית ראשונית', desc: 'להביע הקשבה ואכפתיות', isCompleted: true },
          { title: 'הצעת פתרון', desc: '', isCompleted: false },
          { title: 'אישור שביעות רצון', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'אורי מונרוב', content: 'הלקוח לא מרוצה מהתגובה לפוסט. דורש שנדאג לזה מיידית', createdAt: new Date(Date.now() - 1 * 864e5) }],
  },

  {
    title: 'עדכון אסטרטגיה רבעונית Q2',
    status: 'חדש',
    dueDate: daysFromNow(14),
    completed: false,
    tasks: [
      {
        title: 'ניתוח Q1',
        isCompleted: false,
        subTasks: [
          { title: 'ריכוז נתוני ביצועים', desc: 'Meta, Google, אורגני', isCompleted: false },
          { title: 'מה עבד / מה לא עבד', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'בניית אסטרטגיה',
        isCompleted: false,
        subTasks: [
          { title: 'הגדרת KPIs ל-Q2', desc: '', isCompleted: false },
          { title: 'חלוקת תקציב בין ערוצים', desc: '', isCompleted: false },
          { title: 'לוח זמנים לקמפיינים', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'הצגה ואישור',
        isCompleted: false,
        subTasks: [
          { title: 'מצגת ללקוח', desc: '', isCompleted: false },
          { title: 'קבלת אישור וחתימה', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'חיבור CRM ואוטומציה',
    status: 'פתוח',
    dueDate: daysFromNow(18),
    completed: false,
    tasks: [
      {
        title: 'הגדרת CRM',
        isCompleted: true,
        subTasks: [
          { title: 'ייבוא רשימת לקוחות קיימת', desc: '', isCompleted: true },
          { title: 'הגדרת Pipelines', desc: 'ליד → הצעה → סגירה → לקוח', isCompleted: true },
          { title: 'הגדרת שדות מותאמים', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'אוטומציות',
        isCompleted: false,
        subTasks: [
          { title: 'מייל אוטומטי לליד חדש', desc: '', isCompleted: true },
          { title: 'תזכורת פולו-אפ ב-3 ו-7 ימים', desc: '', isCompleted: false },
          { title: 'Webhook לטופס אתר', desc: 'ליד חדש → CRM אוטומטית', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'ירין סררו', content: 'הלקוח רוצה לחבר גם WhatsApp Business', createdAt: new Date() }],
  },

  {
    title: 'פגישת היכרות ראשונית',
    status: 'הסתיים טיפול',
    dueDate: daysAgo(5),
    completed: true,
    tasks: [
      {
        title: 'לפני הפגישה',
        isCompleted: true,
        subTasks: [
          { title: 'מחקר על העסק', desc: 'אתר, רשתות, מתחרים', isCompleted: true },
          { title: 'הכנת שאלות גילוי צרכים', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'בפגישה',
        isCompleted: true,
        subTasks: [
          { title: 'הצגת החברה ושירותים', desc: '', isCompleted: true },
          { title: 'הבנת יעדי הלקוח', desc: '', isCompleted: true },
          { title: 'הצגת Case Studies רלוונטיים', desc: '', isCompleted: true },
        ],
      },
      {
        title: 'אחרי הפגישה',
        isCompleted: true,
        subTasks: [
          { title: 'שליחת Follow-up Summary', desc: '', isCompleted: true },
          { title: 'עדכון ב-CRM', desc: '', isCompleted: true },
        ],
      },
    ],
    notes: [{ userName: 'מתן ברדוגו', content: 'פגישה מצוינת! הלקוח מאוד מתעניין בניהול מדיה + קמפיינים', createdAt: new Date(Date.now() - 5 * 864e5) }],
  },

  {
    title: 'מעקב תשלום חשבונית',
    status: 'ממתין לפנייה ללקוח',
    dueDate: daysAgo(3),
    completed: false,
    tasks: [
      {
        title: 'בדיקת סטטוס',
        isCompleted: true,
        subTasks: [
          { title: 'בדיקת חשבון בנק', desc: '', isCompleted: true },
          { title: 'שליחת תזכורת ראשונה', desc: 'מייל + וואטסאפ', isCompleted: true },
        ],
      },
      {
        title: 'טיפול',
        isCompleted: false,
        subTasks: [
          { title: 'שיחה טלפונית', desc: '', isCompleted: false },
          { title: 'הסדר תשלום במידת הצורך', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'אביב ברק', content: 'חשבונית פתוחה מלפני 30 יום', createdAt: new Date(Date.now() - 3 * 864e5) }],
  },

  {
    title: 'הקמת חנות Shopify',
    status: 'פתוח',
    dueDate: daysFromNow(28),
    completed: false,
    tasks: [
      {
        title: 'הגדרת החנות',
        isCompleted: true,
        subTasks: [
          { title: 'הגדרת Theme', desc: '', isCompleted: true },
          { title: 'העלאת מוצרים ותיאורים', desc: '', isCompleted: false },
          { title: 'הגדרת Payments', desc: 'PayPal + כרטיס אשראי', isCompleted: false },
        ],
      },
      {
        title: 'שיווק',
        isCompleted: false,
        subTasks: [
          { title: 'חיבור Meta Pixel', desc: '', isCompleted: false },
          { title: 'Google Shopping Feed', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'השקה',
        isCompleted: false,
        subTasks: [
          { title: 'בדיקת תהליך רכישה E2E', desc: '', isCompleted: false },
          { title: 'Go Live!', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'ניהול קהילה - Discord',
    status: 'חדש',
    dueDate: daysFromNow(7),
    completed: false,
    tasks: [
      {
        title: 'הקמת הקהילה',
        isCompleted: false,
        subTasks: [
          { title: 'הגדרת Channels', desc: '#כללי, #הכרות, #שאלות, #הצעות-שיפור', isCompleted: false },
          { title: 'Roles + Permissions', desc: '', isCompleted: false },
          { title: 'Bot לברכות', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'תוכן ופעילות',
        isCompleted: false,
        subTasks: [
          { title: 'לוח פעילויות חודשי', desc: 'AMA, Poll, Challenge', isCompleted: false },
          { title: 'עצוב Welcome Banner', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [],
  },

  {
    title: 'אינטגרציה — Meta Lead Ads → CRM',
    status: 'ממתין לאישור הצעה',
    dueDate: daysFromNow(9),
    completed: false,
    tasks: [
      {
        title: 'הגדרה טכנית',
        isCompleted: false,
        subTasks: [
          { title: 'Zapier / Make Webhook', desc: 'Meta Lead → Trigger', isCompleted: false },
          { title: 'מיפוי שדות', desc: 'שם, טלפון, אימייל → CRM Fields', isCompleted: false },
          { title: 'בדיקת E2E עם ליד בדיקה', desc: '', isCompleted: false },
        ],
      },
      {
        title: 'אוטומציית תגובה',
        isCompleted: false,
        subTasks: [
          { title: 'מייל אוטומטי ללידים חדשים', desc: '', isCompleted: false },
          { title: 'הודעת WhatsApp אוטומטית', desc: '', isCompleted: false },
        ],
      },
    ],
    notes: [{ userName: 'עדן כהן', content: 'הלקוח מפספס לידים כי לא מגיב מהר', createdAt: new Date() }],
  },
]

async function seed() {
  // Get seeded clients
  const seededClients = await db('clients')
    .whereRaw('"idNum" LIKE \'9999%\'')
    .select('id')

  if (!seededClients.length) {
    console.log('⚠ No seeded clients found — run seed_clients.ts first')
    await db.destroy()
    return
  }

  const clientIds = seededClients.map((c) => c.id)

  // Remove previous seeded tasks
  console.log('🧹 Removing old seeded tasks...')
  const deleted = await db('tasks').whereIn('clientId', clientIds).delete()
  console.log(`  ✓ Deleted ${deleted} tasks`)

  console.log('\n🌱 Seeding tasks...')

  for (const t of tasks) {
    try {
      await db('tasks').insert({
        clientId: rand(clientIds),
        userId: rand(USERS),
        title: t.title,
        status: t.status,
        dueDate: t.dueDate,
        completed: t.completed,
        tasks: JSON.stringify(t.tasks) as any,
        notes: JSON.stringify(t.notes) as any,
        files: [] as any,
      })
      console.log(`  ✓ ${t.title}`)
    } catch (e: any) {
      console.log(`  ⚠ ${t.title}: ${e.message}`)
    }
  }

  console.log('\n✅ Tasks seeded successfully')
  await db.destroy()
}

seed()
