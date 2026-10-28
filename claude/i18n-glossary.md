# i18n-glossary.md — PROPOSED terminology (decision D1)

**Status: PROPOSAL for owner review. Not approved.** No screen is translated
against this list until the owner approves it (Phase B starts after D1). English
is US B2B SaaS register; Arabic is Modern Standard Arabic with Latin digits.
Marked ⚠ where the choice is a judgement call the reviewer should confirm.

Already shipped in the shell (Phase 1) are marked ●; changing them later is a
catalog edit, not a code change.

## Core entities

| Hebrew | English | Arabic | Notes |
| --- | --- | --- | --- |
| ליד / לידים ● | Lead / Leads | عميل محتمل / العملاء المحتملون | ⚠ Arabic is long in tight UI; a shorter alternative is «ليد / ليدات» (used colloquially in MENA marketing). Reviewer to choose. |
| לקוח / לקוחות (nav: closed leads) ● | Customer / Customers | عميل / العملاء | Product rule: a customer is a lead with status `closed`, never a separate entity. |
| נציג ● | Rep | مندوب | Not "agent" (insurance meaning, and clashes with the AI agent). |
| הסוכן שלך (AI) ● | Your agent | وكيلك الذكي | ⚠ "agent" here is the AI assistant only. |
| מנהל המערכת ● | System admin | مدير النظام | Role `ADMIN` / `GM`. |
| מנהל צוות ● | Team manager | مدير الفريق | Role `MNGR`. |
| תפעול ● | Operations | العمليات | Role `OFFICE`. |
| שותף חיצוני ● | External partner | شريك خارجي | Role `EXT`. |
| עסק / פרטי העסק | Business / Business details | النشاط التجاري / بيانات النشاط التجاري | Not "agency" in UI copy. |
| צוות / צוותים | Team / Teams | فريق / الفرق | |

## Work items

| Hebrew | English | Arabic | Notes |
| --- | --- | --- | --- |
| היום ● | Today | اليوم | The daily briefing page. |
| פולואפ / מעקב | Follow-up | متابعة | ⚠ Hebrew UI uses both; one English term everywhere. |
| משימה / משימות ● | Task / Tasks | مهمة / المهام | |
| פגישה / פגישות ● | Meeting / Meetings | اجتماع / الاجتماعات | |
| שיחה / שיחות ● | Conversation / Conversations | محادثة / المحادثات | Inbox threads (WhatsApp, Messenger, comments). |
| הודעה | Message | رسالة | |
| עסקה / עסקאות ● | Deal / Deals | صفقة / الصفقات | |
| ביצועים ● | Performance | الأداء | |
| אינטגרציות ● | Integrations | التكاملات | |
| אוטומציה / אוטומציות ● | Automation / Automations | الأتمتة | |
| מענה אוטומטי ● | Auto-reply | الرد التلقائي | |
| שאלון | Questionnaire | استبيان | |
| תבנית | Template | قالب | |

## Lead statuses (stored codes — labels only)

| Code | Hebrew (current UI) | English | Arabic |
| --- | --- | --- | --- |
| `new` | חדש | New | جديد |
| `contacted` | בטיפול | In progress | قيد المتابعة |
| `interested` | מתעניין | Interested | مهتم |
| `closed` | נסגר | Closed | مُغلق |
| `lost` | לא רלוונטי | Not relevant | غير ذي صلة |

⚠ `closed` = won (became a customer); "Closed" alone can read as lost in English — reviewer may prefer "Won".

## Deal statuses (stored as Hebrew in `sales.status` — display map only, values never change)

| Stored value | English | Arabic |
| --- | --- | --- |
| חדש | New | جديد |
| בהצעה | Proposal sent | تم إرسال العرض |
| במו"מ | Negotiating | قيد التفاوض |
| ממתין לתשלום | Awaiting payment | بانتظار الدفع |
| שולם | Paid | مدفوع |
| בוטל | Cancelled | ملغى |

## Deal branches (stored as Hebrew in `sales.branch` and as reporting keys — display map only)

| Stored value | English | Arabic |
| --- | --- | --- |
| משוקלל (report total) | Weighted total | الإجمالي المرجّح |
| שירותים | Services | خدمات |
| מוצרים | Products | منتجات |
| קורסים | Courses | دورات |
| מנויים | Subscriptions | اشتراكات |
| חבילות | Packages | باقات |
| ייעוץ | Consulting | استشارات |
| אחר | Other | أخرى |

## Never translated

Lead/contact names, phone numbers, emails, notes, message bodies, questionnaire
questions and answers, WhatsApp and automation template bodies, invoices and
quotes, Meta ad/campaign names, file names, business/agency data, AI-generated
text (decision D3: stays Hebrew), pre-login pages (decision D4: stay Hebrew).

## Review questions for D1

1. Arabic for ליד: formal «عميل محتمل» or colloquial «ليد»?
2. English for `closed`: "Closed" or "Won"?
3. One English term for פולואפ/מעקב: "Follow-up" (proposed)?
4. Native reviewers (D2) for English and Arabic.
