# T02 — סכימה ומיגרציה

הקדם: `_SHARED.md`. **קרא שוב את איסור 1: אסור להריץ את המיגרציה.**

## המטרה
הגדרות Drizzle וקובץ SQL של מיגרציה. בלי הרצה.

## היקף
- `src/db/schema.ts` (עריכה)
- `drizzle/00XX_franchisee_billing.sql` (חדש — קח את המספר הבא הפנוי)
- `drizzle/meta/_journal.json` (עריכה)

## עמודות חדשות על `franchisee`
```
royaltyTiers            jsonb        // [{ upTo: number|null, rate: number }]
royaltyTierBasis        text         // 'gross' | 'net', ברירת מחדל 'gross'
royaltyTiersConfirmed   boolean      // ברירת מחדל false
royaltyIncludeTips      boolean      // ברירת מחדל false
tipsAbsenceAcknowledged boolean      // ברירת מחדל false
hashavshevetAccountKey  text
```
`marketingFeeRate` ו-`royaltyRate` **כבר קיימות** בסכימה ו-NULL אצל כולם. אל תיצור אותן מחדש. `marketingFeeRate` תמולא ב-T03.

## שלוש טבלאות חדשות
המפרט המלא בסעיף "מודל הנתונים" של `plan/franchisee-royalty-billing-execution.html`. קרא אותו. תמצית:
- `franchisee_billing` — שורת חיוב לחודש. כוללת צילום קלט, תוצאות, **וחמישה שדות צילום מצב** (`tiersSnapshot`, `tierBasisSnapshot`, `marketingRateSnapshot`, `vatRateSnapshot`, `accountKeySnapshot`) שנכתבים באישור. `UNIQUE (franchiseeId, periodYear, periodMonth)`.
- `franchisee_deferral_ledger` — `amount numeric(16,6)` **עם סימן**. חיובי = נדחה, שלילי = נגבה. אין עמודת `direction`.
- `franchisee_billing_export` — אצווה לכל קובץ ייצוא.

## החלטות מחייבות
- כל עמודת כסף `numeric(16,6)`. לא `numeric(12,2)` ולא שקלים שלמים.
- **אסור לגעת ב-`settlement_period`.** יש שם מלכודת מתועדת: ארבע שאילתות חיות בוחרות "התקופה הפתוחה הראשונה" ב-`limit(1)`, ו-`settlement-simple.ts:339` היה מצמיד התאמת ספק לשורת חיוב של זכיין. טבלה חדשה, אפס שינויים בקוד קיים.
- האינדקס הייחודי הוא הגנת הכפל-חיוב. בלעדיו אין שום דבר שמונע שני חיובים לאותו חודש.

## `_journal.json` נסחף, וזה לא שלך לתקן

יש 72 קבצי SQL ב-`drizzle/` ו-33 רשומות ב-`_journal.json`. **39 קבצים אינם רשומים בו**,
עד `0003`. זה מצב מוכר בפרויקט הזה, המיגרציות האלה הורצו ידנית ואומתו ב-SQL ישיר.

**אתה מוסיף רשומה אחת בסוף, לקובץ שלך בלבד.** אסור לבנות את ה-journal מחדש, אסור להוסיף
רשומות למיגרציות ההיסטוריות החסרות, ואסור למספר מחדש `idx` קיימים. `drizzle-kit migrate`
נגזר מהקובץ הזה, והוא רץ נגד **פרודקשן** — journal ש"תוקן" יגרום לו לנסות להריץ מחדש DDL
היסטורי על בסיס הנתונים של לקוח משלם. זה לא באג בקוד, זה אירוע.

ה-`idx` שלך הוא הבא אחרי הגבוה ביותר שקיים, וה-`tag` הוא שם הקובץ שלך בלי הסיומת.

## גמור כאשר
`npm run lint` עובר, ה-SQL תקין תחבירית, וה-journal מעודכן. **בלי `db:migrate`.** בהודעה האחרונה שלך תכתוב את פקודת ה-psql שאדם יריץ כדי לאמת שהמיגרציה נחתה.
