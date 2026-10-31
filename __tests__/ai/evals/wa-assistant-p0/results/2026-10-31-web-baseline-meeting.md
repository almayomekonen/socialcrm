# wa-assistant-p0 — web-baseline-meeting

Run 2026-10-31T22:27:38.394Z · surface web · tenant agency 41 · model gpt-5.6 · 8 cases

| metric | count |
| --- | --- |
| passed every check | 7 / 8 |
| generic fallback sent | 0 |
| refused as unsupported claim | 0 |
| dropped claims (sum) | 0 |
| unnecessary tool calls (cases over their limit) | 1 |
| report format where a plain reply was expected | 0 |
| content pattern failures | 0 |
| cost | $0.647 |

| kind | passed |
| --- | --- |
| meeting | 7 / 8 |

Documented failures: casual=S2 FAIL · ambiguousFollowUp=M7 FAIL · product=P1 FAIL · financial=F1 FAIL · recommendation=B12 FAIL

| id | pass | tools | claims | flags | question | reply |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | yes | — | — | — | תקבע לי פגישה עם ליד | עם איזה ליד לקבוע את הפגישה? ⏎ חסרים הליד, כותרת הפגישה, התאריך, שעת ההתחלה ומשך הפגישה. |
| M2 | yes | find_lead | — | — | עם יוסי | מה כותרת הפגישה עם יוסי, באיזה תאריך ושעה, ולכמה זמן? ⏎ חסרים כותרת, תאריך, שעת התחלה ומשך הפגישה. |
| M3 | yes | find_lead | — | — | מחר בשעה 10 וחצי | מה כותרת הפגישה וכמה דקות היא תימשך? ⏎ חסרים כותרת הפגישה ומשך הפגישה. |
| M4 | yes | get_today_state | FACT | — | תקבע לי פגישה עם הליד הראשון שמופיע ברשימה | הפגישה תהיה עם דנה הזדמנות, הליד הראשון ברשימה. ⏎ דנה הזדמנות היא הליד הראשון ברשימה. ⏎ מה כותרת הפגישה, באיזה תאריך ושעה היא תתקיים, ולכמה דקות? |
| M5 | yes | find_lead | FACT | — | תקבע לי פגישה עם אבי  ⏎ למחר בבוקר בשעה 10:00 | מצאתי את אבי הזדמנות; מה כותרת הפגישה וכמה זמן היא תימשך? ⏎ הליד שנמצא הוא אבי הזדמנות. ⏎ חסרים כותרת הפגישה ומשך הפגישה בדקות. |
| M6 | yes | find_lead | — | — | תקבע לי פגישה עם Shay Hadad ליום ראשון בשעה 12:00 | לא מצאתי ליד בשם Shay Hadad. ⏎ אפשר לבדוק איות אחר או שם נוסף? לאחר שנזהה את הליד אצטרך גם תאריך מדויק ומשך לפגישה. |
| M7 | **no** | find_lead | — | TOOLS | סלמתאק | לכמה דקות לקבוע את הפגישה? ⏎ חסר משך הפגישה בדקות. |
| M8 | yes | — | — | — | טיפשול | צודק, טעיתי — הוספתי לאבי שם שלא נתת ולא בדקתי את הליד במערכת. |
