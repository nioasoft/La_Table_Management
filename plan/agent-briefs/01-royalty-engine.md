# T01 — מנוע החישוב

הקדם: `_SHARED.md`.

## המטרה
פונקציה טהורה אחת שמחשבת חיוב תמלוגים ושיווק לזכיין, ובדיקות שמוכיחות אותה מול נתוני אמת.

## היקף
- `src/lib/royalty.ts` (חדש)
- `src/lib/__tests__/royalty.test.ts` (חדש)
בלי I/O, בלי Drizzle, בלי `Date`, בלי קריאה ל-DB. שער המע"מ מגיע כפרמטר.

## החוזה — לממש בדיוק כך
```
קלט:
  receipts            // סה"כ תקבולים מטאבית, כולל מע"מ
  tips                // סה"כ טיפ מטאבית
  includeTips         // boolean
  tiers[]             // [{ upTo: number|null, rate: number }]  rate באחוזים, upTo כולל
  tierBasis           // 'gross' | 'net'
  marketingRate       // אחוזים
  discountRatePoints  // נקודות אחוז
  vat                 // שבר. היום 0.18

חישוב:
  grossBase = receipts + (includeTips ? tips : 0)
  netBase   = grossBase / (1 + vat)

  threshold(t) = tierBasis === 'net' ? t.upTo * (1 + vat) : t.upTo
  tierRate     = tiers.find(t => t.upTo === null || grossBase <= threshold(t)).rate

  effectiveRate = max(0, tierRate - discountRatePoints)

  royaltyFull   = netBase * tierRate      / 100
  royalty       = netBase * effectiveRate / 100
  discountValue = royaltyFull - royalty
  marketing     = netBase * marketingRate / 100
  subtotal      = royalty + marketing
  total         = subtotal * (1 + vat)
```

### אל תייבא כלום. במיוחד לא את `calculateNetFromGross`
קיים ב-`src/lib/file-processor.ts:93` עוזר בשם `calculateNetFromGross` שגופו הוא בדיוק
`grossAmount / (1 + vatRate)`. **אסור לייבא אותו.** `file-processor.ts` מייבא
`@/data-access/vatRates`, שמייבא `@/db` — כלומר ייבוא של שורה אחת גורר את קליינט בסיס
הנתונים לתוך גרף המודולים, והופך מנוע טהור למשהו שדורש חיבור DB כדי לרוץ בבדיקה.

`royalty.ts` צריך להיות עם **אפס imports**. חלק בעצמך. הוסף הערה שמסבירה למה, אחרת מישהו
"ימחזר" את זה בעתיד.

### שלוש נקודות שנראות כמו באג ואינן
1. **הרף נבדק מול הברוטו, האחוז מוכפל בנטו.** זה מכוון ומוכח מהאקסל של הלקוחה. הוסף הערה בקוד שאומרת את זה, אחרת מישהו "יתקן".
2. **ההנחה נגרעת מהתעריף ולא מהסכום.** `netBase * (tierRate - points)` ולא `royalty * (1 - points)`.
3. **אין עיגול בשום מקום.**

## הבדיקות — כאן ההוכחה
שתי מערכות fixtures מנתוני אמת. הקבצים ב-`raw_data/תמלוגים זכיינים/`, וה-`README.md` שם מסביר איך לשלוף את הנוסחאות (הן לא בערכים, הן בנוסחאות).

1. **19 השורות של `תמלוגים ושיווק עפי הסכם - ינואר.xlsx`** — לכל שורה: ברוטו, סולם, ותוצאה מצופה לתמלוגים ולשיווק. חלץ אותן פעם אחת וקבע אותן כ-fixture קשיח בקובץ הבדיקה. אל תקרא xlsx בזמן ריצת הבדיקות.
2. **18 השורות מששת קבצי `חשבשבת/`** — ארבע מהן עם הנחה: אודון −1, ויני חדרה −1, טמפר −1, סידיוס −0.5 נקודות אחוז. הן הבדיקה היחידה שמכסה את מסלול ההנחה.

בדיקות נוספות: גבולות מדרגה משני הצדדים · מדרגת 0% · בסיס מתחת לרף התחתון · `tierBasis='net'` מול `'gross'` על אותו בסיס — **חייבים לצאת שונים** · אותו רף נטו בשני שערי מע"מ שונים — חייב לייצר שתי מדרגות שונות · כולל טיפים מול בלי · `discountRatePoints` גדול מהתעריף נחתך ל-0 ולא לשלילי · `marketingRate = 0` · `subtotal === royalty + marketing` תמיד.

## גמור כאשר
`npm test src/lib/__tests__/royalty.test.ts` עובר, כל 37 השורות האמיתיות בפנים, והמספרים זהים למה שבקבצים של הלקוחה.
