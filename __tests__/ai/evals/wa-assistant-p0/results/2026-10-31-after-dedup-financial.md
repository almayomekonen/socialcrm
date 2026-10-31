# wa-assistant-p0 — after-dedup-financial

Run 2026-10-31T22:09:31.611Z · tenant agency 41 · model gpt-5.6 · 2 cases

| metric | count |
| --- | --- |
| passed every check | 2 / 2 |
| generic fallback sent | 0 |
| refused as unsupported claim | 0 |
| dropped claims (sum) | 0 |
| unnecessary tool calls (cases over their limit) | 0 |
| report format where a plain reply was expected | 0 |
| content pattern failures | 0 |
| cost | $0.114 |

| kind | passed |
| --- | --- |
| financial | 2 / 2 |

Documented failures: casual=S2 FAIL · ambiguousFollowUp=M7 FAIL · product=P1 FAIL · financial=F1 PASS · recommendation=B12 FAIL

| id | pass | tools | claims | flags | question | reply |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | yes | — | PRODUCT,PRODUCT | — | כמה העסק שלי עשה השנה? | אין לי גישה לסכום ההכנסות שלך, אבל במסך «ביצועים» אפשר לבחור «השנה» ולראות כמה העסק הכניס מעסקאות שסומנו כשולמו. ⏎ מסך «ביצועים» מציג את סך ההכנסות מעסקאות ששולמו לפי התקופה שנבחרה, כולל השנה. ⏎ הסוכן עדיין לא קורא את נתוני העסקאות וההכנסות ולכן אינו יכול למסור את הסכום. ⏎ סכום ההכנסות של העסק השנה אינו זמין לי. ⏎ במערכת: https://getsocialcrm.com/sum_sales |
| F2 | yes | — | PRODUCT | — | כמה כסף נכנס החודש? | אין לי גישה לסכום ההכנסות עצמו; במסך «ביצועים» אפשר לבחור «החודש» ולראות את סך ההכנסות מעסקאות שסומנו כשולמו. ⏎ מסך «ביצועים» מציג הכנסות מעסקאות ששולמו לפי התקופה שנבחרה, אך הסוכן אינו קורא כרגע את נתוני העסקאות וההכנסות. ⏎ סכום ההכנסות שנכנס החודש אינו זמין לי. ⏎ במערכת: https://getsocialcrm.com/sum_sales |
