# CLAUDE.md

La Table Management — מערכת ניהול עמלות לקבוצת זכיינות מסעדות (~20 זכיינים,
3 מותגים, ~30 ספקים). מחזור העבודה: בקשת דוחות מספקים/זכיינים במייל →
איסוף קבצים בלינקים מאובטחים → הצלבת סכומי ספק מול זכיין → טיפול בפערים
והתאמות → חישוב עמלות → הפקת דוחות חשבונית לפי חברת ניהול.

## מושגי דומיין

- **Supplier** — ספק שמשלם עמלה (אחוז קבוע או תעריף פר-פריט), עם קונפיג מיפוי קבצים.
- **Franchisee** — מסעדה עם aliases (כל ספק קורא לה בשם אחר) — זה בסיס ה-fuzzy matching.
- **Settlement Period** — מחזור התחשבנות (חודשי/רבעוני/חצי-שנתי/שנתי).
- **Cross-Reference** — הצלבת ספק מול זכיין; פער ≤₪30 נחשב מותאם (reconciliation V2).
- מותגים: Pat Vini, Mina Tomai, King Kong. חברות ניהול (מפיקות חשבוניות): Panikon, Pedvili, Ventami.

## Database — PRODUCTION בלבד

**אין DB פיתוח.** `DATABASE_URL` ב-.env מצביע על Neon production (www.latable.co.il),
וכל סקריפט `db:*` רץ נגדו. אל תשתמש ב-Docker המקומי לנתונים.

שאילתות ישירות:

```bash
PGPASSWORD=<password> psql "postgresql://neondb_owner@ep-withered-sunset-ag7zdsgi-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require"
```

## אימות ב-API routes

תמיד דרך `@/lib/api-middleware` — לא import ישיר של auth:

```typescript
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
const authResult = await requireAdminOrSuperUser(request);
if (isAuthError(authResult)) return authResult;
```

פונקציות: `requireAuth` / `requireAdminOrSuperUser` / `requireSuperUser`.

## תאריכים — לעולם לא toISOString()

`toISOString()` ממיר ל-UTC ומזיז תאריך אחורה (ישראל UTC+2/3) — 1 באוקטובר הופך
ל-30 בספטמבר. פורמט YYYY-MM-DD תמיד עם getFullYear/getMonth/getDate מקומיים.

## Test user (QA)

קיים משתמש בדיקות ייעודי (ב-DB, לא בקוד). מותר לקדם אותו זמנית ל-admin לבדיקה;
בסיום — להחזיר למצב לא-מורשה (role ריק, status לא active).

## docs/

`PRD.md` (דרישות + סכמה) · `architecture.md` · `authentication.md` · `ux.md` ·
`file-uploads.md` · `suppliers-reference.md` (קונפיג ספקים, מיפוי קבצים, aliases) ·
`reut_meeting.md` (דרישות מקוריות)
