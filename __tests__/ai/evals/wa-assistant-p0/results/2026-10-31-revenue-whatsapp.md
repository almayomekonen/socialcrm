# wa-assistant-p0 — revenue-whatsapp

Run 2026-10-31T22:45:19.955Z · surface whatsapp · tenant agency 41 · model gpt-5.6 · 8 cases

| metric | count |
| --- | --- |
| passed every check | 8 / 8 |
| generic fallback sent | 0 |
| refused as unsupported claim | 0 |
| dropped claims (sum) | 0 |
| unnecessary tool calls (cases over their limit) | 0 |
| report format where a plain reply was expected | 0 |
| content pattern failures | 0 |
| cost | $0.939 |

| kind | passed |
| --- | --- |
| financial | 8 / 8 |

Set: revenue (revenueCases.ts)
Documented failures: 

| id | pass | tools | claims | flags | question | reply |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | yes | get_revenue | OBSERVATION,OBSERVATION | — | כמה העסק שלי עשה השנה? | *השנה העסק רשם הכנסות של 20,500 ₪, לפי תאריך הפנייה במסך «ביצועים».* ⏎ • ההכנסות ששולמו השנה הן 20,500 ₪ מתוך 2 עסקאות ששולמו. ⏎ • בנפרד, שווי העסקאות הפתוחות הוא 7,500 ₪; זהו פייפליין ולא הכנסה או תחזית. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R2 | yes | get_revenue | OBSERVATION | — | כמה כסף נכנס בחודש שעבר? | *בחודש שעבר נכנסו 8,500 ₪ מעסקאות ששולמו, לפי תאריך הפנייה.* ⏎ • ההכנסה שנרשמה באוקטובר 2026 היא 8,500 ₪ מעסקה אחת ששולמה. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R3 | yes | get_revenue | OBSERVATION | — | כמה הכנסתי בשנה שעברה? | *בשנת 2025 נרשמו הכנסות של 3,000 ₪ מעסקה אחת ששולמה, לפי תאריך הפנייה.* ⏎ • בשנה שעברה נרשמו הכנסות בסך 3,000 ₪ מעסקה אחת בסטטוס שולם, לפי תאריך הפנייה כפי שמחושב במסך «ביצועים». ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R4 | yes | get_revenue | OBSERVATION | — | כמה יש לי בפייפליין השנה? | *בפייפליין השנה רשומים 7,500 ₪, לפי תאריך הפנייה.* ⏎ • שווי העסקאות הפתוחות השנה הוא 7,500 ₪; זהו פייפליין ולא הכנסה או תחזית. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R5 | yes | get_revenue | OBSERVATION | — | מה היו ההכנסות בין 1 במרץ ל-31 במרץ 2026? | *ההכנסות שנרשמו בין 1 ל־31 במרץ 2026 היו 12,000 ₪, לפי תאריך הפנייה.* ⏎ • בתקופה נרשמה עסקה אחת בסטטוס שולם, בסך 12,000 ₪. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R6 | yes | get_revenue | PRODUCT,OBSERVATION,RECOMMENDATION | — | כמה אני צפוי להכניס החודש? | *אי אפשר לחשב תחזית הכנסה; כרגע לא נרשמו החודש הכנסות או עסקאות פתוחות.* ⏎ • SocialCRM אינה מספקת חיזוי הכנסות; היא מציגה רק הכנסות ששולמו ושווי פייפליין שנרשמו במערכת. ⏎ • החודש נרשמו 0 ₪ הכנסות ששולמו ו-0 ₪ בפייפליין, לפי תאריך הפנייה. ⏎ • כדי לקבל תמונה שימושית יותר, כדאי לרשום ולעדכן במערכת את העסקאות הפעילות והסכומים שלהן. ⏎ אין במערכת תחזית שמאפשרת לקבוע כמה צפוי להיכנס החודש. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R7 | yes | get_revenue | OBSERVATION | — | כמה כסף נכנס החודש? | *החודש נכנסו 0 ₪ לפי העסקאות שנרשמו כשולמו ולפי תאריך הפנייה.* ⏎ • ההכנסה ששולמה החודש היא 0 ₪, ואין עסקאות ששולמו בתקופה. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R8 | yes | get_revenue | OBSERVATION,OBSERVATION | — | תן לי את ההכנסות והפייפליין של השנה | *השנה נרשמו הכנסות של 20,500 ₪ ופייפליין פתוח של 7,500 ₪, לפי תאריך הפנייה.* ⏎ • ההכנסות מעסקאות ששולמו השנה הן 20,500 ₪, מ־2 עסקאות. ⏎ • שווי העסקאות הפתוחות בפייפליין הוא 7,500 ₪; זה אינו הכנסה או תחזית. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
