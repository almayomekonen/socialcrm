# ai-layer.md — מיפוי שכבת ה-AI והאוטומציות ב-SocialCRM

> מסמך המשך ל-[carousel-brief.md](./carousel-brief.md). לא חוזר על מה שכבר שם.
> **כל טענה מגובה בנתיב קובץ ומספר שורה.** מה שלא קיים בקוד מסומן "לא קיים בקוד".
> מבוסס על קוד שרץ בלבד — לא README ולא שיווק. אין נתונים אישיים.

**מקרא:** ✅ חי · 🟡 חלקי/מאחורי דגל · ⛔ לא קיים בקוד

---

## 1. ספקי AI

**SDK:** Vercel AI SDK (`ai`) עם שלושה providers ([lib/ai/providers.ts:1-4](../lib/ai/providers.ts#L1-L4)):
`@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`. **לא נמצאו** בקוד: langchain, groq, huggingface, ואין `fetch` ישיר לכתובות ספקי מודלים — הכול עובר דרך ה-SDK.

**ארבעה תפקידי מודל** ([lib/ai/providers.ts:39-72](../lib/ai/providers.ts#L39-L72)), מודל ברירת-מחדל ב-[lib/ai/env.ts:57-75](../lib/ai/env.ts#L57-L75):

| תפקיד | ספק | מודל ברירת-מחדל | env var למודל |
|---|---|---|---|
| `primary` | Anthropic | **`claude-sonnet-4-6`** | `ANTHROPIC_MODEL` ([env.ts:60](../lib/ai/env.ts#L60)) |
| `heavy` | Anthropic | **`claude-opus-4-7`** | `ANTHROPIC_HEAVY_MODEL` ([env.ts:61](../lib/ai/env.ts#L61)) |
| `volume` | Google | **`gemini-2.5-flash-lite`** | `GOOGLE_AI_MODEL` ([env.ts:67](../lib/ai/env.ts#L67)) |
| `fallback` | OpenAI | **`gpt-4.1-mini`** | `OPENAI_MODEL` ([env.ts:73](../lib/ai/env.ts#L73)) |

**שרשרת fallback:** primary→volume→fallback (Anthropic→Google→OpenAI) ([providers.ts:74-86](../lib/ai/providers.ts#L74-L86)).
**מפתחות API (env):** `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY` ([env.ts:40-42](../lib/ai/env.ts#L40-L42)). ספק שאין לו מפתח = `null` ומדולג.
**גייטים גלובליים:** `AI_ENABLED` ([env.ts:32](../lib/ai/env.ts#L32)) + תקרת הוצאה יומית `AI_DAILY_USD_CAP` (ברירת-מחדל 20$) ([env.ts:37-38](../lib/ai/env.ts#L37-L38)). **כל הקריאות עוברות דרך `runStructured`/`router`** שאוכף allowlist + תקרת עלות ([lib/ai/router.ts](../lib/ai/router.ts)).
**רישום עלויות למודל:** [lib/ai/tasks.ts](../lib/ai/tasks.ts) (טבלת תמחור per model).

---

## 2. analyze-conversations (הקְרון החשוב ביותר)

**מסלול:** [app/api/cron/analyze-conversations/route.ts:24](../app/api/cron/analyze-conversations/route.ts#L24) → `runConversationAnalysisWorker` ([lib/inbox/intelligence/worker.ts:80](../lib/inbox/intelligence/worker.ts#L80)). אימות דרך `CRON_SECRET` ([route.ts:15-22](../app/api/cron/analyze-conversations/route.ts#L15-L22)), `maxDuration=60`.
**תזמון:** יומי 06:00 — `"0 6 * * *"` ([vercel.json](../vercel.json)). ⚠️ הערה בקוד ([worker.ts:57](../lib/inbox/intelligence/worker.ts#L57)) אומרת "runs every minute" — **מיושנת**; ה-cron בפועל יומי.

**מה הוא עושה, שלב אחר שלב** ([worker.ts:80-228](../lib/inbox/intelligence/worker.ts#L80-L228)):
1. משחרר jobs תקועים ([:88](../lib/inbox/intelligence/worker.ts#L88)), תופס עד **5 jobs** בכל ריצה (`DEFAULT_LIMIT=5`, [:58](../lib/inbox/intelligence/worker.ts#L58)) עם SKIP LOCKED.
2. אידמפוטנטיות: מדלג אם כבר יש ניתוח טרי באותה גרסה שמכסה את כל ההודעות ([:122-142](../lib/inbox/intelligence/worker.ts#L122-L142)).
3. **קריאת AI אחת מרוכבת** ([:153-162](../lib/inbox/intelligence/worker.ts#L153-L162)) שמחזירה: summary + intent + temperature + suggestedAction (עם רמות ביטחון).
4. שומר 4 שורות atomically + שורת run לעלות ([:198-223](../lib/inbox/intelligence/worker.ts#L198-L223)); מבטל cache ([:227](../lib/inbox/intelligence/worker.ts#L227)).

**קלט:** ההודעות האחרונות של השיחה + שם/סטטוס הליד + ערוץ ([conversationAnalysis.ts:127-157](../lib/ai/prompts/conversationAnalysis.ts#L127-L157)).
**פלט (סכמת Zod):** `summary` (10-400 תווים), `intent` ∈ {pricing, demo, signup, support, followup, information, other}, `temperature` ∈ {cold, warm, hot}, `suggestedAction` ∈ {send_quote, schedule_demo, follow_up, answer_question, close_lead, escalate_support, none}, `actionReason`, `actionMessage`, `sourceSequences`, `noveltyKind`, ורמות ביטחון ([conversationAnalysis.ts:22-67](../lib/ai/prompts/conversationAnalysis.ts#L22-L67)).
**⚠️ קריטי:** הפעולה היא **המלצה בלבד — שום דבר לא מתבצע, שום רשומת CRM לא משתנה, שום משימה לא נוצרת** ([conversationAnalysis.ts:9-12](../lib/ai/prompts/conversationAnalysis.ts#L9-L12), [worker.ts:40-41](../lib/inbox/intelligence/worker.ts#L40-L41)).

**נשמר ל:** טבלה `conversation_intelligence`, שורה לכל `kind` (summary/intent/temperature/action), `promptVersion=4` ([conversationAnalysis.ts:20](../lib/ai/prompts/conversationAnalysis.ts#L20)), עם עמודות `data(jsonb)`, `confidence`, `status`, `coveredSequence`, `modelProvider`, `modelId` ([worker.ts:230-281](../lib/inbox/intelligence/worker.ts#L230-L281)); עלויות/טוקנים ב-`conversation_intelligence_runs` ([worker.ts:201-223](../lib/inbox/intelligence/worker.ts#L201-L223)).

**האם מוצג בממשק:** ✅ **כן** — פאנל "ניתוח שיחה" ב-inbox: [modules/inbox/components/ConversationIntelligenceCard.tsx:46-133](../modules/inbox/components/ConversationIntelligenceCard.tsx#L46-L133), נטען ב-[app/(app)/inbox/page.tsx](../app/(app)/inbox/page.tsx). הרינדור **קורא רק נתונים שמורים — לעולם לא מריץ AI** ([ConversationIntelligenceCard.tsx:19-20](../modules/inbox/components/ConversationIntelligenceCard.tsx#L19-L20)), עם cache של 30ש' ([:33](../modules/inbox/components/ConversationIntelligenceCard.tsx#L33)).

### ה-SYSTEM prompt המלא (מילה במילה, [conversationAnalysis.ts:71-125](../lib/ai/prompts/conversationAnalysis.ts#L71-L125)):

```
אתה מנתח שיחה בין ליד (לקוח פוטנציאלי) לבין נציג, עבור מערכת CRM.
המטרה: שהנציג יבין את מצב השיחה תוך 5 שניות — מה קרה, מה הליד רוצה, וכמה הוא חם.

נתח אך ורק את מה שנאמר בפועל בהודעות. אסור להמציא, להשלים או לנחש.

summary — סיכום:
- 1-3 משפטים קצרים בעברית. בלי פתיחים ("בשיחה זו..."), ישר לעניין.
- כלול: מה הליד רוצה, מה סוכם או נשאל, ומה נקודת העצירה הנוכחית.
- אם הליד ממתין לתשובה מהנציג — ציין זאת.
- אם השיחה דלה — סכם בקצרה את מה שיש, בלי לנפח.

intent — הכוונה העיקרית של הליד (ערך אחד):
- pricing: שואל על מחיר, עלות, הצעת מחיר, תנאי תשלום.
- demo: מבקש הדגמה, פגישת התרשמות, לראות את המוצר/השירות.
- signup: רוצה להצטרף, לסגור, לרכוש, להתקדם לחתימה.
- support: בעיה או בקשת שירות בנושא קיים.
- followup: ממשיך או מתאם המשך לשיחה/סיכום קודם.
- information: שואל שאלות מידע כלליות על המוצר/השירות.
- other: שום דבר מהרשימה לא מתאים.
- אם יש כמה כוונות — בחר את המאוחרת/הדומיננטית בשיחה.

temperature — חום הליד (ערך אחד):
- hot: כוונת התקדמות ברורה — מבקש לסגור, דחיפות, שאלות תכל'ס על מחיר/תנאים.
- warm: מתעניין באופן פעיל ועונה לעניין, אבל בלי דחיפות או מחויבות.
- cold: עניין נמוך — תשובות קצרות וקרות, דחייה, חוסר מענה לפניות הנציג.

suggestedAction — הצעד הבא המומלץ לנציג (ערך אחד). זו המלצה בלבד, שום פעולה לא מתבצעת אוטומטית:
- send_quote: הליד ביקש מחיר או בשל לקבל הצעה — שלח הצעת מחיר.
- schedule_demo: הליד רוצה לראות את המוצר/השירות — קבע הדגמה או פגישה.
- follow_up: השיחה נעצרה או שהליד לא הגיב — שלח הודעת המשך.
- answer_question: יש שאלה פתוחה של הליד שטרם נענתה — ענה עליה.
- close_lead: הליד הביע נכונות ברורה להתקדם/לסגור — התקדם לסגירה.
- escalate_support: בעיית שירות שדורשת טיפול — העבר לגורם המטפל.
- none: אין צעד מועיל כרגע (למשל: הליד ביקש להפסיק קשר, או שהנציג כבר ענה ואין מה להוסיף).
- בחר את הצעד בעל הערך הגבוה ביותר לנציג עכשיו. אחד בלבד.

actionReason — שורה אחת (עד 140 תווים) בעברית: למה זה הצעד הנכון עכשיו. נמק מתוך השיחה עצמה, לא תיאור כללי של הפעולה.

actionMessage — משפט החלטה אחד (עד 140 תווים), בלשון נציג, ציווי שמתחיל בפועל ("תחזור", "אל תוריד", "שלח"). לא תיאור ולא שאלה רטורית. זו המלצה בלבד — שום דבר לא מתבצע אוטומטית.

sourceSequences — מספרי ה-[#מספר] של ההודעות שעליהן מבוססת ההמלצה. חובה כשההמלצה נשענת על תוכן (גם פרשנות כמו "הוא משווה, לא מתמקח" חייבת לצטט את ההודעות שמהן זה עולה). אם אין בסיס בהודעה ספציפית — החזר רשימה ריקה.

noveltyKind — למה זה שווה הצגה. בחר אחד:
- attention: מפנה את הנציג למשהו שלא שם לב אליו (שאלה שנקברה, חסם אחר מכפי שחשב).
- interpretation: משנה את המשמעות שהנציג מייחס למצב ("משווה אלטרנטיבות, לא מתמקח"; "נתקע אחרי ההצעה, לא אחרי המחיר").
- action: ממליץ על מהלך לא-ברירת-מחדל, כולל מה לא לעשות ("אל תוריד עדיין מחיר").
- none: ההמלצה רק חוזרת על מצב גלוי וידוע (ממתין לתשובה, עברו כמה ימים, הכדור אצלך). אם זה המצב — החזר none.
העדף שתיקה על פני המובן מאליו: אם אין מהלך לא-מובן-מאליו ומבוסס-הודעה, החזר noveltyKind=none ו-actionMessage ריק.

confidence (לכוונה, לחום ולהמלצה): low אם ההודעות דלות או דו-משמעיות; medium ברירת מחדל; high רק כשיש בסיס מובהק.

כללים:
- אסור להזכיר שהניתוח נוצר על ידי AI.
- אסור ז'רגון ביטוחי (סוכן, פוליסה). השפה: ליד, נציג.
- אסור להחזיר שמות שדות פנימיים או טקסט באנגלית בסיכום אלא אם הופיע בהודעות עצמן.
```

### ה-USER prompt (נבנה ב-`buildConversationAnalysisUserMessage`, [conversationAnalysis.ts:137-157](../lib/ai/prompts/conversationAnalysis.ts#L137-L157)):

```
ערוץ: {וואטסאפ}
שם הליד: {שם}
סטטוס הליד במערכת: {סטטוס}

ההודעות האחרונות בשיחה (מהישנה לחדשה):
[#{sequence}] ליד: {טקסט ההודעה}
[#{sequence}] נציג: {טקסט ההודעה}
...

החזר אובייקט לפי הסכמה: summary, intent, intentConfidence, temperature, temperatureConfidence, suggestedAction, actionConfidence, actionReason, actionMessage, sourceSequences, noveltyKind.
```

---

## 3. auto_response (מנוע מענה אוטומטי — "IRE")

**מה מפעיל:** הודעת וואטסאפ נכנסת → ה-webhook מריץ inline `runAutoResponseWorker({limit:5})` ([app/api/webhooks/whatsapp/route.ts:170](../app/api/webhooks/whatsapp/route.ts#L170)). קיים גם route `send-auto-responses` ([app/api/cron/send-auto-responses/route.ts](../app/api/cron/send-auto-responses/route.ts)) — **אך אינו מתוזמן ב-vercel.json** (רק 3 crons שם).
**זכאות (מענה למגע ראשון בלבד):** נשלח רק אם המנוע פעיל ברמת הסוכנות + הערוץ, אין outbound קודם, אין תשובת אדם קודמת, אין מגע-ראשון-אוטומטי קודם, לא בשעות שקט, ומתחת ל-daily cap ([worker.ts:98-108](../lib/inbox/autoresponse/worker.ts#L98-L108)). מדלג אם הליד סופי (closed/lost) ([:61](../lib/inbox/autoresponse/worker.ts#L61)).
**ערוץ:** WhatsApp בלבד — שולח דרך `sendWhatsappText` ([worker.ts:143-149](../lib/inbox/autoresponse/worker.ts#L143-L149)); שומר outbound עם `metadata.source='auto_response'` ([:174](../lib/inbox/autoresponse/worker.ts#L174)).

**מודל מול תבנית — ההבחנה הקריטית — שלושה מצבים** ([worker.ts:110-133](../lib/inbox/autoresponse/worker.ts#L110-L133), מצב `qualify` ב-[:65-86](../lib/inbox/autoresponse/worker.ts#L65-L86)):

| מצב (`replyMode`/`mode`) | מודל או תבנית? | מקור |
|---|---|---|
| `fixed` | **תבנית קבועה** — `fixedBody` של הסוכנות עם החלפת `{שם}` בלבד | `renderFixedReply` ([worker.ts:113-120](../lib/inbox/autoresponse/worker.ts#L113-L120)) |
| `ai` (ברירת מחדל) | **נוצר ע"י מודל** — ברכה + אישור + שאלת הבהרה אחת | `generateAcknowledgement` ([lib/inbox/autoresponse/generate.ts:39-59](../lib/inbox/autoresponse/generate.ts#L39-L59)) |
| `qualify` (opt-in) | **נוצר ע"י מודל** — תור תיאום/כישור | `generateQualifyTurn` ([worker.ts:65-86](../lib/inbox/autoresponse/worker.ts#L65-L86)) |

**מענה אוטומטי לליד חדש:** ✅ קיים — זה בדיוק ה-IRE (מגע ראשון). **אין טקסט קשיח יחיד** — במצב `ai` המודל מחבר אותו; במצב `fixed` זו ההודעה שהסוכנות הגדירה. ה-SYSTEM prompt של המצב ה-AI ([generate.ts:20-27](../lib/inbox/autoresponse/generate.ts#L20-L27)):

```
אתה כותב הודעת פתיחה קצרה בשם העסק לליד חדש שכתב בוואטסאפ.
ההודעה חייבת: לברך, לאשר שקיבלנו את הפנייה, ולשאול שאלת הבהרה אחת פשוטה.
אורך: בדיוק 1 עד 3 משפטים. שאלה אחת בלבד.
אסור בתכלית האיסור: לנקוב במחיר, בעלות, בהנחה, בזמינות, במועד, בתור או בפגישה; להבטיח או להתחייב לכל דבר; להמציא עובדה כלשהי על העסק.
אם חסר לך מידע — שאל, אל תמציא. אל תכתוב מספרים.
כתוב בעברית, בגוף ראשון רבים, בנימה מקצועית וחמה. החזר אך ורק את ההודעה בשדה message.
```
(הפלט עובר גם ולידטור דטרמיניסטי לפני שליחה — [generate.ts:6-7](../lib/inbox/autoresponse/generate.ts#L6-L7), `validate.ts`.)

**תבניות WhatsApp (`whatsapp-template-sync`):** ה-cron ([app/api/cron/whatsapp-template-sync/route.ts](../app/api/cron/whatsapp-template-sync/route.ts), כל 6ש') **מסנכרן סטטוס תבניות מ-Meta WABA** לטבלה `whatsapp_templates` ([lib/whatsapp/templates/ingestStatus.ts](../lib/whatsapp/templates/ingestStatus.ts)) — הוא לא שולח כלום. תבניות **נשלחות** ידנית/יזום דרך [actions/whatsapp/templates/sendTemplateToLead.ts](../actions/whatsapp/templates/sendTemplateToLead.ts). התבניות עצמן הן **תבניות מאושרות קבועות של Meta — לא תוכן שנוצר ע"י AI**.

**סטטוס:** 🟡 מאחורי דגל per-agency (`autoResponseEnabled` + הגדרות ערוץ, [worker.ts:51-53](../lib/inbox/autoresponse/worker.ts#L51-L53)); מצב `qualify` הוא opt-in.

---

## 4. recovery_alerts

⛔ **הטבלה קיימת אך אין לה שום קוד אפליקטיבי.** מיגרציה [migrations/20260623000001_create_recovery_alerts.cjs](../migrations/20260623000001_create_recovery_alerts.cjs) יוצרת אותה, אך חיפוש בכל הריפו (למעט node_modules/migrations) על `recovery_alerts`/`recoveryAlert`/`RecoveryAlert` מחזיר **אפס תוצאות בקוד רץ** (ההתאמה היחידה היא המסמך [carousel-brief.md](./carousel-brief.md) עצמו).
- מה מייצר התראה: **לא קיים בקוד.**
- הקריטריון: **לא קיים בקוד.**
- מה המשתמש רואה: **כלום — אין קורא/כותב.**
- מודל או חוקים: **לא רלוונטי — אין לוגיקה.**

זהו טבלת-שלד/שמורה. אין "מנגנון התראות שחזור" חי.

---

## 5. סיכומים והצעות פעולה

| יכולת | קיים? | פלט | איפה מוצג |
|---|---|---|---|
| **סיכום ליד** ("תקציר חכם") | ✅ | `summary`, `keyInsights[]`, `suggestedNextAction{title,reason}`, `sources[]`, `confidence` | כרטיס [components/ai/LeadIntelligenceCard.tsx:52-98](../components/ai/LeadIntelligenceCard.tsx#L52-L98) ב-inbox; מקור `getLeadIntelligence` ([actions/ai/leadIntelligence.ts](../actions/ai/leadIntelligence.ts)) |
| **סיכום שיחה** | ✅ | `summary` (שדה מתוך conversation_intelligence) | כרטיס "ניתוח שיחה" [ConversationIntelligenceCard.tsx:104-108](../modules/inbox/components/ConversationIntelligenceCard.tsx#L104-L108) |
| **הצעת צעד הבא** | ✅ | חלק מ-`suggestedNextAction` (סיכום ליד) + `suggestedAction` (ניתוח שיחה) + [actions/ai/leadNextStep.ts](../actions/ai/leadNextStep.ts) | "פעולה מומלצת" / "הצעד הבא המומלץ" |
| **ניסוח תשובה (טיוטה)** | ✅ | טיוטת הודעת וואטסאפ | כפתור "AI" ב-[components/summary/WhatsappReplyDraft.tsx:54-61](../components/summary/WhatsappReplyDraft.tsx#L54-L61); מקור `generateWhatsappReplyDraft` ([actions/ai/whatsappReplyDraft.ts](../actions/ai/whatsappReplyDraft.ts)) |
| **שאלה על ליד** | ✅ (מאחורי דגל Copilot) | תשובה חופשית לשאלת הנציג | Copilot Lead Mode ([actions/ai/leadAskQuestion.ts](../actions/ai/leadAskQuestion.ts)) |
| **בריף יומי** | ✅ (מאחורי דגל) | סיכום יומי | [actions/ai/getDailyBriefing.ts](../actions/ai/getDailyBriefing.ts) |
| **ניקוד ליד מספרי (score)** | ⛔ | אין ציון מספרי | — |
| **"חום ליד" (temperature)** | ✅ | `cold`/`warm`/`hot` — ברמת השיחה בלבד | badge בכרטיס "ניתוח שיחה" ([ConversationIntelligenceCard.tsx:89-95](../modules/inbox/components/ConversationIntelligenceCard.tsx#L89-L95)) |

**חשוב:** "ניקוד ליד" מספרי **לא קיים בקוד**. הקרוב ביותר הוא `temperature` (קר/חמים/חם) של שיחה, לא ציון מספרי ולא ניקוד ברמת הליד.

---

## 6. ה-inbox

- **מה זורם פנימה:** הודעת וואטסאפ נכנסת → ה-webhook ([app/api/webhooks/whatsapp/route.ts](../app/api/webhooks/whatsapp/route.ts)) שומר ל-`inbox_conversations` + `inbox_messages`, יוצר ליד אם חדש (§carousel-brief §2), ומריץ inline את מנוע המענה האוטומטי ([:170](../app/api/webhooks/whatsapp/route.ts#L170)).
- **סנכרון בזמן אמת:** דחיפה מבוססת-webhook (נכנס) + **polling בצד לקוח** (לא websockets) — [components/summary/ConversationRefreshPoller.tsx](../components/summary/ConversationRefreshPoller.tsx), visibility-gated.
- **עיבוד AI על השיחות:** ✅ שלושה: (1) **Conversation Intelligence** (summary/intent/temperature/action) דרך ה-cron היומי (§2); (2) **מענה אוטומטי** (§3); (3) **מצב qualify** (§3, opt-in). כל אלה WhatsApp בלבד (`CHANNEL_LABELS` כולל רק `whatsapp`, [conversationAnalysis.ts:135](../lib/ai/prompts/conversationAnalysis.ts#L135)).
- כרטיס ה-CI ב-inbox קורא **רק נתונים שמורים** — לא מריץ AI בזמן רינדור ([ConversationIntelligenceCard.tsx:19-20](../modules/inbox/components/ConversationIntelligenceCard.tsx#L19-L20)).

---

## 7. מיקרו קופי של ה-AI (ציטוט מדויק)

**כרטיס תקציר ליד** ([LeadIntelligenceCard.tsx](../components/ai/LeadIntelligenceCard.tsx)):
- כותרת: **"תקציר חכם"** ([:41](../components/ai/LeadIntelligenceCard.tsx#L41),[:62](../components/ai/LeadIntelligenceCard.tsx#L62))
- **"פעולה מומלצת"** ([:85](../components/ai/LeadIntelligenceCard.tsx#L85))
- **"מבוסס על: {מקורות}"** ([:92](../components/ai/LeadIntelligenceCard.tsx#L92))
- ביטחון: **"ביטחון גבוה" / "ביטחון בינוני" / "ביטחון נמוך"** ([:102](../components/ai/LeadIntelligenceCard.tsx#L102))
- שגיאה: **"העוזר החכם לא זמין כרגע — נסה שוב בעוד דקה."** ([:46](../components/ai/LeadIntelligenceCard.tsx#L46))

**כרטיס ניתוח שיחה** ([ConversationIntelligenceCard.tsx](../modules/inbox/components/ConversationIntelligenceCard.tsx)):
- כותרת: **"ניתוח שיחה"** ([:76](../modules/inbox/components/ConversationIntelligenceCard.tsx#L76))
- טעינה: **"מנתח את השיחה…"** ([:81](../modules/inbox/components/ConversationIntelligenceCard.tsx#L81))
- כשל: **"ניתוח השיחה נכשל. ננסה שוב אוטומטית כשתתקבל הודעה חדשה."** ([:84](../modules/inbox/components/ConversationIntelligenceCard.tsx#L84))
- ריק: **"אין סיכום זמין."** ([:107](../modules/inbox/components/ConversationIntelligenceCard.tsx#L107))
- **"הצעד הבא המומלץ: {פעולה}"** ([:115](../modules/inbox/components/ConversationIntelligenceCard.tsx#L115))
- תגי מצב: **"מעודכן" / "מתעדכן" / "נכשל" / "בתהליך"** ([:143-146](../modules/inbox/components/ConversationIntelligenceCard.tsx#L143-L146))
- **"הודעות חדשות התקבלו — הניתוח מתעדכן ·"** ([:126](../modules/inbox/components/ConversationIntelligenceCard.tsx#L126)); **"נותח לאחרונה {תאריך}"** ([:127](../modules/inbox/components/ConversationIntelligenceCard.tsx#L127))

**ניסוח טיוטה** ([WhatsappReplyDraft.tsx](../components/summary/WhatsappReplyDraft.tsx)):
- כפתור: **"AI"** / בזמן ריצה **"מנסח..."** ([:141](../components/summary/WhatsappReplyDraft.tsx#L141)); title **"נסח טיוטה עם AI"** ([:137](../components/summary/WhatsappReplyDraft.tsx#L137))
- placeholder: **"כתוב טיוטה לתשובה..."** ([:126](../components/summary/WhatsappReplyDraft.tsx#L126))
- שגיאה: **"לא ניתן היה לנסח טיוטה כרגע. נסה שוב."** ([:59](../components/summary/WhatsappReplyDraft.tsx#L59))
- toast: **"הטיוטה הועתקה"** ([:65](../components/summary/WhatsappReplyDraft.tsx#L65)); **"ההודעה נשלחה — ממתין לאישור מסירה"** ([:80](../components/summary/WhatsappReplyDraft.tsx#L80))

**מצבי יצירה של ה-Copilot** ([ActiveGenerationRow.tsx:19-22](../components/copilot/ActiveGenerationRow.tsx#L19-L22)):
- Lead: **"מנתח את הקשר הליד" → "סוקר פעילות אחרונה" → "מגבש תשובה"**
- קבצים: **"קורא את הקובץ המצורף" → "מנתח את תוכן המסמך" → "מחלץ מידע מהקובץ" → "מגבש תשובה"**
- General Mode: **"בודק את הנתונים" → "סוקר את הפעילות" → "מגבש תשובה"**

---

## 8. מה מאחורי דגל

| פיצ'ר | גייט (env / הגדרה) | מקור |
|---|---|---|
| כלל שכבת ה-AI | `AI_ENABLED` + `AI_AGENCY_ALLOWLIST` | [env.ts:32](../lib/ai/env.ts#L32),[:54](../lib/ai/env.ts#L54) |
| תקרת הוצאה יומית | `AI_DAILY_USD_CAP` (ברירת מחדל 20$) | [env.ts:37-38](../lib/ai/env.ts#L37-L38) |
| Copilot | `AI_COPILOT_ENABLED` + `AI_COPILOT_AGENCY_ALLOWLIST` | [env.ts:33](../lib/ai/env.ts#L33),[:49](../lib/ai/env.ts#L49) |
| שמירת שיחות Copilot | `AI_COPILOT_PERSIST` | [env.ts:34](../lib/ai/env.ts#L34) |
| Copilot Inspector | `AI_COPILOT_INSPECTOR` | [env.ts:35](../lib/ai/env.ts#L35) |
| General Mode | `GENERAL_MODE_AGENCY_IDS` | [env.ts:50](../lib/ai/env.ts#L50) |
| Reasoned General | `REASONED_GENERAL_AGENCY_IDS` | [env.ts:51](../lib/ai/env.ts#L51) |
| Synthesis | `SYNTHESIS_AGENCY_IDS` | [env.ts:52](../lib/ai/env.ts#L52) |
| Runtime Cognition | `RUNTIME_COGNITION_AGENCY_IDS` | [env.ts:53](../lib/ai/env.ts#L53) |
| Shadow telemetry | `AI_SHADOW_TELEMETRY` (off/verbose) | [lib/entitlements/shadow.ts](../lib/entitlements/shadow.ts) |
| Shadow ingest | `SHADOW_INGEST_KILL` + allowlist (confidence 0.6) | [lib/ai/integration/shadowIngest.ts](../lib/ai/integration/shadowIngest.ts) |
| Operator Take | מצב תצפית (`selectRenderableTake` + `recordOperatorTakeEvent`) | [lib/inbox/intelligence/operatorTake.ts](../lib/inbox/intelligence/operatorTake.ts) |
| מענה אוטומטי / qualify | `autoResponseEnabled` per-agency + מצב `qualify` opt-in | [worker.ts:51-65](../lib/inbox/autoresponse/worker.ts#L51-L65) |
| **recovery_alerts** | ⛔ טבלה ללא קוד (§4) | — |

**מסקנה:** כמעט כל יכולת AI (Copilot, General/Reasoned/Synthesis/Runtime-Cognition, מענה אוטומטי, shadow, operator-take) חסומה מאחורי allowlist per-agency או דגל env; ברירת המחדל למשתמש רגיל היא כבוי. ה-Conversation Intelligence וכרטיס תקציר הליד מוצגים רק לסוכנות מורשית — אחרת מחזירים `null` ([LeadIntelligenceCard.tsx:33](../components/ai/LeadIntelligenceCard.tsx#L33)).

---

## 9. גיליון הצהרות שיווקיות

טבלה מבוססת-קוד בלבד. עמודה אמצעית = מותר לומר (נכון מילה במילה). עמודה ימנית = אסור לומר (לא נתמך בקוד).

| יכולת | ✅ מותר לומר (נכון בקוד) | ⛔ אסור לומר (לא נתמך) |
|---|---|---|
| ניתוח שיחה | "AI מסכם לך כל שיחת וואטסאפ ואומר מה הצעד הבא המומלץ" (§2) | "המערכת מבצעת בשבילך את הצעד הבא" — זו **המלצה בלבד, שום דבר לא מתבצע** ([conversationAnalysis.ts:9-12](../lib/ai/prompts/conversationAnalysis.ts#L9-L12)) |
| חום ליד | "כל שיחה מקבלת סימון חם/חמים/קר" (§2) | "ניקוד ליד חכם" — **אין ציון מספרי** (§5) |
| מענה אוטומטי | "אפשר להפעיל מענה ראשוני אוטומטי בוואטסאפ ללידים חדשים" (§3) | "המערכת עונה במקומך על כל הודעה" — רק **מגע ראשון**, ומדולג אם כבר ענה אדם ([worker.ts:88-108](../lib/inbox/autoresponse/worker.ts#L88-L108)) |
| מענה AI | "המענה האוטומטי מנוסח ע"י AI בעברית — ברכה ושאלת הבהרה" (§3) | "ה-AI נותן מחיר/סוגר עסקה בצ'אט" — **אסור לנקוב מחיר/להתחייב** ([generate.ts:24](../lib/inbox/autoresponse/generate.ts#L24)) |
| טיוטת תשובה | "כפתור AI מנסח לך טיוטת תשובה בוואטסאפ" (§5) | "המערכת שולחת את התשובה לבד" — הטיוטה **ידנית**: נציג מעתיק/שולח ([WhatsappReplyDraft.tsx:54-90](../components/summary/WhatsappReplyDraft.tsx#L54-L90)) |
| תקציר ליד | "תקציר חכם עם פעולה מומלצת לכל ליד" (§5,§7) | "ניתוח פסיכולוגי/חיזוי סגירה" — לא קיים |
| מקורות הליד | "AI מנתח לידים מוואטסאפ" (§6) | "AI מנתח גם אינסטגרם/פייסבוק DM" — הניתוח **WhatsApp בלבד** ([conversationAnalysis.ts:135](../lib/ai/prompts/conversationAnalysis.ts#L135)) |
| התראות שחזור | — | "המערכת מתריעה על ליד מתקרר/הזדמנות שנשמטת" — **recovery_alerts ללא קוד** (§4) |
| תזכורות | (ראה carousel-brief §6) | "התראה נדחפת שתזכיר לך" — אין push, רק תצוגה |
| מודלים | "מונע ע"י מודלים מובילים (Claude/Gemini/GPT)" (§1) | ציון מודל/גרסה ספציפי בשיווק — נשלט ע"י env ועשוי להשתנות ([env.ts:57-75](../lib/ai/env.ts#L57-L75)) |

---

## 10. בלוק JSON מסכם

```json
{
  "providers": ["anthropic", "google", "openai"],
  "sdk": "vercel-ai-sdk",
  "models": {
    "primary": "claude-sonnet-4-6",
    "heavy": "claude-opus-4-7",
    "volume": "gemini-2.5-flash-lite",
    "fallback": "gpt-4.1-mini",
    "source": "lib/ai/env.ts:57-75",
    "note": "env-overridable via ANTHROPIC_MODEL/ANTHROPIC_HEAVY_MODEL/GOOGLE_AI_MODEL/OPENAI_MODEL"
  },
  "ai_features_live": [
    "conversation_intelligence_summary",
    "conversation_intelligence_intent",
    "conversation_intelligence_temperature",
    "conversation_intelligence_suggested_action",
    "lead_intelligence_card",
    "whatsapp_reply_draft_manual"
  ],
  "ai_features_partial": [
    "auto_response_ai_mode",
    "auto_response_qualify_mode",
    "copilot_lead_mode",
    "general_mode",
    "daily_briefing",
    "operator_take_observation",
    "shadow_decisions"
  ],
  "ai_features_missing": [
    "numeric_lead_score",
    "recovery_alerts_logic",
    "instagram_or_facebook_dm_ai_analysis",
    "ai_autonomous_actions_on_crm"
  ],
  "automations_live": {
    "analyze_conversations_cron": { "schedule": "0 6 * * *", "effect": "recommendation_only", "channel": "whatsapp", "batch": 5 },
    "auto_response_ire": { "trigger": "whatsapp_inbound_webhook", "scope": "first_contact_only", "modes": ["fixed", "ai", "qualify"], "gated": "per_agency" },
    "whatsapp_template_sync_cron": { "schedule": "0 */6 * * *", "effect": "status_reconcile_only_no_send" },
    "email_automations_cron": { "schedule": "0 * * * *" }
  },
  "recovery_alerts": { "table_exists": true, "app_code": "none", "status": "dead_reserved" },
  "ui_strings_ai": {
    "lead_card_title": "תקציר חכם",
    "lead_card_action": "פעולה מומלצת",
    "lead_card_error": "העוזר החכם לא זמין כרגע — נסה שוב בעוד דקה.",
    "conv_card_title": "ניתוח שיחה",
    "conv_card_loading": "מנתח את השיחה…",
    "conv_card_failed": "ניתוח השיחה נכשל. ננסה שוב אוטומטית כשתתקבל הודעה חדשה.",
    "conv_next_action": "הצעד הבא המומלץ:",
    "reply_draft_button": "AI",
    "reply_draft_placeholder": "כתוב טיוטה לתשובה...",
    "reply_sent_toast": "ההודעה נשלחה — ממתין לאישור מסירה",
    "copilot_states_general": ["מנתח את הקשר הליד", "סוקר פעילות אחרונה", "מגבש תשובה"]
  },
  "safe_claims": [
    "AI מסכם כל שיחת וואטסאפ ומציע צעד הבא (המלצה בלבד)",
    "כל שיחה מסומנת חם/חמים/קר",
    "מענה ראשוני אוטומטי אופציונלי בוואטסאפ ללידים חדשים, מנוסח ע\"י AI",
    "כפתור AI מנסח טיוטת תשובה שהנציג שולח ידנית",
    "מונע ע\"י Claude/Gemini/GPT"
  ],
  "unsafe_claims": [
    "ה-AI מבצע פעולות/סוגר עסקאות לבד",
    "ניקוד ליד מספרי",
    "ניתוח AI לאינסטגרם/פייסבוק DM",
    "התראות שחזור על לידים מתקררים (recovery_alerts)",
    "ה-AI נוקב מחיר או שולח תשובה במקום הנציג",
    "התראה נדחפת לתזכורות"
  ]
}
```

---

### נספח — סתירות / דגלים אדומים שסומנו
1. **תזמון analyze-conversations:** הערה בקוד ([worker.ts:57](../lib/inbox/intelligence/worker.ts#L57)) אומרת "every minute" אך vercel.json קובע יומי 06:00. הנכון: **יומי**.
2. **recovery_alerts:** טבלה קיימת, אפס קוד — לא לבנות עליה שום הבטחה שיווקית.
3. **"פעולה מומלצת" ≠ פעולה אוטומטית:** כל הצעות ה-AI הן המלצות; המערכת read-only כלפי ה-CRM בשכבת ה-AI ([conversationAnalysis.ts:9-12](../lib/ai/prompts/conversationAnalysis.ts#L9-L12)).
4. **מענה אוטומטי הוא מגע-ראשון בלבד** ומאחורי דגל per-agency — לא "עונה על הכול".
