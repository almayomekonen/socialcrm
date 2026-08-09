# whatsapp-automation.md — מיפוי מנוע האוטומציה של וואטסאפ ב-SocialCRM

> מסמך המשך ל-[carousel-brief.md](./carousel-brief.md) ול-[ai-layer.md](./ai-layer.md). **לא חוזר** על מה שכבר שם:
> קליטת הליד והדדופ (carousel §1-2), שלושת מצבי המענה ברמת-על וה-SYSTEM prompt של מצב `ai`
> (ai-layer §3), והקְרון היומי של ניתוח השיחות (ai-layer §2). כאן: הזרימה התפעולית המלאה
> מהודעה נכנסת עד הודעה יוצאת, כל תנאי זכאות והתנהגות-כשל שלו, הוולידטור הדטרמיניסטי, חלון
> 24 השעות, התבניות, ומחזור חיי ההודעה.
> **כל טענה מגובה בנתיב קובץ ומספר שורה.** מה שלא קיים בקוד מסומן "לא קיים בקוד".
> מבוסס על קוד שרץ בלבד. אין נתונים אישיים.

**מקרא:** ✅ חי · 🟡 חלקי/מאחורי דגל · ⛔ לא קיים בקוד

---

## 1. הזרימה המלאה — מהודעה נכנסת עד הודעה יוצאת

מנוע המענה נקרא בקוד **IRE — Instant Response Engine** ([route.ts:163](../app/api/webhooks/whatsapp/route.ts#L163)). שרשרת מדויקת:

| # | שלב | מה מפעיל / קוד שרץ | מה נשמר | מה המשתמש רואה |
|---|---|---|---|---|
| 1 | **Webhook נכנס** | Meta Cloud API → `POST` [app/api/webhooks/whatsapp/route.ts:28](../app/api/webhooks/whatsapp/route.ts#L28). אימות חתימה `x-hub-signature-256` = HMAC-SHA256 של גוף הבקשה עם `META_APP_SECRET`, בהשוואת `timingSafeEqual` ([:29-51](../app/api/webhooks/whatsapp/route.ts#L29-L51)). חתימה שגויה → `403`. | — | — |
| 2 | **מיון payload** | שלושה מסלולים בלתי-תלויים: `statuses` (מסירה) [:72-79](../app/api/webhooks/whatsapp/route.ts#L72-L79); עדכוני-סטטוס-תבנית [:85-94](../app/api/webhooks/whatsapp/route.ts#L85-L94) (חוזר מיד, **לא** מפעיל אוטומציה); `messages` [:96](../app/api/webhooks/whatsapp/route.ts#L96). כל שאר המצבים מחזירים `200` (כדי ש-Meta לא ינסה שוב וישבית את המנוי) [:58](../app/api/webhooks/whatsapp/route.ts#L58),[:181](../app/api/webhooks/whatsapp/route.ts#L181). | — | — |
| 3 | **זיהוי דייר** | `phone_number_id` → שורת `whatsapp_connections` [:112-116](../app/api/webhooks/whatsapp/route.ts#L112-L116). אין שורה → מתעלם (`200`). | — | — |
| 4 | **יצירת/מציאת ליד** | `createLeadFromWhatsappWebhook` [:133-140](../app/api/webhooks/whatsapp/route.ts#L133-L140) — דדופ + משימה "ליד חדש מוואטסאפ" (ראה carousel §1). | `clients` | הליד ברשימה + משימה |
| 5 | **שמירת השיחה** | `ingestWhatsappInbound` בטרנזקציה [:152](../app/api/webhooks/whatsapp/route.ts#L152): `findOrCreateConversation`, `ensureParticipant`×2, `insertInboundMessage` (סטטוס `received`, `sequence`++, דדופ על `channel+externalId`) [ingestWhatsappInbound.ts:29-73](../lib/inbox/ingestWhatsappInbound.ts#L29-L73), [inboxMessages.ts:118-122](../db/inboxMessages.ts#L118-L122). | `inbox_conversations`, `inbox_participants`, `inbox_messages` | ההודעה בשיחה ב-inbox |
| 6 | **הזנת jobs (רק אם `inserted`)** | באותה טרנזקציה: `enqueueConversationAnalysis` (ה-job לקרון היומי, ai-layer §2) + `enqueueAutoResponse` [ingestWhatsappInbound.ts:81-107](../lib/inbox/ingestWhatsappInbound.ts#L81-L107). `reason` = `qualify_turn` אם `settings.mode='qualify'`, אחרת `first_contact` [:98](../lib/inbox/ingestWhatsappInbound.ts#L98); `delaySeconds` נחתך ל-0..3600 [:96-97](../lib/inbox/ingestWhatsappInbound.ts#L96-L97). | `auto_response_jobs` (סטטוס `pending`) | — |
| 7 | **שער ההזנה (SQL)** | `enqueueAutoResponse` מזין **רק אם** `agencies.autoResponseEnabled=true` **וגם** `auto_response_settings.enabled=true`, עם שמירת single-job ל-`first_contact`, `ON CONFLICT DO NOTHING` [autoResponseJobs.ts:43-60](../db/autoResponseJobs.ts#L43-L60). `notBefore = now()+delay`. | — | — |
| 8 | **בעיטת ה-worker** | **אחרי** שה-`200` נשלח ל-Meta, `after()` מריץ `runAutoResponseWorker({limit:5})` [route.ts:163-176](../app/api/webhooks/whatsapp/route.ts#L163-L176). זה **המסלול הראשי**; ה-cron `send-auto-responses` הוא גיבוי בלבד ו**אינו מתוזמן** ב-[vercel.json](../vercel.json) ([send-auto-responses/route.ts:7-12](../app/api/cron/send-auto-responses/route.ts#L7-L12)). | — | — |
| 9 | **תפיסת jobs** | `reclaimStaleAutoResponseJobs` (lease 60ש') → `claimAutoResponseJobs` עם `FOR UPDATE SKIP LOCKED`, `status='pending'`, `notBefore<=now` [worker.ts:205-206](../lib/inbox/autoresponse/worker.ts#L205-L206), [autoResponseJobs.ts:70-100](../db/autoResponseJobs.ts#L70-L100). | `status='processing'` | — |
| 10 | **`processJob`** | טוען master/settings/conv/lead [worker.ts:51-58](../lib/inbox/autoresponse/worker.ts#L51-L58); מדלג אם conv/lead נעלמו או שהליד סופי (`closed`/`lost`) [:59-61](../lib/inbox/autoresponse/worker.ts#L59-L61). | — | — |
| 11 | **הסתעפות מצב** | `settings.mode='qualify'` → `processQualifyJob` [worker.ts:65-86](../lib/inbox/autoresponse/worker.ts#L65-L86); אחרת מסלול `acknowledge` (§2-§3). | — | — |
| 12 | **ניסוח** | `fixed` → `renderFixedReply` [worker.ts:113-120](../lib/inbox/autoresponse/worker.ts#L113-L120); `ai` → עד 2 ניסיונות `generateAcknowledgement`+`validateAutoResponse`, אחרת דילוג [worker.ts:121-133](../lib/inbox/autoresponse/worker.ts#L121-L133). | — | — |
| 13 | **שליחה** | טוען token מ-`whatsapp_connections`, נמען; `sendWhatsappText` = `POST` Graph `type:'text'` [worker.ts:136-149](../lib/inbox/autoresponse/worker.ts#L136-L149), [sendMessage.ts:66-79](../lib/whatsapp/sendMessage.ts#L66-L79). | — | — |
| 14 | **התמדה** | הצלחה → `persistOutboundWhatsapp` (סטטוס `sent`, `metadata.source='auto_response'`) + `completeAutoResponseJob` + אירוע `auto_response_sent` [worker.ts:157-190](../lib/inbox/autoresponse/worker.ts#L157-L190). כשל → `failAutoResponseJob` (retry/dead) [worker.ts:150-155](../lib/inbox/autoresponse/worker.ts#L150-L155). | `inbox_messages` (outbound), `auto_response_jobs.status='sent'` | בועת מענה בשיחה |

**כמה זמן עובר בפועל:** ברירת המחדל `delaySeconds=0` = מיידי [autoResponseSettings.ts:88](../db/autoResponseSettings.ts#L88), ובעיטת ה-`after()` שולחת "תוך שניות" ([route.ts:163-164](../app/api/webhooks/whatsapp/route.ts#L163-L164)). ה-worker מודד ורושם את זמן הריצה בפועל: `ms = Date.now() - job.createdAt` [worker.ts:181-183](../lib/inbox/autoresponse/worker.ts#L181-L183). כלומר במסלול הרגיל: **קליטת webhook → קריאת AI אחת → שליחת Graph אחת = שניות בודדות**, אלא אם הוגדרה השהיה (עד 3600ש'). אין polling יוצא ואין תור מתוזמן — הכול נדחף מהאירוע.

---

## 2. תנאי הזכאות — הרשימה המדויקת והתנהגות-הכשל

זכאות נאכפת **פעמיים**: שער SQL בזמן הזנה [autoResponseJobs.ts:49-57](../db/autoResponseJobs.ts#L49-L57), ובדיקה סמכותית חוזרת ב-worker לפני שליחה. במצב `acknowledge` הפונקציה הטהורה `decideEligibility` בודקת **בסדר הזה**, וכל כשל מחזיר `skipReason` ורושם אירוע `auto_response_skipped` [worker.ts:45-49](../lib/inbox/autoresponse/worker.ts#L45-L49):

| # | תנאי (מקור הנתון) | אם נכשל → `skipReason` | מקור |
|---|---|---|---|
| 0 | הליד לא סופי (`closed`/`lost`) | `lead_terminal` | [worker.ts:61](../lib/inbox/autoresponse/worker.ts#L61) |
| 1 | `masterEnabled` = `agencies.autoResponseEnabled` | `feature_off` | [eligibility.ts:22](../lib/inbox/autoresponse/eligibility.ts#L22) |
| 2 | `channelEnabled` = `auto_response_settings.enabled` | `channel_off` | [eligibility.ts:23](../lib/inbox/autoresponse/eligibility.ts#L23) |
| 3 | **אין תשובת אדם קודמת** (`inbox_messages.sentByUserId` לא-null) | `human_replied` | [eligibility.ts:24](../lib/inbox/autoresponse/eligibility.ts#L24), [worker.ts:90-93](../lib/inbox/autoresponse/worker.ts#L90-L93) |
| 4 | **לא בשעות שקט** | `quiet_hours` | [eligibility.ts:25](../lib/inbox/autoresponse/eligibility.ts#L25) |
| 5 | **מתחת למכסה יומית** (`sentTodayForAgency >= dailyCap`) | `daily_cap` | [eligibility.ts:26](../lib/inbox/autoresponse/eligibility.ts#L26) |
| 6 | אין מגע-ראשון-אוטומטי קודם | `already_first_contact` | [eligibility.ts:27](../lib/inbox/autoresponse/eligibility.ts#L27) |
| 7 | אין שום outbound קודם בשיחה | `already_responded` | [eligibility.ts:28](../lib/inbox/autoresponse/eligibility.ts#L28) |

עובר הכול → `{ shouldRespond: true, reason: 'first_contact' }` [eligibility.ts:29](../lib/inbox/autoresponse/eligibility.ts#L29). כלומר במצב `acknowledge` המנוע הוא **מגע-ראשון חד-פעמי** בלבד: כל outbound קודם (גם אוטומטי) חוסם.

**שעות שקט** ([worker.ts:35-40](../lib/inbox/autoresponse/worker.ts#L35-L40)): פעיל רק אם גם `startHour` וגם `endHour` מוגדרים (אחרת מחזיר `false` = אין שקט); אזור זמן ברירת-מחדל `Asia/Jerusalem` [:37](../lib/inbox/autoresponse/worker.ts#L37); תומך בחלון חוצה-חצות (`start > end`) [:39](../lib/inbox/autoresponse/worker.ts#L39).

**מכסה יומית** ([autoResponseJobs.ts:152-159](../db/autoResponseJobs.ts#L152-L159)): `countSentToday` = ספירת `auto_response_jobs` עם `status='sent'` מאז `date_trunc('day', now())`, **per-agency**. הערה: `dailyCap` שנקרא ב-worker הוא `settings?.dailyCap ?? 0` [worker.ts:106](../lib/inbox/autoresponse/worker.ts#L106) — אם אין שורת הגדרות, המכסה 0 והתנאי חוסם (אך תנאי 2 `channel_off` יקדים אותו).

**כשלי ניסוח (אחרי המעבר בזכאות):** גוף קבוע ריק → `fixed_body_empty` [worker.ts:114-120](../lib/inbox/autoresponse/worker.ts#L114-L120); כשל ולידציה פעמיים במצב `ai` → `validation_failed` [worker.ts:132](../lib/inbox/autoresponse/worker.ts#L132); אין חיבור/נמען → `no_connection`/`no_recipient` [worker.ts:139-141](../lib/inbox/autoresponse/worker.ts#L139-L141); conv/lead נעלמו → `conversation_gone`/`lead_gone` [worker.ts:59-60](../lib/inbox/autoresponse/worker.ts#L59-L60).

**מצב `qualify`** משתמש בשער עשיר יותר, `decidePreGeneration` [stateMachine.ts:33-52](../lib/inbox/autoresponse/stateMachine.ts#L33-L52), בסדר: `human_active`/`opted_out` (סופי) → `humanTookOver` עוצר → `optOut` עוצר → `feature_off` → `channel_off` → `already_escalated` → `max_turns` → `no_pending_inbound` (תור-דיבור) → `outside_window` (§4) → `quiet_hours` → `daily_cap`. "אדם תמיד מנצח" נבדק **ראשון וללא תנאי** [stateMachine.ts:37-39](../lib/inbox/autoresponse/stateMachine.ts#L37-L39).

---

## 3. שלושת המצבים — `fixed`, `ai`, `qualify`

בורר המצב: `replyMode` (`ai`/`fixed`) ל-acknowledge [replyMode.ts:8-10](../lib/inbox/autoresponse/replyMode.ts#L8-L10), ו-`mode='qualify'` שמסיט למעבד נפרד [worker.ts:65](../lib/inbox/autoresponse/worker.ts#L65).

### 3א. `fixed` — תבנית קבועה של העסק
מה נשלח: `fixedBody` של הסוכנות עם החלפת `{{firstName}}` בלבד; toקן לא-מוכר נשאר כמו שהוא [renderFixedReply.ts:18-21](../lib/inbox/autoresponse/renderFixedReply.ts#L18-L21). `firstName` נגזר מה-lead, ואם ריק — מהמילה הראשונה ב-`customerName` [renderFixedReply.ts:10-16](../lib/inbox/autoresponse/renderFixedReply.ts#L10-L16). **מי מנסח:** העסק (טקסט סטטי). **ולידטור:** לא מופעל על `fixed` (טקסט של הבעלים). **כשל:** גוף ריק → `fixed_body_empty` (דילוג, לא שליחה) [worker.ts:114-120](../lib/inbox/autoresponse/worker.ts#L114-L120).

### 3ב. `ai` — ניסוח ע"י מודל (ברירת מחדל)
מה נשלח: ברכה + אישור קבלה + שאלת הבהרה אחת, 1–3 משפטים [generate.ts:20-27](../lib/inbox/autoresponse/generate.ts#L20-L27). **מי מנסח:** `generateAcknowledgement` דרך `runStructured` (allowlist + תקרת USD יומית נאכפים שם) [generate.ts:45-52](../lib/inbox/autoresponse/generate.ts#L45-L52). ה-SYSTEM prompt המלא כבר מצוטט ב-**ai-layer §3** ([generate.ts:20-27](../lib/inbox/autoresponse/generate.ts#L20-L27)) — לא חוזר עליו כאן. ה-**USER prompt** (לא מופיע ב-ai-layer), נבנה ב-`buildUser` [generate.ts:29-37](../lib/inbox/autoresponse/generate.ts#L29-L37):

```
שם הליד: {שם או "לא ידוע"}
ההודעה שהליד שלח: {טקסט או "(ללא טקסט)"}
הקשר עסקי (לרקע בלבד, לא לציטוט כעובדה): {guidance}   ← רק אם קיים
```

**ולידטור לפני שליחה:** `validateAutoResponse` (§להלן). **כשל:** עד 2 ניסיונות ניסוח; אם אף אחד לא עובר ולידציה — `validation_failed`, **לעולם לא נשלח** [worker.ts:121-133](../lib/inbox/autoresponse/worker.ts#L121-L133).

### 3ג. `qualify` — תשאול רב-תורי (opt-in, מאחורי דגל)
מה נשלח: שאלת הבהרה אחת בכל תור עד השלמת שדות חובה או אות-חם, ואז הודעת העברה לנציג [qualifyWorker.ts:131-497](../lib/inbox/autoresponse/qualifyWorker.ts#L131-L497). **מי מנסח:** `generateQualifyTurn` דרך `runStructured` [qualify.ts:193-241](../lib/inbox/autoresponse/qualify.ts#L193-L241). ההחלטה escalate-מול-send: `decidePostGeneration` — `hotSignal`→העברה, `uncertain`→העברה, `requiredComplete`→העברה `qualified`, `turn+1>=maxTurns`→העברה `max_turns`, אחרת שליחה [stateMachine.ts:65-72](../lib/inbox/autoresponse/stateMachine.ts#L65-L72).

**ה-SYSTEM prompt המלא של `qualify`** (לא מופיע ב-ai-layer, [qualify.ts:134-155](../lib/inbox/autoresponse/qualify.ts#L134-L155)):

```
את/ה נציג/ת המכירות הראשון/ה של Social CRM — מערכת לניהול לידים — והקשר הראשון עם ליד חדש שכתב בוואטסאפ. המטרה: להבין את העסק של הלקוח, להעריך אם ה-CRM מתאים לו, ולאסוף רק את מה שנציג/ת אנושי/ת צריכ/ה כדי להמשיך: שם וצורך (ודחיפות אם היא עולה מעצמה). דבר/י כמו נציג/ת מכירות מנוסה — לא כמו שאלון.
- קרא/י את כל השיחה לפני כל תשובה. אל תשאל/י על מידע שהלקוח כבר מסר, ולעולם אל תשאל/י את אותה שאלה פעמיים.
- אם השם כבר נמסר (גם אם באותה הודעה עם פרטים נוספים), אל תשאל/י עליו שוב — קבע/י name ועבר/י לשדה הבא.
- אם הלקוח לא ענה לשאלה או ענה תשובה ריקה ("כן", "בטח", "אוקיי"), אל תחזור/חזרי על אותה שאלה מילה במילה — נסח/י אותה אחרת פעם אחת, ואם עדיין אין תשובה עבר/י לשדה אחר.
- הכר/י תמיד במה שהלקוח כתב זה עתה: שקף/י בקצרה את מה שהבנת, ורק אז שאל/י שאלה אחת (אם עדיין צריך).
- שאלה אחת בלבד בכל הודעה — קצרה, חמה, עם סימן שאלה אחד (1-2 משפטים).
- ברך/י פעם אחת בלבד בתחילת השיחה; אל תפתח/י כל הודעה מחדש בברכה או בשם הלקוח.
- הגדרות: name = איך לפנות ללקוח; need = הבעיה העסקית שהלקוח רוצה שה-CRM יפתור; urgency = כמה דחוף או לוחץ הצורך עבורו.
- מלא/י את extracted ממה שהלקוח אמר במפורש וגם ממה שאפשר להסיק באופן סביר; null רק כשבאמת לא ידוע. לעולם אל תשאל/י על שדה שכבר ידוע או ניתן להסקה.
- need: אם הלקוח תיאר בעיה עסקית או מה הוא מחפש — קבע/י אותה כ-need מיד.
- ביטויים כמו "אני מאבד לידים", "מוצף בלידים", "לא מצליח לעקוב", "פניות הולכות לאיבוד", "יש לי הרבה לידים ואין סדר" הם ה-need עצמו (ניהול ומעקב לידים) — קבע/י אותו מיד ואל תשאל/י שוב "מה האתגר" או "מה הצורך".
- urgency: אם הלקוח מביע לחץ או כאב ברור (עומס, ריבוי לידים, קושי לעקוב, לידים שנופלים) — קבע/י מיד urgency מתוך הסימן הזה (למשל "גבוהה — עומס נוכחי") ואל תשאל/י על דחיפות. שאל/י על דחיפות רק כשאין שום סימן ללחץ.
- אם הלקוח אומר במפורש שהעניין דחוף ("דחוף", "זה דחוף לי", "מיידי", "אני מפספס עסקאות" או "הזדמנויות") — קבע/י מיד urgency="גבוהה", אל תשאל/י ואל תבקש/י לאשר.
- שאל/י רק שאלות שמקדמות את ההסמכה (name/need/urgency או התאמת ה-CRM). הימנע/י משאלות סקרנות — למשל סוג המוצר או התוכן שהלקוח מוכר.
- אם הלקוח שואל באמצע התשאול על מחיר, תכונה, אינטגרציה או דמו — הכר/י בקצרה שיש לו שאלה חשובה וציין/י שנציג/ת יחזור עם כל הפרטים המדויקים, ואז המשך/כי לשדה החובה הבא. אל תשתמש/י במילים "מחיר", "עלות", "הנחה", "זמין", "מועד" או "פגישה", אל תנקוב/י במספרים ואל תמציא/י פרטים על המוצר.
- ברגע ששם וצורך ידועים (במפורש או בהסקה), סיים/י והעבר/י לנציג אנושי; אל תעכב/י את ההעברה כדי לברר דחיפות ואל תמציא/י שאלות מילוי.
- hotSignal=true אם הלקוח מביע כוונת קנייה חזקה (מחיר/דמו/פגישה/להתחיל/בקשה לדבר עם נציג).
- uncertain=true רק אם אינך יכול/ה להמשיך באמת בלי להמציא או שנדרש אדם — לא בגלל ניסוח או פורמט.
- אסור בתכלית: לנקוב במחיר/עלות/הנחה/זמינות/מועד/תור/פגישה; להבטיח או להתחייב; להמציא עובדה על המוצר או העסק שלנו; לכתוב מספרים. אם חסר מידע — שאל/י או העבר/י לנציג, אל תמציא/י.
- כתוב/כתבי בעברית, בגוף ראשון רבים, מקצועי וחם.
```

**הודעות ההעברה לנציג** (קבועות, [qualify.ts:73-91](../lib/inbox/autoresponse/qualify.ts#L73-L91)):
- `qualified`/`hot_signal`/`max_turns`: `"מעולה, יש לי מספיק מידע. אני מעביר את הפרטים שלך לאחד מאנשי הצוות שלנו שיחזור אליך בהקדם."`
- `uncertain`/`guardrail`: `"אני מעביר אותך לאחד מאנשי הצוות שלנו שיוכל לעזור."`

### הוולידטור הדטרמיניסטי (`validate.ts`) — מה נבדק ומה קורה בפסילה
"המודל לעולם אינו נאמן לשמור על עצמו" — פונקציה טהורה שהיא השער האחרון [validate.ts:1-10](../lib/inbox/autoresponse/validate.ts#L1-L10). בדיקות `validateAutoResponse` [validate.ts:61-86](../lib/inbox/autoresponse/validate.ts#L61-L86), **לפי סדר**: ריק → `empty`; >3 משפטים → `too_long`; >320 תווים → `too_long`; 0 סימני שאלה → `no_question`; >1 סימן שאלה → `too_many_questions`; התאמה ל-`FORBIDDEN` → `forbidden`.

רשימת `FORBIDDEN` המלאה [validate.ts:11-43](../lib/inbox/autoresponse/validate.ts#L11-L43): מטבע `[₪$€]`, `ש"ח`, `שקל`, `מחיר`, `עלות`, `כמה עולה`, `הצעת מחיר`, `\bprice\b`, `\bcost\b`; `הנחה`, `מבצע`, `\bdiscount\b`, `\bdeal\b`; `זמין`, `שעה`, `מחר`, `נקבע`, `אקבע`, `פגיש`, `\bavailable\b`, `\bappointment\b`; `מבטיח`, `מתחייב`, `\bguarantee`, `\bpromise\b`; וכל רצף של **2+ ספרות** `\d{2,}`. (מונחי עברית נבדקים כתת-מחרוזת כי `\b` הוא ASCII בלבד — פסילת-שווא בטוחה, שתיקה [validate.ts:5-9](../lib/inbox/autoresponse/validate.ts#L5-L9).)

**מה קורה בפסילה:**
- מצב `ai` (acknowledge): מנסה שוב פעם אחת; אם עדיין נכשל → `validation_failed`, דילוג (מעביר לאדם), לא נשלח [worker.ts:122-132](../lib/inbox/autoresponse/worker.ts#L122-L132).
- מצב `qualify`: `classifyViolation` ממיין ל-`safety` (=`forbidden`) מול `shape` (כל השאר) [validate.ts:88-103](../lib/inbox/autoresponse/validate.ts#L88-L103). ניסוח מחדש **אחד** עם אילוץ מחמיר [qualify.ts:56-61](../lib/inbox/autoresponse/qualify.ts#L56-L61):
  - `shape_validation`: `"חשוב מאוד: כתוב/כתבי תשובה קצרה מאוד — שאלת הבהרה אחת בלבד, סימן שאלה אחד, עד שלושה משפטים, בלי מספרים."`
  - `safety_validation`: `"חשוב מאוד: אל תנקוב/י במחיר, עלות, הנחה, זמינות, מועד, תור, פגישה או התחייבות, ואל תכתוב/י מספרים. שאל/י שאלת הבהרה אחת בלבד."`
  אם הפרת **safety** שרדה → **העברה כפויה** (`guardrail`), התשובה **לעולם לא נשלחת** [qualifyWorker.ts:288-289](../lib/inbox/autoresponse/qualifyWorker.ts#L288-L289),[:347](../lib/inbox/autoresponse/qualifyWorker.ts#L347). אם הפרת **shape** שרדה → שאלת-שדה-חובה דטרמיניסטית שכתובה מראש (לעולם לא העברה) [qualifyWorker.ts:294-299](../lib/inbox/autoresponse/qualifyWorker.ts#L294-L299), [qualify.ts:97-116](../lib/inbox/autoresponse/qualify.ts#L97-L116). השאלות הקבועות (שם/צורך/דחיפות/תקציב/מיקום/חזרה) ב-[qualify.ts:97-105](../lib/inbox/autoresponse/qualify.ts#L97-L105).

יש גם ולידטור-אחות ל-post-handoff (`validateConciergeReply`) שמוותר על "בדיוק שאלה אחת" אך שומר על `FORBIDDEN` והאורך [validate.ts:112-133](../lib/inbox/autoresponse/validate.ts#L112-L133).

---

## 4. חלון 24 השעות

Meta מתירה טקסט חופשי רק בתוך 24ש' מההודעה הנכנסת האחרונה; אחרי זה חייבים תבנית מאושרת.

**מסלול הטקסט החופשי לא בודק מראש** — `sendWhatsappText` שולח ל-Graph ומחזיר את שגיאת Meta כמות שהיא [sendMessage.ts:86-116](../lib/whatsapp/sendMessage.ts#L86-L116). מיפוי הקוד → קטגוריה נעשה ב**מקום היחיד** שקוד Meta מופיע בו [whatsappErrorCopy.ts:1-13](../lib/inbox/whatsappErrorCopy.ts#L1-L13):

| קוד Meta | קטגוריה | מקור |
|---|---|---|
| `470`, `131047`, `131051` | `window_expired` | [whatsappErrorCopy.ts:18-20](../lib/inbox/whatsappErrorCopy.ts#L18-L20) |
| `131026`, `131052` | `recipient` | [:22-23](../lib/inbox/whatsappErrorCopy.ts#L22-L23) |
| `131031`, `131042`, `131049`, `141006` | `account` | [:25-28](../lib/inbox/whatsappErrorCopy.ts#L25-L28) |
| כל השאר | `generic` | [:43](../lib/inbox/whatsappErrorCopy.ts#L43) |

**איפה זה נבדק בפועל:** בזמן קליטת webhook של סטטוס `failed`, `ingestWhatsappStatuses` כותב `errorReason = category` על שורת ההודעה [ingestWhatsappStatuses.ts:65-85](../lib/inbox/ingestWhatsappStatuses.ts#L65-L85). **מה המשתמש רואה** (מילה במילה, [whatsappErrorCopy.ts:32](../lib/inbox/whatsappErrorCopy.ts#L32)):

> **`ההודעה לא נשלחה — עברו יותר מ־24 שעות מאז שהליד כתב. אפשר להתקשר אליו.`**

**מצב `qualify` בודק את החלון מראש** (לפני שמבזבז קריאת AI): `WINDOW_MS = 24*60*60*1000`, `withinWindow = now - lastInboundAt < WINDOW_MS` [qualifyWorker.ts:57](../lib/inbox/autoresponse/qualifyWorker.ts#L57),[:170](../lib/inbox/autoresponse/qualifyWorker.ts#L170); מחוץ לחלון → דילוג `outside_window` [stateMachine.ts:47](../lib/inbox/autoresponse/stateMachine.ts#L47). מצב `acknowledge` **אינו** בודק חלון — הוא מגע-ראשון, ולכן בהגדרה בתוך החלון.

**מוצא מהחלום:** תבנית מאושרת נשלחת גם אחרי שהחלון נסגר — `sendWhatsappTemplate` [sendTemplateMessage.ts:12-14](../lib/whatsapp/sendTemplateMessage.ts#L12-L14), [SendReadyMessage.tsx:13](../components/clients/SendReadyMessage.tsx#L13). זו כל מטרת מסלול התבניות.

---

## 5. תבניות מאושרות (Ready-Made Messages)

**מתי חובה תבנית ומתי אפשר טקסט חופשי:** בתוך חלון 24ש' → טקסט חופשי (`ai`/`fixed`, §3). אחרי סגירת החלון / re-engagement → **חייבים תבנית מאושרת** [sendTemplateMessage.ts:12-14](../lib/whatsapp/sendTemplateMessage.ts#L12-L14).

**איך נשלחת תבנית** ([actions/whatsapp/templates/sendTemplateToLead.ts:44-133](../actions/whatsapp/templates/sendTemplateToLead.ts#L44-L133)): פעולת **נציג** (`requireAgencyUser`, לא admin) [:54](../actions/whatsapp/templates/sendTemplateToLead.ts#L54); מאחורי דגל `isTemplatesEnabledForAgency` [:57](../actions/whatsapp/templates/sendTemplateToLead.ts#L57); התבנית חייבת להיות `status='approved'` [:62](../actions/whatsapp/templates/sendTemplateToLead.ts#L62); פרמטרים פוזיציוניים `{{1}},{{2}}…` נפתרים, ותבנית שסונכרנה מ-Meta בלי מיפוי **נחסמת** (תיקון `#132000`) [:80-88](../actions/whatsapp/templates/sendTemplateToLead.ts#L80-L88); שולח `type:'template'` [:95-102](../actions/whatsapp/templates/sendTemplateToLead.ts#L95-L102); **ליד אחד בלבד — אין bulk, אין תזמון, אין אוטומציה** [:29-30](../actions/whatsapp/templates/sendTemplateToLead.ts#L29-L30). זהו מסלול **יזום ידנית** — לא חלק ממנוע ה-IRE.

**מה מסונכרן מ-Meta:** שני נתיבים, שניהם **קוראים בלבד ולעולם לא שולחים**:
1. **Webhook בזמן אמת** — `message_template_status_update` / `message_template_quality_update` → `ingestTemplateStatusUpdate`, מפתח לפי WABA id, חוזר מיד [route.ts:85-94](../app/api/webhooks/whatsapp/route.ts#L85-L94).
2. **Cron השלמה** — `whatsapp-template-sync` כל 6ש' ([vercel.json](../vercel.json)) → `reconcileWabaTemplates` לכל חיבור עם WABA id [whatsapp-template-sync/route.ts:31-56](../app/api/cron/whatsapp-template-sync/route.ts#L31-L56).

**מיפוי סטטוס Meta → enum סגור** [statusCopy.ts:17-33](../lib/whatsapp/templates/statusCopy.ts#L17-L33): `APPROVED→approved`, `REJECTED→rejected`, `PAUSED→paused`, `DISABLED/DELETED/PENDING_DELETION→disabled`, כל השאר (כולל `PENDING`/`IN_APPEAL`/`FLAGGED`) → `pending` (שמרני — לעולם לא "מוכן" בטעות).

**מה המשתמש רואה** (תוויות pill, [messages.ts:11-17](../lib/whatsapp/templates/messages.ts#L11-L17)):

| enum | תווית עברית |
|---|---|
| `pending` | **בבדיקת וואטסאפ** |
| `approved` | **מוכנה לשליחה** |
| `rejected` | **נדחתה** |
| `paused` | **מושהית** |
| `disabled` | **לא פעילה** |

**נוסח דחייה** (לפי דלי, מילה במילה, [messages.ts:20-25](../lib/whatsapp/templates/messages.ts#L20-L25)):
- `invalid_format`: `ההודעה לא אושרה — הניסוח לא תקין. כדאי לפשט את הטקסט ולנסות שוב.`
- `policy`: `ההודעה לא אושרה — התוכן נוגד את מדיניות וואטסאפ. כדאי לנסח מחדש בלי תוכן שיווקי אגרסיבי.`
- `content_mismatch`: `ההודעה לא אושרה — מטרת ההודעה לא תואמת לתוכן. כדאי לבחור מטרה אחרת או לשנות את הנוסח.`
- `generic`: `וואטסאפ לא אישרה את ההודעה. כדאי לנסח מחדש בפשטות ולנסות שוב.`

**יצירת תבנית** ([createTemplate.ts:32-88](../actions/whatsapp/templates/createTemplate.ts#L32-L88)): **admin בלבד** [:34](../actions/whatsapp/templates/createTemplate.ts#L34); ולידציה → הרכבת payload → `createTemplateOnMeta` → שורת `pending` מקומית (אישור Meta מגיע אסינכרונית ב-webhook) [:72-85](../actions/whatsapp/templates/createTemplate.ts#L72-L85); שפה קבועה `he` [:30](../actions/whatsapp/templates/createTemplate.ts#L30); מוגבל ל-10 יצירות ב-24ש' [rateLimit.ts:11](../lib/whatsapp/templates/rateLimit.ts#L11). ה**סט הסגור** של משתני-אישיות: `שם הליד`→`leadFirstName`, `שם העסק`→`businessName` — אין משתנים חופשיים [messages.ts:43-46](../lib/whatsapp/templates/messages.ts#L43-L46).

**מחיר per-תבנית:** **לא קיים בקוד** — אין לוגיקת חיוב/תמחור תבניות בריפו (החיוב הוא בצד Meta).

---

## 6. מחזור החיים של הודעה יוצאת

**חמישה סטטוסים** [inboxMessages.ts:7](../db/inboxMessages.ts#L7): `received | sent | delivered | read | failed`. נכנסת נשמרת `received` [:122](../db/inboxMessages.ts#L122); יוצאת נשמרת `sent` [:99](../db/inboxMessages.ts#L99),[:138](../db/inboxMessages.ts#L138) — **`sent` = Meta קיבלה, לא שהגיעה** [:154](../db/inboxMessages.ts#L154).

**עדכון מסירה** (webhook `statuses`): `ingestWhatsappStatuses` מעדכן לפי wamid ב-`inbox_messages.externalId`, עם **סולם חד-כיווני** ב-SQL (`sent→delivered→read/failed`, לעולם לא לאחור) [ingestWhatsappStatuses.ts:71-85](../lib/inbox/ingestWhatsappStatuses.ts#L71-L85); חותמות `sentAt`/`deliveredAt`/`readAt`/`failedAt` תחת `metadata.delivery` בעומק אחד [:25-30](../lib/inbox/ingestWhatsappStatuses.ts#L25-L30),[:81-84](../lib/inbox/ingestWhatsappStatuses.ts#L81-L84). לעולם לא זורק ולעולם לא מוסיף שורה (סטטוס ל-wamid לא-מוכר = דיאגנוסטיקה) [:12-15](../lib/inbox/ingestWhatsappStatuses.ts#L12-L15).

**איפה נשמר ומה מוצג:** `mapLeadWhatsappMessageRow` הוא הממפה היחיד; `failureText` נפתר **בשרת**, לא-null רק כשהסטטוס `failed` [inboxMessages.ts:184-207](../db/inboxMessages.ts#L184-L207). הטלת סטטוסים יוצאים חסומה ל-60 האחרונים [:265-282](../db/inboxMessages.ts#L265-L282).

**הודעות השגיאה בעברית — מילה במילה** ([whatsappErrorCopy.ts:32-35](../lib/inbox/whatsappErrorCopy.ts#L32-L35)):

| קטגוריה | טקסט |
|---|---|
| `window_expired` | `ההודעה לא נשלחה — עברו יותר מ־24 שעות מאז שהליד כתב. אפשר להתקשר אליו.` |
| `recipient` | `ההודעה לא נשלחה — המספר אינו פעיל ב־WhatsApp.` |
| `account` | `ההודעה לא נשלחה — שליחת הודעות מושבתת כרגע. נדרשת בדיקה בהגדרות החשבון.` |
| `generic` | `ההודעה לא נשלחה. נסה שוב.` |

הערה: קטגוריית `account` מאחדת בכוונה חיוב (`141006`) והגבלת-חשבון (`131031`) — כדי לא לבייש את הנציג על בעיה של הבעלים [whatsappErrorCopy.ts:8-12](../lib/inbox/whatsappErrorCopy.ts#L8-L12). קוד Meta גולמי **לעולם** לא מגיע ל-DB/UI [:5-6](../lib/inbox/whatsappErrorCopy.ts#L5-L6).

---

## 7. מסך ההגדרות — "מענה אוטומטי"

מסלול: `/settings/auto-response` (תחת `admin_settings` → **admin בלבד**), טוען דרך `getMasterEnabled` + `getChannelSettings` [auto-response/page.tsx:8-13](../app/(app)/settings/(admin_settings)/auto-response/page.tsx#L8-L13). כותרת: **"מענה אוטומטי ללידים חדשים"** [AutoResponseSettingsForm.tsx:60](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L60).

| שדה | תווית בממשק | ברירת מחדל | מקור |
|---|---|---|---|
| master (`agencies.autoResponseEnabled`) | **הפעלת מענה אוטומטי בעסק** | `false` | [form:70](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L70), [autoResponseSettings.ts:64](../db/autoResponseSettings.ts#L64) |
| channel (`auto_response_settings.enabled`) | **וואטסאפ** | `false` | [form:77](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L77), [page:20](../app/(app)/settings/(admin_settings)/auto-response/page.tsx#L20) |
| `replyMode` | רדיו **מענה חכם** / **הודעה קבועה** | `ai` | [form:101](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L101),[:114](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L114), [page:21](../app/(app)/settings/(admin_settings)/auto-response/page.tsx#L21) |
| `guidance` (מצב חכם) | **הקשר עסקי לרקע** ("לא לציטוט כעובדה") | `null`, max 1000 | [form:121-131](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L121-L131) |
| `fixedBody` (מצב קבוע) | **הודעה קבועה** (`{{firstName}}`) | `null`, max 1000 | [form:136-146](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L136-L146) |
| `delaySeconds` | **השהיה לפני שליחה** (שניות; "0 = שליחה מיידית") | `0`, 0–3600 | [form:155-166](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L155-L166) |
| `dailyCap` | **מגבלת מענים ליום** | `200` | [form:167-175](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L167-L175), [page:19](../app/(app)/settings/(admin_settings)/auto-response/page.tsx#L19) |

שמירה: **"שמור שינויים"** → **"השינויים נשמרו"** [form:183](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L183),[:190](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L190). שגיאת גוף-קבוע-חסר: **"יש להזין הודעה קבועה"** [form:51](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L51).

**מה המסך לא חושף:** `mode='qualify'`, `maxTurns`, `collectFields`, `draft` — קיימים ב-`AutoResponseSettings` [autoResponseSettings.ts:34-41](../db/autoResponseSettings.ts#L34-L41) עם ברירות מחדל `maxTurns=5` ו-`collectFields={required:[name,need,urgency], optional:[budget,location,callback]}` [autoResponseSettings.ts:60](../db/autoResponseSettings.ts#L60),[:83-84](../db/autoResponseSettings.ts#L83-L84) — אך **הטופס לא כולל אותם**; מצב `qualify` מוגדר ב-DB/backend, לא ב-UI הזה.

**כמה זמן להפעיל מאפס:** הדלקת master + channel + בחירת מצב + שמירה = **פחות מדקה** — אך מותנה בכך שוואטסאפ כבר מחובר (§8), ובגישת admin.

---

## 8. החיבור הראשוני של מספר וואטסאפ עסקי

זרימת Embedded Signup, שלושה מצבי UI ([WhatsappConnect.tsx](../components/settings/WhatsappConnect.tsx)):

1. **מצב A (לא מחובר)** — כפתור **"חבר וואטסאפ עסקי"** → `useEmbeddedSignup.launch` (Meta FB SDK) [WhatsappConnect.tsx:164-179](../components/settings/WhatsappConnect.tsx#L164-L179). תיאור: **"חבר את מספר הוואטסאפ העסקי שלך כדי לקבל לידים אוטומטית."** [:170](../components/settings/WhatsappConnect.tsx#L170).
2. **חילופי OAuth** — `code`+`wabaId`+`phoneNumberId` → `POST /api/whatsapp/embedded-signup` [embedded-signup/route.ts:25](../app/api/whatsapp/embedded-signup/route.ts#L25). בשרת, **בסדר**: חובה `wabaId` (אחרת לעולם לא יגיעו לידים) [:43-45](../app/api/whatsapp/embedded-signup/route.ts#L43-L45) → החלפת code ב-token [:50-64](../app/api/whatsapp/embedded-signup/route.ts#L50-L64) → מניעת חטיפה חוצת-דיירים [:66-76](../app/api/whatsapp/embedded-signup/route.ts#L66-L76) → **מנוי האפליקציה ל-WABA (`subscribed_apps`) — חייב להצליח לפני שמירה** [:78-93](../app/api/whatsapp/embedded-signup/route.ts#L78-L93) → שמירת `whatsapp_connections` [:97-117](../app/api/whatsapp/embedded-signup/route.ts#L97-L117) → `ensureMessagingReady` (רישום המספר עם PIN) [:119-137](../app/api/whatsapp/embedded-signup/route.ts#L119-L137), [registration.ts:90-109](../lib/whatsapp/registration.ts#L90-L109).
3. **מצב B (יותר ממספר אחד)** — **"בחר את מספר הטלפון שברצונך לחבר"** → `/api/auth/whatsapp/connect` [WhatsappConnect.tsx:128-162](../components/settings/WhatsappConnect.tsx#L128-L162).
4. **מצב C (מחובר)** — סטטוס **אמיתי** נפתר ב-`resolveWhatsappStatus`: `operational` / `not_ready` / `needs_verification` [operationalStatus.ts:32-53](../lib/whatsapp/operationalStatus.ts#L32-L53). רק `operational` מציג **"החיבור תקין — לידים מגיעים אוטומטית"** [WhatsappConnect.tsx:87](../components/settings/WhatsappConnect.tsx#L87); היתר מציגים נוטיס פעולה [:89-103](../components/settings/WhatsappConnect.tsx#L89-L103). קיום שורת חיבור **אינו** "תקין" — ההוכחה היא inbound אמיתי או מנוי-חי + מספר-מוכן [operationalStatus.ts:9-23](../lib/whatsapp/operationalStatus.ts#L9-L23).

**כמה זמן:** צד-האפליקציה (token + מנוי + שמירה) הוא בקשה אחת; משך התהליך נשלט ע"י Meta (אימות עסק/רישום מספר). המוצר **דסקטופ בלבד** ומצבי-כשל בחיבור שכיחים (ראה carousel §7, §11). **"מספר מזוהה: {phoneNumberId}"** מוצג לאחר חיבור [WhatsappConnect.tsx:104-106](../components/settings/WhatsappConnect.tsx#L104-L106).

---

## 9. מה כבוי כברירת מחדל אצל לקוח חדש

| מנגנון | ברירת מחדל | איך זה חוסם | מקור |
|---|---|---|---|
| `agencies.autoResponseEnabled` | `false` | שער SQL לא מזין jobs | [autoResponseSettings.ts:64](../db/autoResponseSettings.ts#L64), [autoResponseJobs.ts:49](../db/autoResponseJobs.ts#L49) |
| `auto_response_settings.enabled` | `false` | `channel_off` | [page:20](../app/(app)/settings/(admin_settings)/auto-response/page.tsx#L20), [eligibility.ts:23](../lib/inbox/autoresponse/eligibility.ts#L23) |
| `mode` | `acknowledge` | `qualify` הוא opt-in, מוגדר ב-DB בלבד | [autoResponseSettings.ts:82](../db/autoResponseSettings.ts#L82) |
| `draft` (qualify) | `false` | אם `true` — לעולם לא שולח, רק רושם לביקורת | [qualifyWorker.ts:371-416](../lib/inbox/autoresponse/qualifyWorker.ts#L371-L416) |
| דגל תבניות `WHATSAPP_TEMPLATES_AGENCY_ALLOWLIST` | ריק → OFF בכל מקום | `isTemplatesEnabledForAgency=false` | [flag.ts:22-27](../lib/whatsapp/templates/flag.ts#L22-L27) |
| kill גלובלי `INBOX_QUALIFIER_KILL` | כבוי; `=1` עוצר qualify לכולם | `qualifier_killed` | [killSwitch.ts](../lib/inbox/autoresponse/killSwitch.ts) |
| cron `send-auto-responses` | **לא מתוזמן** ב-vercel.json (רק בעיטת webhook) | אין drain מתוזמן | [vercel.json](../vercel.json), [send-auto-responses/route.ts:7-12](../app/api/cron/send-auto-responses/route.ts#L7-L12) |
| runtime-qualification / warm-handoff / post-handoff | מאחורי דגל per-agency | תוספות ל-qualify בלבד | [qualifyWorker.ts:221](../lib/inbox/autoresponse/qualifyWorker.ts#L221),[:423](../lib/inbox/autoresponse/qualifyWorker.ts#L423),[:191](../lib/inbox/autoresponse/qualifyWorker.ts#L191) |

**מנופי כיבוי מיידיים per-agency (ללא redeploy):** `mode='acknowledge'`, `draft=true`, `enabled=false`, `autoResponseEnabled=false` [killSwitch.ts:1-9](../lib/inbox/autoresponse/killSwitch.ts#L1-L9). **מסקנה:** אצל לקוח חדש כל מנוע המענה **כבוי** עד שאדמין מדליק master+channel ושומר; התבניות כבויות עד opt-in ל-allowlist; ו-`qualify` דורש הגדרת DB מפורשת.

---

## 10. גיליון הצהרות

טבלה מבוססת-קוד בלבד. אמצע = מותר לומר (נכון מילה במילה). ימין = אסור לומר (לא נתמך בקוד).

| יכולת | ✅ מותר לומר | ⛔ אסור לומר |
|---|---|---|
| מענה אוטומטי | "אפשר להפעיל מענה ראשוני אוטומטי בוואטסאפ ללידים חדשים, תוך שניות" (§1) | "המערכת עונה על כל הודעה במקומך" — במצב `acknowledge` זה **מגע-ראשון חד-פעמי**, וכל outbound קודם חוסם [eligibility.ts:28](../lib/inbox/autoresponse/eligibility.ts#L28) |
| נציג אנושי גובר | "ברגע שנציג עונה, המענה האוטומטי נעצר" (§2) | "האוטומציה ממשיכה גם אחרי שהנציג נכנס" — `human_replied`/`humanTookOver` עוצרים [eligibility.ts:24](../lib/inbox/autoresponse/eligibility.ts#L24), [stateMachine.ts:38](../lib/inbox/autoresponse/stateMachine.ts#L38) |
| גבולות תוכן | "המענה לעולם לא נוקב במחיר, מועד או התחייבות" (§3) | "ה-AI נותן הצעת מחיר/סוגר פגישה בצ'אט" — נחסם דטרמיניסטית [validate.ts:11-43](../lib/inbox/autoresponse/validate.ts#L11-L43) |
| חלון 24ש' | "מחוץ ל-24ש' שולחים תבנית מאושרת; טקסט חופשי ייחסם ותוצג הודעה להתקשר" (§4) | "אפשר לשלוח כל הודעה בכל זמן" — Meta חוסמת, `window_expired` [whatsappErrorCopy.ts:18-19](../lib/inbox/whatsappErrorCopy.ts#L18-L19) |
| תבניות | "שולחים תבנית מאושרת לליד בודד, ידנית" (§5) | "שליחת תבניות בהמונים/מתוזמנת/אוטומטית" — ליד אחד, לא bulk/schedule/automation [sendTemplateToLead.ts:29-30](../actions/whatsapp/templates/sendTemplateToLead.ts#L29-L30) |
| אישור תבנית | "התבנית עוברת אישור של וואטסאפ לפני שאפשר לשלוח" (§5) | "התבנית מוכנה מיד" — נשמרת `pending` עד אישור Meta [statusCopy.ts:29-32](../lib/whatsapp/templates/statusCopy.ts#L29-L32) |
| מסירה | "רואים נשלח/נמסר/נכשל על כל הודעה" (§6) | "'נשלח' = הגיע ללקוח" — `sent` = Meta קיבלה בלבד [inboxMessages.ts:154](../db/inboxMessages.ts#L154) |
| מצב qualify | "אפשר להפעיל תשאול חכם רב-תורי שאוסף שם/צורך ומעביר לנציג" (§3) | "זה פעיל לכולם" — opt-in, ב-DB, מאחורי kill גלובלי [killSwitch.ts](../lib/inbox/autoresponse/killSwitch.ts) |
| תמחור תבניות | — | "המערכת מחשבת/מציגה עלות per-תבנית" — **לא קיים בקוד** (§5) |

---

## 11. בלוק JSON מסכם

```json
{
  "trigger": {
    "primary": "whatsapp_inbound_webhook_after_kick",
    "path": "app/api/webhooks/whatsapp/route.ts:163-176",
    "backstop_cron": "send-auto-responses (NOT scheduled in vercel.json)",
    "signature": "hmac_sha256_x-hub-signature-256",
    "always_returns_200_to_meta": true
  },
  "eligibility_rules": {
    "engine": "decideEligibility (acknowledge) / decidePreGeneration (qualify)",
    "acknowledge_order": ["lead_terminal","feature_off","channel_off","human_replied","quiet_hours","daily_cap","already_first_contact","already_responded"],
    "first_contact_only": true,
    "human_wins": true,
    "quiet_hours_tz_default": "Asia/Jerusalem",
    "daily_cap_basis": "auto_response_jobs.status=sent per agency per day",
    "source": "lib/inbox/autoresponse/eligibility.ts, stateMachine.ts"
  },
  "modes": {
    "fixed": { "author": "business_static", "validator": false, "vars": ["{{firstName}}"] },
    "ai": { "author": "model_runStructured", "validator": "validateAutoResponse", "shape": "1-3 sentences, exactly 1 question, <=320 chars, no forbidden", "on_reject": "regenerate_once_then_skip_never_send" },
    "qualify": { "author": "model_multi_turn", "opt_in": true, "on_safety_reject": "forced_handoff_never_send", "on_shape_reject": "deterministic_next_field_question", "escalate_reasons": ["hot_signal","uncertain","qualified","max_turns","guardrail","human_request"] }
  },
  "window_24h": {
    "free_text_precheck": "none (acknowledge); qualify checks withinWindow < 24h",
    "meta_error_codes": { "window_expired": [470,131047,131051], "recipient": [131026,131052], "account": [131031,131042,131049,141006] },
    "user_text": "ההודעה לא נשלחה — עברו יותר מ־24 שעות מאז שהליד כתב. אפשר להתקשר אליו.",
    "escape_hatch": "approved_template_delivers_after_window",
    "source": "lib/inbox/whatsappErrorCopy.ts, lib/whatsapp/sendTemplateMessage.ts:12-14"
  },
  "templates": {
    "send": "sendTemplateToLead (agent action, one lead, manual, flag-gated, approved-only)",
    "sync": ["webhook message_template_status_update", "cron whatsapp-template-sync (0 */6 * * *)"],
    "never_sends_on_sync": true,
    "statuses": { "pending": "בבדיקת וואטסאפ", "approved": "מוכנה לשליחה", "rejected": "נדחתה", "paused": "מושהית", "disabled": "לא פעילה" },
    "closed_variable_set": ["שם הליד->leadFirstName", "שם העסק->businessName"],
    "pricing_logic": "not_in_code"
  },
  "message_statuses": {
    "enum": ["received","sent","delivered","read","failed"],
    "inbound_initial": "received",
    "outbound_initial": "sent",
    "sent_means": "meta_accepted_not_arrived",
    "ladder": "sent->delivered->read/failed (monotonic, SQL-guarded)",
    "failure_text_resolved": "server_side_hebrew_only",
    "source": "db/inboxMessages.ts, lib/inbox/ingestWhatsappStatuses.ts"
  },
  "settings_fields": {
    "path": "/settings/auto-response (admin only)",
    "fields": ["master","channel_whatsapp","replyMode(ai|fixed)","guidance","fixedBody","delaySeconds(0-3600)","dailyCap"],
    "defaults": { "master": false, "channelEnabled": false, "replyMode": "ai", "delaySeconds": 0, "dailyCap": 200, "guidance": null },
    "not_exposed_in_ui": ["mode(qualify)","maxTurns","collectFields","draft"],
    "time_to_enable": "under_1_minute_if_whatsapp_connected"
  },
  "setup_steps": [
    "click 'חבר וואטסאפ עסקי' (embedded signup / Meta SDK)",
    "POST /api/whatsapp/embedded-signup: require wabaId -> exchange token -> cross-tenant guard -> subscribe app to WABA (must succeed) -> persist connection -> ensureMessagingReady(register+PIN)",
    "if multiple phones: select number -> /api/auth/whatsapp/connect",
    "state C: resolveWhatsappStatus -> operational|not_ready|needs_verification"
  ],
  "default_off": {
    "agencies.autoResponseEnabled": false,
    "auto_response_settings.enabled": false,
    "mode": "acknowledge",
    "whatsapp_templates_allowlist": "empty_off_everywhere",
    "qualifier_global_kill_env": "INBOX_QUALIFIER_KILL",
    "send_auto_responses_cron": "not_scheduled",
    "instant_per_agency_levers": ["mode=acknowledge","draft=true","enabled=false","autoResponseEnabled=false"]
  },
  "safe_claims": [
    "מענה ראשוני אוטומטי בוואטסאפ ללידים חדשים, תוך שניות",
    "ברגע שנציג עונה — האוטומציה נעצרת",
    "המענה לעולם לא נוקב מחיר/מועד/התחייבות (ולידטור דטרמיניסטי)",
    "מחוץ ל-24ש' שולחים תבנית מאושרת; אחרת מוצגת הודעה להתקשר",
    "שליחת תבנית מאושרת לליד בודד, ידנית, אחרי אישור וואטסאפ",
    "מצב תשאול חכם רב-תורי אופציונלי שאוסף שם/צורך ומעביר לנציג"
  ],
  "unsafe_claims": [
    "המערכת עונה על כל הודעה במקומך (זה מגע-ראשון חד-פעמי)",
    "אפשר לשלוח כל הודעה בכל זמן (חלון 24ש')",
    "'נשלח' = הגיע ללקוח",
    "שליחת תבניות בהמונים/מתוזמנת/אוטומטית",
    "מצב qualify פעיל לכולם כברירת מחדל",
    "המערכת מציגה עלות per-תבנית"
  ]
}
```

---

### נספח — סתירות / דגלים אדומים שסומנו

1. **`send-auto-responses` אינו cron.** למרות שהוא route שנראה כמו קרון, הוא **לא** ב-vercel.json; המסלול הראשי הוא בעיטת ה-`after()` בwebhook, והroute רק גיבוי ידני [send-auto-responses/route.ts:7-12](../app/api/cron/send-auto-responses/route.ts#L7-L12), [vercel.json](../vercel.json).
2. **`acknowledge` = מגע-ראשון בלבד.** לא "עונה על הכול" — כל outbound קודם (גם אוטומטי) חוסם [eligibility.ts:27-28](../lib/inbox/autoresponse/eligibility.ts#L27-L28).
3. **`qualify` מוסתר מה-UI.** הטופס חושף רק `ai`/`fixed`; `qualify`+`collectFields`+`draft` מוגדרים ב-DB/backend בלבד [AutoResponseSettingsForm.tsx:91-118](../components/settings/autoResponse/AutoResponseSettingsForm.tsx#L91-L118).
4. **`sent` ≠ נמסר.** סטטוס `sent` פירושו Meta קיבלה; המסירה בפועל מגיעה מ-webhook נפרד [inboxMessages.ts:154](../db/inboxMessages.ts#L154).
5. **חלון 24ש' לא נבדק מראש ב-`acknowledge`** — רק Meta חוסמת בדיעבד; רק `qualify` בודק `withinWindow` לפני קריאת AI [stateMachine.ts:47](../lib/inbox/autoresponse/stateMachine.ts#L47).
6. **"תקין" ≠ קיום שורת חיבור.** סטטוס אמיתי דורש הוכחת inbound או מנוי-חי + מספר-מוכן; אחרת `needs_verification` [operationalStatus.ts:9-23](../lib/whatsapp/operationalStatus.ts#L9-L23).
