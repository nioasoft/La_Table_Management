# מדריך ספקי עמלות - La Table Management

> **עדכון אחרון:** 2026-01-14
> **מקור נתונים:** `raw_data/ספקים טבלה עמלות רשת.xlsx`

---

## סקירה כללית

מערכת La Table מנהלת **33 ספקים פעילים** (מתוך 36, למעט 3 ספקי PDF).

| תדירות התחשבנות | כמות ספקים |
|-----------------|------------|
| חודשי | 2 |
| רבעוני | 29 |
| חצי-שנתי | 3 |
| שנתי | 2 |

---

## טבלת ספקים מלאה

### ספקים חודשיים

| ספק | קוד | עמלה | סוג עמלה | הערות |
|-----|-----|------|----------|-------|
| מיטלנד | MITLAND | 13% | percentage | |
| אברהמי | AVRAHAMI | 10% | percentage | 12% ללאפה וחלת בריוש |

### ספקים רבעוניים

| ספק | קוד | עמלה | סוג עמלה | הערות |
|-----|-----|------|----------|-------|
| פאנדנגו | FANDANGO | 12% | percentage | |
| היכל הייו | HEICHAL_HAYIU | 15% | percentage | |
| מדג | MADAG | 15% | percentage | |
| מקאטי | MAKATI | 17% | percentage | |
| יעקב סוכנויות | YAAKOV_AGENCIES | 10% | percentage | + הנחת פתיחה לסניף |
| אראל אריזות | EREL_PACKAGING | 15% | percentage | |
| אספיריט | ASPIRIT | 14% | percentage | |
| פרסקו | FRESCO | 10% | percentage | |
| קיל ביל | KILL_BILL | 10% | percentage | |
| ג'ומון | JUMON | 17%/10%/20% | percentage | לפי סוג מוצר |
| מעדני הטבע | MAADANEI_HATEVA | 10% | percentage | |
| רסטרטו | RISTRETTO | 17% | percentage | כולל קניות פסטה |
| תויות הצפון | TUVIOT_HATZAFON | 15% | percentage | |
| ארגל | ARGEL | 10% | percentage | |
| דיפלומט | DIPLOMAT | 17% | percentage | |
| עלה עלה | ALE_ALE | 10% | percentage | |
| יוניקו | UNICO | 15% | percentage | |
| מזרח ומערב | MIZRACH_UMAARAV | 17% | percentage | תוקף עד 31/12/2025 |
| מור בריאות | MOR_BRIUT | 12% | percentage | |
| פסטה לה קאזה | PASTA_LA_CASA | 15% | percentage | קובץ נפרד לכל זכיין |
| נספרסו | NESPRESSO | 0.21 | per_item | ש"ח לקפסולה |
| סובר לרנר | SOBER_LERNER | 15% | percentage | או לפי פריט |
| אורן שיווק מיצים | OREN_JUICES | 5% | percentage | |
| ביגי | BIGI | 12% | percentage | |
| שף הים | CHEF_HAYAM | 15% | percentage | |
| מור מזון | MOR_MAZON | 15% | percentage | |
| ניסים גורן | NISSIM_GOREN | 10% | percentage | |
| סנו | SANO | 6% | percentage | |
| שטראוס (קפה) | STRAUSS_COFFEE | 10% | percentage | |

### ספקים חצי-שנתיים

| ספק | קוד | עמלה | סוג עמלה | הערות |
|-----|-----|------|----------|-------|
| מחלבות גד | MACHALVOT_GAD | 9% | percentage | לא כולל מוצרי חלב מסוימים |
| לאומי קארד | LEUMI_CARD | 0.15% | percentage | בדיקת חידוש 04/26 |
| קירוסקאי | KIROSKAI | 5% | percentage | מ-01/02 |

### ספקים שנתיים

| ספק | קוד | עמלה | סוג עמלה | הערות |
|-----|-----|------|----------|-------|
| טמפו שיווק | TEMPO | 11% | percentage | מקניות ברוטו |
| תנובה | TNUVA | 6%/7%/5% | percentage | חלב/בשר/בקר (לא חמאה) |

---

## הגדרות File Mapping לספקים

> **הערה:** כל הסכומים בקבצים הם **לפני מע"מ** (נטו)

### ספקים עם מבנה פשוט

#### פאנדנגו
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "G",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": ["סה\"כ"]
}
```
- **גיליון:** AlmogERP&CRM
- **עמודת זכיין:** B ("שם לקוח")
- **עמודת סכום:** G ("עמלת רשת (ש״ח)")

#### היכל הייו
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "A",
    "amountColumn": "B",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **גיליון:** Export
- **הערה:** נתונים כבר מסוכמים לפי זכיין

#### מקאטי
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "E",
    "dateColumn": ""
  },
  "headerRow": 4,
  "dataStartRow": 5,
  "skipKeywords": []
}
```
- **גיליון:** גיליון1
- **עמודת זכיין:** B ("שם החנות")

#### אספיריט
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "D",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **גיליון:** DataSheet
- **עמודת סכום:** D ("הכנסה")

#### פרסקו
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "E",
    "dateColumn": "C"
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": ["סה\"כ"]
}
```
- **גיליון:** DataSheet

#### קיל ביל
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "G",
    "amountColumn": "A",
    "dateColumn": ""
  },
  "headerRow": 2,
  "dataStartRow": 3,
  "skipKeywords": []
}
```
- **גיליון:** PRICDEF.tmp
- **אזהרה:** יש שורות עם ערכים ריקים - לסנן

#### ג'ומון (מינה טומאיי + קינג קונג)
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "F",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **גיליון:** גיליון1
- **הערה:** 2 קבצים נפרדים - אחד למינה טומאיי ואחד לקינג קונג

#### מעדני הטבע
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "G",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **גיליון:** DataSheet
- **הערה:** קובץ קטן מאוד (5 שורות)

#### ארגל
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "H",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **עמודת סכום:** H ("סה'כ")

#### דיפלומט
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "A",
    "amountColumn": "F",
    "dateColumn": ""
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **גיליון:** Sheet1
- **עמודת זכיין:** A ("Payer")

#### עלה עלה
```json
{
  "fileType": "csv",
  "columnMappings": {
    "franchiseeColumn": "1",
    "amountColumn": "7",
    "dateColumn": "0"
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": []
}
```
- **קידוד:** Windows-1252
- **הערה:** 194 זכיינים ייחודיים, טקסט עברי הפוך

### ספקים עם מבנה מורכב

#### מזרח ומערב / רסטרטו
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "B",
    "amountColumn": "F",
    "dateColumn": ""
  },
  "headerRow": 3,
  "dataStartRow": 4,
  "skipKeywords": []
}
```
- **גיליון:** "עמלה"
- **הערה:** אותה מערכת - 2 גיליונות (עמלה + פריטים מוחרגים)

#### יעקב סוכנויות
```json
{
  "fileType": "xlsx",
  "columnMappings": {
    "franchiseeColumn": "A",
    "amountColumn": "E",
    "dateColumn": "B"
  },
  "headerRow": 6,
  "dataStartRow": 7,
  "skipKeywords": []
}
```
- **בעיה:** מבנה היררכי - צריך forward fill על עמודה A

#### פסטה לה קאזה
```json
{
  "fileType": "xls",
  "columnMappings": {
    "franchiseeColumn": "C",
    "amountColumn": "F",
    "dateColumn": "E"
  },
  "headerRow": 1,
  "dataStartRow": 2,
  "skipKeywords": ["סה\"כ"]
}
```
- **מבנה מיוחד:** תיקייה עם קבצים נפרדים לכל זכיין
- **דפוס שם קובץ:** `[מספר סניף] [שם זכיין] [תקופה].xls`

### ספקים דורשי פיתוח custom parser

| ספק | בעיה | פתרון נדרש |
|-----|------|-----------|
| מדג | שם לקוח מוטבע בטקסט | regex: `r'שם לקוח:\s*([^,\n]+)'` |
| אברהמי | Pivot Table (60 עמודות) | transpose או custom parser |
| יוניקו | 3 קטגוריות מקבילות | unpivot |
| תויות הצפון | מרובה חודשים | custom parser |
| מחלבות גד | 4 טבלאות בגיליון | זיהוי גבולות טבלאות |
| מור בריאות | רשומות פרט | aggregation |
| אראל אריזות | Pivot מורכב | בדיקה ידנית |

---

## מיפוי שמות זכיינים (Aliases)

### מינה טומאיי

| שם מומלץ במערכת | Aliases |
|-----------------|---------|
| מינה טומאיי קריון | אודון ניהול ואחזקות בע"מ, מינה טומיי קריון, אודון ניהול ואחזקות בעמ-מינה טומיי |
| מינה טומאיי עין שמר | מינה טומי עין שמר בע"מ, מינה טומיי עין שמר בע"מ |
| מינה טומאיי שרונה | מינה שרונה בע"מ |
| מינה טומאיי קסטרא | קסטרא טומאי בע'מ, קסטרא טומאיי בע"מ, קסטרא טומאי בע"מ |
| מינה טומאיי יהוד | אושיבה בע"מ, אושיבה בעמ (מינה טומי יהוד) |
| מינה טומאיי ביאליק | מינה טומיי ביאליק |

### פט ויני

| שם מומלץ במערכת | Aliases |
|-----------------|---------|
| פט ויני חדרה | ויני חדרה מול החוף בע"מ, פאט ויני - חדרה |
| פט ויני יהוד | טמפר הסעדה בע"מ, פט ויני יהוד-טמפר הסעדה בע"מ, פאט ויני - יהוד |
| פט ויני נתניה | סידיוס בע"מ, פט ויני נתניה-סידיוס בע"מ |
| פט ויני עזריאלי חיפה | פט ויני עזריאלי בע"מ-חיפה, פט ויני קניון חיפה |
| פט ויני קריית אתא | מיאמוטו בע"מ, מיאמוטו בע"מ-פט ויני, פט ויני קריות |
| פט ויני רגבה | ויני רגבה בע"מ |
| פט ויני כרמיאל | ויני כרמיאל בע"מ |

### קינג קונג

| שם מומלץ במערכת | Aliases |
|-----------------|---------|
| קינג קונג חדרה | קינג קונג חדרה בע"מ, קינג קונג חדרה בעמ |
| קינג קונג ביג | קינג קונג ביג בע"מ, קינג קונג ביג קריות |
| קינג קונג חורב | קינג קונג חורב בע"מ, קינג קונג חורב חיפה |
| קינג קונג כרמיאל | קינג כרמיאל בעמ, קינג כרמיאל בע"מ (קינג קונג כרמיאל) |
| קינג קונג נהריה | קינג געתון בע"מ, קינג געתון בעמ |
| קינג קונג רעננה | אטפה בע"מ, אטפה בע"מ (קינג קונג רעננה) |

---

## ספקי PDF (לא פעילים)

הספקים הבאים שולחים קבצים סרוקים ומעובדים ידנית:

| ספק | סוג קובץ | הערות |
|-----|----------|-------|
| וונג שו | PDF סרוק | 39KB |
| טרז פזוס | PDF סרוק | 29KB |
| דגי הקיבוצים | 18 קבצי PDF | accountManagerReport_[UUID].pdf |

---

## קבצי מקור

| קובץ | תיאור |
|------|-------|
| `raw_data/ספקים טבלה עמלות רשת.xlsx` | טבלת אחוזי עמלה ותדירויות |
| `raw_data/raw_files_suppliers/קבצים לעמלות רשת/` | קבצי דוגמה לכל ספק |

---

## שינויים ועדכונים

| תאריך | שינוי |
|-------|-------|
| 2026-01-14 | יצירת המסמך הראשוני |
