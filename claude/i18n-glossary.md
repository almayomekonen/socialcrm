# i18n-glossary.md — terminology (decision D1)

**Status: PROVISIONAL — owner decisions of 2026-10-28, pending native review.**
English is US B2B SaaS register; Arabic is Modern Standard Arabic with Latin
digits. Rows marked "provisional" are owner decisions awaiting native sign-off;
rows marked "proposed" have no owner decision yet.

| Native reviewer | Name |
| --- | --- |
| English | **TBD** |
| Arabic | **TBD** |

Sign-off is recorded per namespace in `lib/i18n/review.ts` only after a named
reviewer has read the export (`pnpm i18n:export <out.csv>`). Nothing is signed
off. Strings already live in the shell (Phase 1) are marked ●; changing them is
a catalog edit, not a code change.

## Owner decisions (provisional)

| # | Decision |
| --- | --- |
| D1.1 | Arabic for ליד: **عميل محتمل** (formal), plural **العملاء المحتملون**. |
| D1.2 | English for the lead status נסגר (`closed`): **Closed**. "Won" is used only for a status that is distinct from closing and explicitly means successful conversion; the lead model has no such status (statuses: `new`, `contacted`, `interested`, `closed`, `lost` — `closed` is the single closing state). |
| D1.3 | פולואפ and מעקב → **Follow-up** initially. Contexts where מעקב means something else are flagged below and must not be translated mechanically. |
| D1.4 | נציג → **Rep** in compact labels (nav items, column headers, role badges); **Representative** where a full word is needed for clarity (sentences, empty states, help text). |
| D1.5 | הסוכן שלך → **Your AI agent** (English). Arabic **وكيلك الذكي** stays pending native review. |

## Core entities

| Hebrew | English | Arabic | Status |
| --- | --- | --- | --- |
| ליד / לידים ● | Lead / Leads | عميل محتمل / العملاء المحتملون | provisional (D1.1) |
| לקוח / לקוחות (nav: closed leads) ● | Customer / Customers | عميل / العملاء | proposed. Product rule: a customer is a lead with status `closed`, never a separate entity. |
| נציג ● | Rep · Representative | مندوب | provisional (D1.4). Not "agent" (insurance meaning; clashes with the AI agent). |
| הסוכן שלך (AI) ● | Your AI agent | وكيلك الذكي | provisional (D1.5); Arabic pending review |
| מנהל המערכת ● | System admin | مدير النظام | proposed. Role `ADMIN` / `GM`. |
| מנהל צוות ● | Team manager | مدير الفريق | proposed. Role `MNGR`. |
| תפעול ● | Operations | العمليات | proposed. Role `OFFICE`. |
| שותף חיצוני ● | External partner | شريك خارجي | proposed. Role `EXT`. |
| עסק / פרטי העסק | Business / Business details | النشاط التجاري / بيانات النشاط التجاري | proposed. Not "agency" in UI copy. |
| צוות / צוותים | Team / Teams | فريق / الفرق | proposed |

## Work items

| Hebrew | English | Arabic | Status |
| --- | --- | --- | --- |
| היום ● | Today | اليوم | proposed |
| פולואפ / מעקב (follow-up activity) | Follow-up | متابعة | provisional (D1.3) — see flags below |
| משימה / משימות ● | Task / Tasks | مهمة / المهام | proposed |
| פגישה / פגישות ● | Meeting / Meetings | اجتماع / الاجتماعات | proposed |
| שיחה / שיחות ● | Conversation / Conversations | محادثة / المحادثات | proposed. Inbox threads. |
| הודעה | Message | رسالة | proposed |
| עסקה / עסקאות ● | Deal / Deals | صفقة / الصفقات | proposed |
| ביצועים ● | Performance | الأداء | proposed |
| אינטגרציות ● | Integrations | التكاملات | proposed |
| אוטומציה / אוטומציות ● | Automation / Automations | الأتمتة | proposed |
| מענה אוטומטי ● | Auto-reply | الرد التلقائي | proposed |
| שאלון | Questionnaire | استبيان | proposed |
| תבנית | Template | قالب | proposed |

## מעקב contexts that are NOT a follow-up (D1.3 flags)

Found by searching the product source on 2026-10-28. Translate by meaning, not by the word.

| Where | Hebrew | Meaning | Suggested English |
| --- | --- | --- | --- |
| `lib/i18n/messages/he/shell.ts` `shell.workspace.leadsSubtitle` ● | ניהול ומעקב לידים | general tracking | "Manage and track leads" (live today as "Manage and follow up on leads" — **owner to confirm the change**) |
| `lib/activation/firstRunCopy.ts`, `lib/product/capabilities.ts`, `components/ui/hero/HeroContent.tsx` | סטטוס ומעקב לכל ליד | tracking each lead | "status and tracking for every lead" |
| `components/mobile/moreDestinations.ts` (support) | פתיחת פנייה ומעקב | tracking a support request | "Open and track a request" |
| `lib/whatsapp/platform/readinessView.ts` | מזהה מעקב של Meta | Meta `fbtrace_id` (technical trace) | "Meta trace ID" |
| `components/tasks/TasksTable.tsx`, `components/tasks/addTaskForm/AddTaskForm.tsx` | מעקב / כותרת המעקב | a **task** (legacy name) | "Task" / "Task title" |
| `components/taskTmplts/*` | תת-מעקב / תבנית המעקב | a sub-**task** / task template | "Subtask" / "Task template" |
| `components/files/{FileForm,FilesTable,ClientFilesTable}.tsx` | מעקב (column bound to `taskId`) | linked **task** | "Task" |
| `lib/ai/followUpRules.ts` | המעקב נחלש | engagement momentum cooling | "Follow-up momentum is slowing" ⚠ reviewer |
| `lib/seo/schemas.ts` (marketing, out of scope) | מעקב אחר מכירות | sales tracking | — |

## Lead statuses (stored codes — labels only)

| Code | Hebrew (current UI) | English | Arabic | Status |
| --- | --- | --- | --- | --- |
| `new` | חדש | New | جديد | proposed |
| `contacted` | בטיפול | In progress | قيد المتابعة | proposed |
| `interested` | מתעניין | Interested | مهتم | proposed |
| `closed` | נסגר | Closed | مُغلق | provisional (D1.2) |
| `lost` | לא רלוונטי | Not relevant | غير ذي صلة | proposed |

## Deal statuses (stored as Hebrew in `sales.status` — display map only, values never change)

| Stored value | English | Arabic | Status |
| --- | --- | --- | --- |
| חדש | New | جديد | proposed |
| בהצעה | Proposal sent | تم إرسال العرض | proposed |
| במו"מ | Negotiating | قيد التفاوض | proposed |
| ממתין לתשלום | Awaiting payment | بانتظار الدفع | proposed |
| שולם | Paid | مدفوع | proposed |
| בוטל | Cancelled | ملغى | proposed |

## Deal branches (stored as Hebrew in `sales.branch` and as reporting keys — display map only)

| Stored value | English | Arabic | Status |
| --- | --- | --- | --- |
| משוקלל (report total) | Weighted total | الإجمالي المرجّح | proposed |
| שירותים | Services | خدمات | proposed |
| מוצרים | Products | منتجات | proposed |
| קורסים | Courses | دورات | proposed |
| מנויים | Subscriptions | اشتراكات | proposed |
| חבילות | Packages | باقات | proposed |
| ייעוץ | Consulting | استشارات | proposed |
| אחר | Other | أخرى | proposed |

## Never translated

Lead/contact names, phone numbers, emails, notes, message bodies, questionnaire
questions and answers, WhatsApp and automation template bodies, invoices and
quotes, Meta ad/campaign names, file names, business/agency data, AI-generated
text (decision D3: stays Hebrew), pre-login pages (decision D4: stay Hebrew).

## Open items

1. English and Arabic native reviewers: **TBD**.
2. Confirm `shell.workspace.leadsSubtitle` → "Manage and track leads" (tracking, not follow-up).
3. Arabic «وكيلك الذكي» for the AI agent (pending native review).
