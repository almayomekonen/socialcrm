# carousel-brief.md — מסמך מחקר למסע הליד ב-SocialCRM

> מסמך מקור לקרוסלת אינסטגרם על המסע שליד עובר במערכת, מרגע הפנייה ועד סגירת העסקה.
> **כל טענה מגובה בנתיב קובץ ומספר שורה.** מה שלא קיים בקוד מסומן במפורש "לא קיים בקוד".
> אין במסמך שום נתון אישי של לקוחות אמיתיים — רק מבנה.

**מקרא סטטוס מימוש:** ✅ ממומש ועובד · 🟡 ממומש חלקית · ⛔ לא קיים בקוד / רק טקסט שיווקי

**סטאק (package.json):** Next `^16.0.10`, React `^19.2.3`, knex `^3.1.0`, Tailwind `^4.1.18`, Postgres (`pg`), `xlsx`, `resend`. שפה `he`, כיוון `rtl` ([app/layout.tsx:19](../app/layout.tsx#L19)).

---

## 1. מסע הליד מקצה לקצה

הזרימה בפועל לפי הקוד. הליד נשמר בטבלת `clients` (השם ההיסטורי; הישות היא "ליד").

### שלב א' — יצירת הליד (4 מקורות)

**1. ליד נכנס מפייסבוק (Lead Ads) — אוטומטי**
- **מה מפעיל:** webhook POST מ-Meta אל [app/api/webhooks/facebook/route.ts](../app/api/webhooks/facebook/route.ts).
- **קוד שרץ:** `createLeadFromWebhook` ([lib/system/createClientFromWebhook.ts:17](../lib/system/createClientFromWebhook.ts#L17)).
- **מה נשמר ב-DB:** רשומת `clients` דרך `insertLeadSystem`, עם `leadSource = 'facebook:{leadId}'`, `lead = true`, `handlerId = userId`, `idNum = 'FB_{leadId}'`, ודגל `overQuota` לפי מכסה ([createClientFromWebhook.ts:48-63](../lib/system/createClientFromWebhook.ts#L48-L63)). מנרמל טלפון ל-`972...` ([:27-28](../lib/system/createClientFromWebhook.ts#L27-L28)). דדופ לפי `leadSource` ואז לפי טלפון ([:31-46](../lib/system/createClientFromWebhook.ts#L31-L46)).
- **מה עוד קורה:** נוצרת משימה אוטומטית בכותרת **"ליד חדש מפייסבוק"** ([:84](../lib/system/createClientFromWebhook.ts#L84)); נרשם אירוע ערך ראשון `trackFirstRealLeadOnce(agencyId,'facebook')` ([:82](../lib/system/createClientFromWebhook.ts#L82)).

**2. ליד נכנס מוואטסאפ — אוטומטי**
- **מה מפעיל:** webhook POST אל [app/api/webhooks/whatsapp/route.ts](../app/api/webhooks/whatsapp/route.ts).
- **קוד שרץ:** `createLeadFromWhatsappWebhook` ([lib/system/createLeadFromWhatsappWebhook.ts:16](../lib/system/createLeadFromWhatsappWebhook.ts#L16)). סימטרי לפייסבוק: `leadSource = 'whatsapp:{messageId}'`, `idNum = 'WA_{messageId}'`, דדופ לפי `messageId` ואז טלפון+agency ([:28-45](../lib/system/createLeadFromWhatsappWebhook.ts#L28-L45)).
- **משימה אוטומטית:** **"ליד חדש מוואטסאפ"** ([:82](../lib/system/createLeadFromWhatsappWebhook.ts#L82)).

**3. הוספה ידנית** — `upsertLead` ([actions/clients.ts:190](../actions/clients.ts#L190)) / `addLeads` שמקבע `status: 'new'` ([actions/clients.ts:446-460](../actions/clients.ts#L446-L460)).

**4. ייבוא אקסל** — `uploadLeadData` ([actions/clients.ts:399-444](../actions/clients.ts#L399-L444)) קורא קובץ עם `XLSX`, ואז `addLeads`.

### שלב ב' — עבודה על הליד
- **צפייה/שינוי סטטוס:** תא סטטוס [components/clients/LeadStatusCell.tsx:6-12](../components/clients/LeadStatusCell.tsx#L6-L12); שינוי → `updateLead` ([actions/clients.ts:351-387](../actions/clients.ts#L351-L387)) שמחתים `statusChangedAt` + `lastActivityAt` ([:363-366](../actions/clients.ts#L363-L366)).
- **תיעוד תוצאת שיחה (הליבה):** כפתורי [components/leads/OutcomeControl.tsx:13-18](../components/leads/OutcomeControl.tsx#L13-L18) → `logLeadOutcome` ([actions/leadOutcome.ts:34-85](../actions/leadOutcome.ts#L34-L85)) → `resolveOutcome` ([lib/leads/outcomeRules.ts:37-63](../lib/leads/outcomeRules.ts#L37-L63)). בכתיבה אחת: מעדכן `lastOutcomeType`, מקדם `status`, וקובע/מנקה `nextFollowUpAt` ([leadOutcome.ts:51-69](../actions/leadOutcome.ts#L51-L69)).

### שלב ג' — מעקב
- `nextFollowUpAt` ([types/db/tables.ts:212](../types/db/tables.ts#L212)) נצבע לפי דחיפות ומוצג ב"היום"/רשימת עבודה (ראה §6). **אין job שדוחף תזכורת** — התצוגה מתרעננת כשהמשתמש נכנס.

### שלב ד' — סגירה
- מעבר `status = 'closed'` (תווית **"סגור"**, [LeadStatusCell.tsx:10](../components/clients/LeadStatusCell.tsx#L10)). בתצוגת "לקוחות" תווית `new` הופכת ל-**"לקוח"** ([LeadStatusCell.tsx:24](../components/clients/LeadStatusCell.tsx#L24)). `closed`/`lost` הם סטטוסים סופיים ([lib/today/constants.ts:10](../lib/today/constants.ts#L10)).
- 🟡 קיימת ישות עסקה נפרדת (`Deal`/`sales`, [tables.ts:237-261](../types/db/tables.ts#L237-L261)) עם `getLeadDeals`/`transferDealsToLead` ([actions/clients.ts:494](../actions/clients.ts#L494),[:271](../actions/clients.ts#L271)) — שריד ותיק; המסע העיקרי מבוסס-סטטוס.

---

## 2. מקורות הלידים

| מקור | אמיתי/mock | webhook/polling/ידני | זמן הגעה | סטטוס |
|---|---|---|---|---|
| Facebook Lead Ads | אמיתי | **webhook** | כמעט מיידי (POST) | ✅ |
| Instagram (Lead Ads) | אמיתי, דרך Meta | webhook פייסבוק | כמעט מיידי | ✅ (זהה ל-FB) |
| Instagram (DM ישיר) | — | — | — | ⛔ **לא קיים בקוד** |
| WhatsApp | אמיתי | **webhook** | כמעט מיידי | ✅ |
| ייבוא אקסל | אמיתי | ידני | מיידי בהעלאה | ✅ |
| הוספה ידנית | אמיתי | ידני | מיידי | ✅ |

**Facebook Lead Ads ✅** — webhook ([app/api/webhooks/facebook/route.ts](../app/api/webhooks/facebook/route.ts)). דדופ כפול: `leadSource='facebook:{leadId}'` ואז טלפון ([createClientFromWebhook.ts:31-46](../lib/system/createClientFromWebhook.ts#L31-L46)). **צעדי חיבור (לפי סדר):** מסך הפעלה/הגדרות → `startOAuth` ל-`/api/auth/facebook?origin=activation` → חזרה עם דפים → בחירת דף (`selectPage`) → מנוי הדף דרך `/api/auth/facebook/connect` → `completeOnboarding` ([lib/activation/useActivationController.ts:135-147](../lib/activation/useActivationController.ts#L135-L147),[:58-96](../lib/activation/useActivationController.ts#L58-L96)). בהגדרות: [components/settings/FacebookConnect.tsx](../components/settings/FacebookConnect.tsx).

**Instagram ⛔/🟡** — **אין ingestion ל-DM של אינסטגרם**: הקידומות הנכנסות הן `whatsapp:` ו-`facebook:` בלבד ([lib/today/constants.ts:14](../lib/today/constants.ts#L14)); אין `instagram:` בקוד. אינסטגרם קיים כ**תווית מקור ידנית** ([types/lists.ts:113](../types/lists.ts#L113)), ולידים מטופסי מודעות אינסטגרם מגיעים דרך אותו webhook של פייסבוק (Meta Lead Ads). דף השיווק מאשר את המגבלה במפורש ([app/(marketing)/instagram-leads-crm/page.tsx](../app/(marketing)/instagram-leads-crm/page.tsx)).

**WhatsApp ✅** — webhook ([app/api/webhooks/whatsapp/route.ts](../app/api/webhooks/whatsapp/route.ts)). דדופ `whatsapp:{messageId}` ואז טלפון+agency ([createLeadFromWhatsappWebhook.ts:28-45](../lib/system/createLeadFromWhatsappWebhook.ts#L28-L45)). חיבור דרך Embedded Signup ([components/settings/WhatsappConnect.tsx](../components/settings/WhatsappConnect.tsx)).

**ייבוא אקסל ✅ (עם חיכוך)** — `uploadLeadData` ([actions/clients.ts:399-444](../actions/clients.ts#L399-L444)). **עמודות חובה: `שם פרטי`, `שם משפחה`, `תעודת זהות`** ([:415](../actions/clients.ts#L415)); שגיאה: `העמודות הבאות חסרות בקובץ: ...` ([:418](../actions/clients.ts#L418)); ת"ז מאומת ב-`isIdNumValid` ([:431](../actions/clients.ts#L431)). ⚠️ **סתירה מול המוצר:** דרישת ת"ז היא שריד ביטוחי — ליד מרשת חברתית לרוב בלי ת"ז.

**מה נכשל הכי הרבה (לפי היקף טיפולי השגיאה בקוד):**
- **פייסבוק — לא נמצא דף:** יש אפילו וריאנט הסלמה לכשל חוזר `no_pages_repeat` ([lib/connections/messages.ts:94-106](../lib/connections/messages.ts#L94-L106)) — סימן שזה כשל שכיח.
- **וואטסאפ — אין חשבון/מספר עסקי / הגדרה לא הושלמה:** `no_accounts`, `no_phones`, `not_ready`, `subscribe_incomplete` ([messages.ts:233-268](../lib/connections/messages.ts#L233-L268)).
- **חסימת דפדפן ל-SDK של וואטסאפ:** `sdk` ([messages.ts:194-201](../lib/connections/messages.ts#L194-L201)).

---

## 3. מודל הנתונים

**ישות `Lead` (טבלה `clients`)** — מקור אמת בקוד: [types/db/tables.ts:181-221](../types/db/tables.ts#L181-L221).

| שדה | טיפוס | הערה |
|---|---|---|
| `id` | number | מזהה |
| `firstName` / `lastName` / `name` | string | שם |
| `email` / `phone` / `secPhone` | string \| null | ליצירת קשר |
| `status` | string \| null | סטטוס הליד (§4) |
| `leadSource` | string \| null | `channel:externalId` (למשל `facebook:...`) |
| `lead` | boolean | ליד מול לקוח |
| `overQuota` | boolean | מוסתר במכסת free |
| `agencyId` | number | **חובה** — שיוך סוכנות |
| `userId` | number \| null | **הנציג המשויך** |
| `handlerId` | number \| null | מטפל |
| `createdById` | number | יוצר |
| `createdAt`/`updatedAt` | Date \| null | |
| `statusChangedAt` | Date | חותמת שינוי סטטוס |
| `lastActivityAt` | Date \| null | פעילות אחרונה |
| `lastOutcomeType` | string \| null | תוצאת שיחה אחרונה |
| `nextFollowUpAt` | Date \| null | תזכורת חזרה |
| `followUpNote` | string \| null | הערת מעקב |
| `idNum` | string | ת"ז (שריד; nullable במיגרציה) |
| שדות שריד ביטוחי | — | `idNumDate,gender,familyStatus,passportNum,licenseNum,familyId,birthDate,secPhone` ([:185-202](../types/db/tables.ts#L185-L202)) |
| שדות מחושבים (לא ב-DB) | — | `state,priority,severity,nextAction,isNewBadge` ([:214-220](../types/db/tables.ts#L214-L220)) — אופציונליים, נגזרים בזמן ריצה |

**אינדקסים/מפתחות:** אינדקס **ייחודי** על `clients.leadSource` (מיגרציה [migrations/20260323000001_clients_lead_source_unique.cjs](../migrations/20260323000001_clients_lead_source_unique.cjs), מוזכר ב-[createClientFromWebhook.ts:66](../lib/system/createClientFromWebhook.ts#L66)).

**מיגרציות מפתח על `clients`** (טבלת הבסיס עצמה קדומה ל-knex — Prisma legacy — והמיגרציות רק משנות אותה): `status` מ-bool ל-text ([20260329000001](../migrations/20260329000001_clients_status_bool_to_text.cjs)), `statusChangedAt` ([20260329000002](../migrations/20260329000002_clients_status_changed_at.cjs)), שדות מעקב ([20260603000001_clients_follow_up.cjs](../migrations/20260603000001_clients_follow_up.cjs)), `overQuota`/מכסה ([20260421000001](../migrations/20260421000001_quota_plan_columns.cjs)), `idNum` nullable ([20260323000004](../migrations/20260323000004_clients_idnum_nullable.cjs)).

**ישויות קשורות:** `Task` (FK `clientId`, [tables.ts:354-368](../types/db/tables.ts#L354-L368)) · `User` ([:64-91](../types/db/tables.ts#L64-L91)) · `UserPerm {gaveId,gotId}` ([:93-96](../types/db/tables.ts#L93-L96)) · `Agency` ([:125-137](../types/db/tables.ts#L125-L137)) · `AnalyticsEvent` ([:446-453](../types/db/tables.ts#L446-L453)) · `whatsapp_connections` · `facebook_pages` · `inbox_conversations`/`inbox_messages` · `meetings` · `recovery_alerts` · `auto_response`.

---

## 4. סטטוסים ומעברים

### הסטטוסים של הליד (המערכת הנוכחית) ✅
מקור: `STATUS_STYLES` ב-[components/clients/LeadStatusCell.tsx:6-12](../components/clients/LeadStatusCell.tsx#L6-L12).

| קוד (DB) | תווית בממשק | צבע badge |
|---|---|---|
| `new` | **חדש** | כחול (`bg-blue-50 text-blue-700`) |
| `contacted` | **בטיפול** | צהוב (`bg-yellow-50 text-yellow-700`) |
| `interested` | **מעוניין** | ירוק (`bg-green-50 text-green-700`) |
| `closed` | **סגור** (בתצוגת לקוחות: **לקוח**) | אפור (`bg-gray-100`) |
| `lost` | **אבוד** | אדום (`bg-red-50 text-red-600`) |

סופיים: `closed`, `lost` ([lib/today/constants.ts:10](../lib/today/constants.ts#L10)). התווית `לקוח` ל-`new` בתצוגת לקוחות: [LeadStatusCell.tsx:24](../components/clients/LeadStatusCell.tsx#L24).

### מעברים מותרים (מונעי-תוצאה) ✅
מקור: `resolveOutcome` ([lib/leads/outcomeRules.ts:37-63](../lib/leads/outcomeRules.ts#L37-L63)).

| תוצאת שיחה | מעבר סטטוס | תזכורת |
|---|---|---|
| `call_no_answer` (לא ענה) | ללא שינוי | +1 יום ([:41](../lib/leads/outcomeRules.ts#L41)) |
| `call_reached` (דיברנו) | `new → contacted` בלבד (לא מוריד) | +3 ימים ([:45](../lib/leads/outcomeRules.ts#L45)) |
| `call_interested` (מעוניין) | `→ interested` (אם לא כבר interested/closed) | +3 ימים ([:47-53](../lib/leads/outcomeRules.ts#L47-L53)) |
| `call_not_interested` (לא מעוניין) | `→ lost` (ליד אבוד יכול לחזור כ-`interested`) | מנקה תזכורת ([:55-61](../lib/leads/outcomeRules.ts#L55-L61)) |

שינוי סטטוס ידני ישיר אפשרי גם דרך ה-Select ב-`LeadStatusCell` → `updateLead`.

### מי מורשה ✅
`ADMIN`/`GM` — כל ליד בסוכנות; שאר התפקידים — רק לידים של משתמשים ב-`gotPermIds` שלהם ([actions/leadOutcome.ts:44](../actions/leadOutcome.ts#L44),[:72](../actions/leadOutcome.ts#L72); [actions/clients.ts:371](../actions/clients.ts#L371)). הכול מסונן תמיד לפי `agencyId`.

### ⚠️ סתירה בקוד — שתי מערכות סטטוס
מלבד הסטטוסים לעיל, קיים אוצר-מילים **ותיק** לעסקאות: `STATUS_LIST = ['חדש','בהצעה','במו"מ','ממתין לתשלום','שולם','בוטל']` ([types/lists.ts:1](../types/lists.ts#L1)) עם מיפוי תצוגה ל-`חדש/בטיפול/סגור/אבוד` ([types/lists.ts:25-32](../types/lists.ts#L25-L32)).
**מה נכון לפי הקוד:** מסע הליד משתמש בקודים האנגליים (`new/contacted/interested/closed/lost`) — הם הנשמרים ב-DB ומוצגים ב-`LeadStatusCell`. ה-`STATUS_LIST` העברי הוא שריד של צינור העסקאות (`sales`). **לקרוסלה השתמש רק בחמשת הסטטוסים מ-`LeadStatusCell`.**

---

## 5. שיוך נציגים והרשאות

- **תפקידים** ([types/roles.ts:28-35](../types/roles.ts#L28-L35)): `ADMIN, MNGR, AGNT, OFFICE, GM, EXT`. תוויות עברית ([:1-8](../types/roles.ts#L1-L8)): `AGNT='נציג מכירות'`, `MNGR='מנהל'`, `OFFICE='תפעול'`, `ADMIN='אדמין'`, `GM='מנהל כללי'`, `EXT='שותף חיצוני'`.
- **מנהל מול נציג:** `isAdmin = ADMIN|GM` ([:41](../types/roles.ts#L41)) רואה הכול; `isMngr = MNGR|ADMIN|GM` ([:38](../types/roles.ts#L38)).
- **טבלת הרשאות:** `user_perms` → `UserPerm {gaveId, gotId}` ([tables.ts:93-96](../types/db/tables.ts#L93-L96)); `getPerms(user)` מחזיר `gotPermIds`.
- **איכה זה נאכף:** בכל קריאת ליד/עדכון — לא-אדמין מסונן `whereIn('userId', gotPermIds)` ([leadOutcome.ts:43-45](../actions/leadOutcome.ts#L43-L45),[:71-73](../actions/leadOutcome.ts#L71-L73); [clients.ts:342-346](../actions/clients.ts#L342-L346),[:369-372](../actions/clients.ts#L369-L372)).
- **שיוך ליד לנציג:** `transferLeadToRep` מעדכן `clients.userId` (מסונן `agencyId`) ([clients.ts:281-285](../actions/clients.ts#L281-L285)). ביצירה אוטומטית: `userId`/`handlerId` = המשתמש שהחיבור שלו הביא את הליד ([createClientFromWebhook.ts:59-60](../lib/system/createClientFromWebhook.ts#L59-L60)).

---

## 6. תזכורות ומעקב

- **שדה:** `nextFollowUpAt` ([tables.ts:212](../types/db/tables.ts#L212)) + `followUpNote` ([:213](../types/db/tables.ts#L213)).
- **איך מחושב:** ברירת-מחדל לפי התוצאה (`in_days`: לא-ענה=1, דיברנו=3, מעוניין=3; לא-מעוניין=ניקוי) ([outcomeRules.ts:41-60](../lib/leads/outcomeRules.ts#L41-L60)), עם אפשרות override ידני ([leadOutcome.ts:63-68](../actions/leadOutcome.ts#L63-L68)) דרך `daysFromNow` ([:64](../actions/leadOutcome.ts#L64)).
- **איפה מוצג:** ב"היום"/רשימת עבודה, לפי סדר עדיפויות `STATE_PRIORITY` (כולל `FOLLOWUP_OVERDUE`, `FOLLOWUP_DUE_TODAY`) ([constants.ts:39-46](../lib/today/constants.ts#L39-L46)) ו-SLA לפי סטטוס (`contacted`=24ש', `interested`=72ש') ([constants.ts:22](../lib/today/constants.ts#L22)).
- **⚠️ Job?** **אין job/cron לתזכורות.** ה-cronים היחידים ([vercel.json](../vercel.json)): `analyze-conversations` (יומי 06:00), `email-automations` (שעתי), `whatsapp-template-sync` (כל 6ש'). לכן התזכורת היא **תצוגה (pull)** שמופיעה כשנכנסים למערכת — לא התראה נדחפת.

---

## 7. מצבי שגיאה (טקסט מדויק)

**חיבור פייסבוק** ([lib/connections/messages.ts:61-179](../lib/connections/messages.ts#L61-L179)):
| קוד | כותרת |
|---|---|
| `denied` | "החיבור לפייסבוק לא הושלם" |
| `no_pages` | "לא מצאנו דף Facebook שאפשר לחבר" |
| `no_pages_repeat` | "נראה שהחיבור עדיין לא מוצא דף מתאים" |
| `missing_permission` | "חסרה הרשאה לקבלת לידים" |
| `resource_claimed` | "הדף כבר מחובר לחשבון אחר" |
| `subscription_failed` | "הדף לא נרשם לקבלת לידים" |
| `expired` | "החיבור לפייסבוק פג" |

**חיבור וואטסאפ** ([messages.ts:193-284](../lib/connections/messages.ts#L193-L284)):
| קוד | כותרת |
|---|---|
| `sdk` | "חלון ההתחברות לא נפתח" |
| `no_accounts` | "לא נמצא חשבון WhatsApp עסקי" |
| `no_phones` | "לא שויך מספר לחשבון העסקי" |
| `not_ready` | "הגדרת מספר ה-WhatsApp עדיין לא הושלמה" |
| `subscribe_incomplete` | "החיבור ל-WhatsApp עדיין לא הושלם" |
| `resource_claimed` | "המספר כבר מחובר לחשבון אחר" |

**שגיאות פעולה על ליד** ([actions/leadOutcome.ts](../actions/leadOutcome.ts)): `ליד לא תקין` ([:36](../actions/leadOutcome.ts#L36)), `תוצאה לא תקינה` ([:37](../actions/leadOutcome.ts#L37)), `הליד לא נמצא` ([:46](../actions/leadOutcome.ts#L46)), `תאריך לא תקין` ([:65](../actions/leadOutcome.ts#L65)).
**ייבוא:** `העמודות הבאות חסרות בקובץ: ...` ([actions/clients.ts:418](../actions/clients.ts#L418)).
**באנר Meta מנותק:** "חשבון ה‑Meta מנותק. לידים לא ייכנסו עד שתחבר אותו מחדש." ([components/settings/MetaDisconnectedBanner.tsx](../components/settings/MetaDisconnectedBanner.tsx)).

---

## 8. מפת פיצ'רים

| פיצ'ר | סטטוס | נתיב קוד | הערה |
|---|---|---|---|
| קליטת לידים מ-Facebook Lead Ads | ✅ | [lib/system/createClientFromWebhook.ts](../lib/system/createClientFromWebhook.ts) | webhook + דדופ |
| קליטת לידים מ-WhatsApp | ✅ | [lib/system/createLeadFromWhatsappWebhook.ts](../lib/system/createLeadFromWhatsappWebhook.ts) | webhook + דדופ |
| קליטת אינסטגרם דרך Lead Ads | ✅ | webhook פייסבוק | דרך Meta |
| קליטת DM ישיר מאינסטגרם | ⛔ | — | לא קיים בקוד |
| הוספה ידנית | ✅ | [actions/clients.ts:190](../actions/clients.ts#L190) | |
| ייבוא אקסל | 🟡 | [actions/clients.ts:399](../actions/clients.ts#L399) | דורש ת"ז (שריד) |
| חמישה סטטוסי ליד + badge | ✅ | [components/clients/LeadStatusCell.tsx](../components/clients/LeadStatusCell.tsx) | |
| תיעוד תוצאת שיחה בקליק | ✅ | [components/leads/OutcomeControl.tsx](../components/leads/OutcomeControl.tsx) | מקדם סטטוס + תזכורת |
| קידום סטטוס אוטומטי מתוצאה | ✅ | [lib/leads/outcomeRules.ts](../lib/leads/outcomeRules.ts) | |
| תזכורת חזרה (nextFollowUpAt) | ✅ | [actions/leadOutcome.ts:63](../actions/leadOutcome.ts#L63) | תצוגה, לא push |
| Job שדוחף תזכורות | ⛔ | [vercel.json](../vercel.json) | אין cron תזכורות |
| מסך "היום"/תעדוף אוטומטי | ✅ | [lib/today/constants.ts](../lib/today/constants.ts) | SLA + עדיפות |
| שיוך ליד לנציג | ✅ | [actions/clients.ts:281](../actions/clients.ts#L281) | |
| הרשאות (אדמין מול נציג) | ✅ | [actions/leadOutcome.ts:44](../actions/leadOutcome.ts#L44) | |
| מסך הפעלה/onboarding | ✅ | [components/clients/LeadsFirstRun.tsx](../components/clients/LeadsFirstRun.tsx) | |
| ישות עסקה/מכירה נפרדת | 🟡 | [types/db/tables.ts:237](../types/db/tables.ts#L237) | שריד ותיק |

---

## 9. מיקרו קופי (ציטוט מדויק לשימוש בקרוסלה)

**מסך ראשוני — לא מחובר** ([LeadsFirstRun.tsx:71-106](../components/clients/LeadsFirstRun.tsx#L71-L106)):
- כותרת: **"חבר את העסק שלך"**
- תת-כותרת: **"כל הלידים שלך במקום אחד ו‑SocialCRM כבר יסדר למי להתקשר קודם."**
- קלף וואטסאפ: **"וואטסאפ" / "נהל שיחות עם לקוחות במקום אחד"** (badge **"מומלץ"**)
- קלף Meta: **"פייסבוק ואינסטגרם" / "קבל לידים מהמודעות אוטומטית"**
- קלף ליד: **"הוסף ליד ראשון" / "הדרך המהירה ביותר להתחיל"**
- קלף אקסל: **"ייבוא מאקסל" / "העבר את כל הלקוחות בשניות"**

**מסך ראשוני — Meta מחובר** ([LeadsFirstRun.tsx:28-63](../components/clients/LeadsFirstRun.tsx#L28-L63)):
- כותרת: **"אין עדיין לידים"**
- תת-כותרת: **"חשבון ה‑Meta שלך מחובר בהצלחה. הליד הראשון יופיע כאן באופן אוטומטי ברגע שיגיע."**

**מצבים ריקים בטבלה** ([components/clients/clientsTable.tsx:137-201](../components/clients/clientsTable.tsx#L137-L201)):
- **"חבר פייסבוק או הוסף ליד ידנית"** ([:137](../components/clients/clientsTable.tsx#L137))
- **"אפשר להתחיל על ידי יצירת ליד או העלאת קובץ"** ([:146](../components/clients/clientsTable.tsx#L146))
- מסונן-ריק: **"אין לידים בסטטוס זה כרגע"** ([:173](../components/clients/clientsTable.tsx#L173))

**כפתורים:** **"הוסף ליד"** · **"העלה לידים"** ([clientsTable.tsx:139-140](../components/clients/clientsTable.tsx#L139-L140)) · **"הוסף ליד ידנית"** · **"העלה קובץ לידים"** ([:193](../components/clients/clientsTable.tsx#L193),[:201](../components/clients/clientsTable.tsx#L201)). מודל: **"העלאת לידים"** ([:332](../components/clients/clientsTable.tsx#L332)) · **"פרטי ליד"** ([LeadsFirstRun.tsx:112](../components/clients/LeadsFirstRun.tsx#L112)).

**תוצאת שיחה** ([OutcomeControl.tsx:13-18](../components/leads/OutcomeControl.tsx#L13-L18)): תווית **"תוצאת שיחה:"** · כפתורים **"לא ענה" / "דיברנו" / "מעוניין" / "לא מעוניין"**.

**הודעות הצלחה (toast)** ([OutcomeControl.tsx:28-34](../components/leads/OutcomeControl.tsx#L28-L34)):
- **"השיחה נשמרה. הליד יחזור לרשימת המעקב ב-{תאריך}."**
- **"הליד סומן כמתעניין. נחזיר אותו למעקב ב-{תאריך} כדי להתקדם לסגירה."**
- **"לא הצלחת להשיג את הליד. נזכיר לך לנסות שוב ב-{תאריך}."**
- **"הליד סומן כלא רלוונטי והוסר מרשימת המעקב."**

**כותרות משימה אוטומטית:** **"ליד חדש מפייסבוק"** / **"ליד חדש מוואטסאפ"** ([createClientFromWebhook.ts:84](../lib/system/createClientFromWebhook.ts#L84), [createLeadFromWhatsappWebhook.ts:82](../lib/system/createLeadFromWhatsappWebhook.ts#L82)).

**מחיקה:** **"למחוק {N} לידים?"** ([clientsTable.tsx:422](../components/clients/clientsTable.tsx#L422)).

---

## 10. מותג ונכסים

**צבעים** — `@theme` ב-[lib/css/main.css:25-34](../lib/css/main.css#L25-L34):
| טוקן | ערך | שימוש |
|---|---|---|
| `--color-primary` | **#5e6ad2** | CTA / פעיל / מילוי |
| `--color-primary-text` | **#4b53b8** | טקסט/קישורים |
| `--color-ink` | **#0a2540** | סרגל צד / כותרות |
| `--color-accent` | **#8b91f0** | הדגשת בחירה / AI |
| `--color-bg` | **#f6f9fc** | רקע אפליקציה |
| `--color-surface` | **#ffffff** | כרטיסים |
| `--color-border` | **#e3e8ee** | קווי הפרדה |
| `--color-success` | **#1fa971** | ירוק הצלחה |
| `--color-warning` | **#e0a33b** | כתום |
| `--color-error` | **#df1b41** | אדום |
| `--color-primary-tint` | **#eeeffb** | משטח מותג בהיר |
| teal (גרפים) | **#6eabb4 / #298290** | [main.css:81-82](../lib/css/main.css#L81-L82) |

**צבעי badge לסטטוסים** ([LeadStatusCell.tsx:7-11](../components/clients/LeadStatusCell.tsx#L7-L11)): חדש=כחול · בטיפול=צהוב · מעוניין=ירוק · סגור=אפור · אבוד=אדום.
**צבעי מותג של פלטפורמות:** וואטסאפ **#25D366**, אקסל **#217346** ([LeadsFirstRun.tsx:53](../components/clients/LeadsFirstRun.tsx#L53),[:62](../components/clients/LeadsFirstRun.tsx#L62)).

**⚠️ סתירה — צבע מותג:** ה-manifest מגדיר `theme_color: #3f20f5`, `background_color: #232032` ([public/manifest.json:7-8](../public/manifest.json#L7-L8)), אך פלטת ה-CSS הנוכחית היא `#5e6ad2` (הערה ב-[main.css:69](../lib/css/main.css#L69) מציינת שהערך הישן `--color-solid` היה `#3f20f5`). **נכון לפי הקוד הפעיל: `#5e6ad2`** (main.css הוא מקור האמת לצבעי ה-UI); ה-manifest לא עודכן.

**פונט:** **Assistant** (Google), משתנה `--font-assistant`, `display: swap` ([app/layout.tsx:9-13](../app/layout.tsx#L9-L13)). פונט משתנה (weights לא ננעלים במפורש). `subsets: ['latin']`.

**רדיוסים/צללים/רווחים** ([main.css](../lib/css/main.css)): כרטיסים `rounded-md` ([:167](../lib/css/main.css#L167),[:225](../lib/css/main.css#L225)); כרטיסים שטוחים ללא צל (`--shadow-1: none`, [:92](../lib/css/main.css#L92)); צללים רק לשכבות צפות (`--shadow-overlay/-modal`, [:89-90](../lib/css/main.css#L89-L90)); `--text-md: 15px` ([:100](../lib/css/main.css#L100)); ריווח מעטפת `.wrap = px-8` ([:129-131](../lib/css/main.css#L129-L131)).

**נכסי לוגו/אייקונים:**
- לוגו: [public/media/logo.svg](../public/media/logo.svg) (SVG) · פאביקון [public/media/fav.svg](../public/media/fav.svg) (SVG) · OG [public/media/og.png](../public/media/og.png) (PNG).
- אייקוני רשתות — **SVG**: `public/media/social-icons/` → `facebook.svg`, `facebook-color.svg`, `instagram.svg`, `instagram-color.svg`, `whatsapp.svg`, `gmail.svg`.
- אייקוני רשתות — **PNG**: `public/media/social/` → `facebook.png`, `instagram.png`, `whatsapp.png`, `excel.png`.
- **פונט אייקונים** (glyphs בשמות): [lib/Icon.tsx](../lib/Icon.tsx) → `whatsapp`, `facebook`, `facebook-f`, `facebook-messenger`, `square-facebook`, `instagram`, `square-instagram`, `square-whatsapp`.
- Badge משולב פייסבוק+אינסטגרם: [components/ui/MetaLeadAdsBadge.tsx](../components/ui/MetaLeadAdsBadge.tsx).

---

## 11. שלושה רגעים חזקים ושלוש נקודות חיכוך

### רגעי ערך (מגובים בקוד)
1. **הליד נוחת לבד + נפתחת משימה.** ליד אמיתי נכנס אוטומטית ונוצרת משימה "ליד חדש מפייסבוק/מוואטסאפ"; נרשם "ערך ראשון" ([createClientFromWebhook.ts:82-84](../lib/system/createClientFromWebhook.ts#L82-L84)). *"נכנס ליד — הוא כבר במערכת עם משימה."*
2. **תיעוד שיחה בקליק אחד שמזיז הכול.** כפתור אחד קובע תוצאה, מקדם סטטוס, ומתזמן חזרה — בכתיבה אחת ([OutcomeControl.tsx:51-60](../components/leads/OutcomeControl.tsx#L51-L60) → [outcomeRules.ts:37-63](../lib/leads/outcomeRules.ts#L37-L63)). *"לחצת 'דיברנו' — קבענו לך חזרה בעוד 3 ימים."*
3. **המערכת אומרת למי להתקשר קודם.** תעדוף אוטומטי לפי SLA ודחיפות ([constants.ts:22](../lib/today/constants.ts#L22),[:39-46](../lib/today/constants.ts#L39-L46)); ההבטחה מנוסחת בקוד: *"SocialCRM כבר יסדר למי להתקשר קודם"* ([LeadsFirstRun.tsx:73](../components/clients/LeadsFirstRun.tsx#L73)).

### נקודות חיכוך (מגובות בקוד)
1. **ייבוא אקסל דורש תעודת זהות.** עמודת חובה `תעודת זהות` + ולידציה ([clients.ts:415-418](../actions/clients.ts#L415-L418),[:431](../actions/clients.ts#L431)) — לא תואם ליד מרשת חברתית. *חיכוך אמיתי בשלב הייבוא.*
2. **תזכורת לא מתריעה — רק מוצגת.** אין cron לתזכורות ([vercel.json](../vercel.json)); אם לא נכנסים למערכת, אף אחד לא "דוחף" את החזרה.
3. **הקמת החיבור נופלת הרבה.** ריבוי מצבי כשל בחיבור, כולל וריאנט הסלמה לכשל חוזר בפייסבוק ([messages.ts:94-106](../lib/connections/messages.ts#L94-L106)) ושורת כשלים בוואטסאפ ([messages.ts:233-268](../lib/connections/messages.ts#L233-L268)); בנוסף המוצר **דסקטופ בלבד** — טלפון מנותב ל-`/activate` ([lib/device.ts:20](../lib/device.ts#L20)). *כאן נופלים לפני הערך הראשון.*

---

## 12. סיכום מכונה

```json
{
  "stages": ["created", "new", "contacted", "interested", "closed", "lost"],
  "sources": {
    "facebook_lead_ads": { "status": "working", "ingest": "webhook", "code": "lib/system/createClientFromWebhook.ts" },
    "instagram_lead_ads": { "status": "working_via_facebook", "ingest": "webhook" },
    "instagram_dm": { "status": "missing", "ingest": null },
    "whatsapp": { "status": "working", "ingest": "webhook", "code": "lib/system/createLeadFromWhatsappWebhook.ts" },
    "excel_import": { "status": "partial", "ingest": "manual", "code": "actions/clients.ts:399", "note": "requires national-id column" },
    "manual_add": { "status": "working", "ingest": "manual", "code": "actions/clients.ts:190" }
  },
  "statuses": {
    "new": "חדש", "contacted": "בטיפול", "interested": "מעוניין", "closed": "סגור", "lost": "אבוד",
    "terminal": ["closed", "lost"], "source": "components/clients/LeadStatusCell.tsx:6-12"
  },
  "features_working": [
    "facebook_ingest", "whatsapp_ingest", "manual_add", "lead_statuses",
    "call_outcome_logging", "auto_status_progression", "follow_up_scheduling",
    "today_prioritization", "rep_assignment", "role_permissions", "onboarding_firstrun"
  ],
  "features_partial": ["excel_import_requires_id", "deals_sales_entity", "whatsapp_setup_flow"],
  "features_missing": ["instagram_dm_ingest", "followup_push_reminder_cron"],
  "brand_colors": {
    "primary": "#5e6ad2", "primary_text": "#4b53b8", "ink": "#0a2540", "accent": "#8b91f0",
    "bg": "#f6f9fc", "surface": "#ffffff", "border": "#e3e8ee",
    "success": "#1fa971", "warning": "#e0a33b", "error": "#df1b41",
    "whatsapp": "#25D366", "excel": "#217346",
    "manifest_theme_color_stale": "#3f20f5",
    "status_badges": { "new": "blue", "contacted": "yellow", "interested": "green", "closed": "gray", "lost": "red" },
    "font": "Assistant", "source": "lib/css/main.css:25-34"
  },
  "icon_paths": {
    "logo": "public/media/logo.svg", "favicon": "public/media/fav.svg", "og": "public/media/og.png",
    "social_svg_dir": "public/media/social-icons/",
    "social_svg": ["facebook.svg", "facebook-color.svg", "instagram.svg", "instagram-color.svg", "whatsapp.svg"],
    "social_png_dir": "public/media/social/",
    "social_png": ["facebook.png", "instagram.png", "whatsapp.png", "excel.png"],
    "icon_font": "lib/Icon.tsx",
    "meta_badge": "components/ui/MetaLeadAdsBadge.tsx"
  },
  "key_ui_strings": {
    "firstrun_title_disconnected": "חבר את העסק שלך",
    "firstrun_sub_disconnected": "כל הלידים שלך במקום אחד ו‑SocialCRM כבר יסדר למי להתקשר קודם.",
    "firstrun_title_connected": "אין עדיין לידים",
    "empty_table": "אפשר להתחיל על ידי יצירת ליד או העלאת קובץ",
    "empty_filtered": "אין לידים בסטטוס זה כרגע",
    "btn_add_lead": "הוסף ליד",
    "btn_upload_leads": "העלה לידים",
    "outcome_label": "תוצאת שיחה:",
    "outcomes": ["לא ענה", "דיברנו", "מעוניין", "לא מעוניין"],
    "toast_reached": "השיחה נשמרה. הליד יחזור לרשימת המעקב ב-{date}.",
    "toast_interested": "הליד סומן כמתעניין. נחזיר אותו למעקב ב-{date} כדי להתקדם לסגירה.",
    "auto_task_fb": "ליד חדש מפייסבוק",
    "auto_task_wa": "ליד חדש מוואטסאפ"
  }
}
```

---

### נספח — סתירות קוד↔שיווק שסומנו
1. **שתי מערכות סטטוס** — `LeadStatusCell` (נכון, נוכחי) מול `types/lists.ts STATUS_LIST` (שריד עסקאות). §4.
2. **צבע מותג** — `main.css #5e6ad2` (נכון) מול `manifest.json #3f20f5` (ישן). §10.
3. **אינסטגרם DM** — טקסט שיווקי מדבר על "לידים מאינסטגרם", אך קליטת DM אוטומטית לא קיימת בקוד; רק Lead Ads דרך Meta. §2.
4. **ייבוא אקסל** — ההבטחה "העבר את כל הלקוחות בשניות" מול דרישת עמודת ת"ז בפועל. §2, §11.
