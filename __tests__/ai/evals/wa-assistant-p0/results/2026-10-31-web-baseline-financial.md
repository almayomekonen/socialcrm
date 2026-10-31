# wa-assistant-p0 — web-baseline-financial

Run 2026-10-31T22:23:41.692Z · surface web · tenant agency 41 · model gpt-5.6 · 2 cases

| metric | count |
| --- | --- |
| passed every check | 0 / 2 |
| generic fallback sent | 0 |
| refused as unsupported claim | 0 |
| dropped claims (sum) | 0 |
| unnecessary tool calls (cases over their limit) | 0 |
| report format where a plain reply was expected | 0 |
| content pattern failures | 2 |
| cost | $0.095 |

| kind | passed |
| --- | --- |
| financial | 0 / 2 |

Documented failures: casual=S2 FAIL · ambiguousFollowUp=M7 FAIL · product=P1 FAIL · financial=F1 FAIL · recommendation=B12 FAIL

| id | pass | tools | claims | flags | question | reply |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | **no** | — | PRODUCT | missing /ביצועים/; has /אין (כרגע )?דוח הכנסות/ | כמה העסק שלי עשה השנה? | אין לי נתוני הכנסה שמאפשרים לחשב כמה העסק עשה השנה. ⏎ ב-SocialCRM אין כרגע דוח הכנסות מלא, ולכן אי אפשר לחשב מכאן הכנסה שנתית באופן אמין. ⏎ חסרים נתוני הכנסות או עסקאות ששולמו מתחילת 2026 ועד היום. |
| F2 | **no** | — | PRODUCT | missing /ביצועים/ | כמה כסף נכנס החודש? | אי אפשר לחשב כמה כסף נכנס החודש מהנתונים הזמינים ב‑SocialCRM. ⏎ אין כרגע במערכת דוח הכנסות מלא, ולכן לא ניתן לחשב באופן אמין את ההכנסה החודשית. ⏎ חסרים נתוני הכנסות או תשלומים לחודש הנוכחי. |
