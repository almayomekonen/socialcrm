# wa-assistant-p0 — review-revenue-whatsapp

Run 2026-10-31T23:05:29.739Z · surface whatsapp · tenant agency 41 · model gpt-5.6 · 8 cases

| metric | count |
| --- | --- |
| passed every check | 8 / 8 |
| generic fallback sent | 0 |
| refused as unsupported claim | 0 |
| dropped claims (sum) | 0 |
| unnecessary tool calls (cases over their limit) | 0 |
| report format where a plain reply was expected | 0 |
| content pattern failures | 0 |
| cost | $0.945 |

| kind | passed |
| --- | --- |
| financial | 8 / 8 |

Set: revenue (revenueCases.ts)
Documented failures: 

| id | pass | tools | claims | flags | question | reply |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | yes | get_revenue | OBSERVATION,OBSERVATION | — | כמה העסק שלי עשה השנה? | *השנה העסק רשם הכנסות ששולמו בסך 20,500 ₪, לפי תאריך הפנייה.* ⏎ • נרשמו 20,500 ₪ הכנסות ששולמו ב-2 עסקאות השנה. ⏎ • בנפרד, שווי העסקאות הפתוחות הוא 7,500 ₪; זהו פייפליין ולא הכנסה או תחזית. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R2 | yes | get_revenue | OBSERVATION,OBSERVATION | — | כמה כסף נכנס בחודש שעבר? | *בחודש שעבר נכנסו 8,500 ₪ מעסקה אחת ששולמה, לפי תאריך הפנייה במסך «ביצועים».* ⏎ • בחודש שעבר נרשמו 8,500 ₪ כהכנסות ששולמו. ⏎ • ההכנסה הגיעה מעסקה אחת ששולמה, לפי תאריך הפנייה. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R3 | yes | get_revenue | OBSERVATION | — | כמה הכנסתי בשנה שעברה? | *בשנה שעברה נרשמו במערכת הכנסות ששולמו בסך 3,000 ₪, לפי תאריך הפנייה.* ⏎ • בשנה שעברה נרשמו הכנסות ששולמו בסך 3,000 ₪ מעסקה אחת, לפי תאריך הפנייה כפי שמחושב במסך «ביצועים». ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R4 | yes | get_revenue | OBSERVATION | — | כמה יש לי בפייפליין השנה? | *בפייפליין השנה רשומים 7,500 ₪, לפי תאריך הפנייה.* ⏎ • שווי העסקאות הפתוחות השנה הוא 7,500 ₪; זהו פייפליין ולא הכנסה או תחזית. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R5 | yes | get_revenue | OBSERVATION | — | מה היו ההכנסות בין 1 במרץ ל-31 במרץ 2026? | *בין 1 ל־31 במרץ 2026 נרשמו הכנסות ששולמו בסך 12,000 ₪, לפי תאריך הפנייה.* ⏎ • ההכנסה ששולמה בתקופה הייתה 12,000 ₪ מעסקה אחת, לפי תאריך הפנייה כפי שמחושב במסך «ביצועים». ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R6 | yes | get_revenue | OBSERVATION,OBSERVATION,PRODUCT | — | כמה אני צפוי להכניס החודש? | *אי אפשר לחשב הכנסה צפויה; החודש לא נרשמו הכנסות ששולמו או עסקאות בפייפליין.* ⏎ • לפי תאריך הפנייה, החודש נרשמו 0 ₪ ששולמו ו-0 עסקאות ששולמו. ⏎ • שווי הפייפליין הרשום החודש הוא 0 ₪. ⏎ • SocialCRM אינה מספקת תחזית הכנסות; שווי הפייפליין, כשקיים, אינו תחזית. ⏎ אין מספיק נתונים כדי להעריך כמה צפוי להיכנס החודש. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R7 | yes | get_revenue | OBSERVATION | — | כמה כסף נכנס החודש? | *החודש לא נרשמו הכנסות ששולמו — לפי תאריך הפנייה במסך «ביצועים».* ⏎ • נרשמו 0 ₪ הכנסות ששולמו ו־0 עסקאות בתקופה. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
| R8 | yes | get_revenue | OBSERVATION,OBSERVATION | — | תן לי את ההכנסות והפייפליין של השנה | *השנה נרשמו הכנסות ששולמו בסך 20,500 ₪, והפייפליין עומד על 7,500 ₪ — לפי תאריך הפנייה במסך «ביצועים».* ⏎ • ההכנסות ששולמו השנה הן 20,500 ₪ מ־2 עסקאות ששולמו. ⏎ • שווי העסקאות הפתוחות בפייפליין הוא 7,500 ₪; זה אינו הכנסה או תחזית. ⏎ לפרטים המלאים: https://getsocialcrm.com/agent |
