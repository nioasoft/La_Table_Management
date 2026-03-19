# הגדרת קבלת מיילים מלקוחות — Cloudflare + Resend Inbound

## סקירה

המערכת צריכה לקבל מיילים מלקוחות (סיבוס, תן-ביס, וולט וכו') ולעבד אותם אוטומטית.
הזרימה: **לקוח שולח מייל → Cloudflare Email Routing → Resend Inbound → Webhook → המערכת**

---

## שלב 1: הגדרת סאבדומיין ל-Resend Inbound

Resend Inbound דורש MX records משלו. כי ה-MX של `latable.co.il` כבר מוגדר ל-Cloudflare (ומשם ל-Gmail),
ניצור סאבדומיין ייעודי: **`inbound.latable.co.il`**

### ב-Cloudflare Dashboard:
1. היכנס ל-**DNS** → **Records**
2. הוסף 2 רשומות MX לסאבדומיין `inbound`:

| Type | Name | Mail server | Priority |
|------|------|-------------|----------|
| MX | `inbound` | `mx1.resend.com` | 10 |
| MX | `inbound` | `mx2.resend.com` | 20 |

> **חשוב**: אל תשנה את ה-MX של `latable.co.il` עצמו — רק של הסאבדומיין `inbound`.

---

## שלב 2: הגדרת Resend Inbound

### ב-Resend Dashboard (resend.com):
1. היכנס ל-**Receiving** (בתפריט הצדדי)
2. לחץ **Add Domain**
3. הזן: `inbound.latable.co.il`
4. Resend יבקש לאמת את ה-MX records — לחץ **Verify**
5. אחרי אימות, תוכל לקבל מיילים לכל כתובת `@inbound.latable.co.il`

---

## שלב 3: הגדרת Webhook ב-Resend

### ב-Resend Dashboard:
1. היכנס ל-**Webhooks** → **Create Webhook**
2. הגדר:
   - **Endpoint URL**: `https://www.latable.co.il/api/clients/email-inbound`
   - **Events**: סמן `email.received`
3. **העתק את ה-Webhook Secret** (מתחיל ב-`whsec_`) — תצטרך אותו ב-`.env`

---

## שלב 4: הגדרת Email Routing ב-Cloudflare

עכשיו נגדיר ש-Cloudflare יעביר מיילים מלקוחות ספציפיים לסאבדומיין של Resend.

### ב-Cloudflare Dashboard → Email → Email Routing:

**אופציה א' — כתובת ייעודית (מומלץ):**
1. צור כתובת `reports@latable.co.il`
2. הגדר Routing Rule:
   - **Match**: `reports@latable.co.il`
   - **Action**: Forward to `reports@inbound.latable.co.il`
3. בקש מהלקוחות לשלוח דוחות ל-`reports@latable.co.il`

**אופציה ב' — לפי שולח (בלי לשנות כתובת):**
1. צור Routing Rules לפי שולח:
   - **Match**: From `noreply@notifications.pluxee.co.il` → Forward to `cibus@inbound.latable.co.il`
   - **Match**: From `*@10bis.co.il` → Forward to `tenbis@inbound.latable.co.il`
   - **Match**: From `*@wolt.com` → Forward to `wolt@inbound.latable.co.il`
   - וכו' לכל לקוח
2. המיילים ממשיכים להגיע גם ל-Gmail (Cloudflare יכול להעביר לשני יעדים)

> **שים לב**: ב-Cloudflare Email Routing צריך ש-Destination address יהיה מאומת.
> ל-Resend Inbound address אין צורך באימות כי ה-MX שלהם כבר מוגדר.

---

## שלב 5: הגדרת משתני סביבה

הוסף ל-`.env`:
```
# Resend Inbound Webhook
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxx
```

ודא שכבר יש לך:
```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
```

---

## שלב 6: פיתוח (אני אבנה את זה)

אחרי שהכל מוגדר, אבנה:
1. **Webhook endpoint** — `POST /api/clients/email-inbound` שמקבל את ה-webhook מ-Resend
2. **Email parser** — מזהה את הלקוח לפי שולח/נושא/כתובת
3. **Attachment downloader** — מוריד קבצים מצורפים דרך Resend API
4. **Pipeline integration** — מעביר ל-`processClientDocument()` (אותו pipeline כמו העלאה ידנית)

---

## פורמט ה-Webhook

כשמגיע מייל, Resend שולח POST עם:
```json
{
  "type": "email.received",
  "data": {
    "email_id": "56761188-7520-42d8-8898-ff6fc54ce618",
    "from": "noreply@notifications.pluxee.co.il",
    "to": ["cibus@inbound.latable.co.il"],
    "subject": "ריכוז חיוב חודשי - קינג קונג ביג קריות - חיפה",
    "attachments": [
      {
        "id": "...",
        "filename": "report.pdf",
        "content_type": "application/pdf"
      }
    ]
  }
}
```

> **חשוב**: גוף המייל והקבצים לא נשלחים ב-webhook — צריך לשלוף אותם דרך Resend API בנפרד
> (עם ה-`email_id`). URL להורדה תקף ל-7 ימים.

---

## בדיקה

1. שלח מייל ל-`reports@inbound.latable.co.il` (ישירות) — צריך להגיע ל-Resend
2. שלח מייל ל-`reports@latable.co.il` — צריך לעבור דרך Cloudflare → Resend
3. בדוק ב-Resend Dashboard → Receiving שהמייל הגיע
4. בדוק ב-Resend Dashboard → Webhooks → Logs שה-webhook נשלח

---

## עלויות

| שירות | עלות |
|-------|------|
| Cloudflare Email Routing | **חינם** |
| Resend Inbound | **חינם** (ללא הגבלה על קבלה) |
| Resend API (שליפת גוף/קבצים) | כלול ב-API quota |

---

## צ'קליסט

- [ ] הוסף MX records ל-`inbound.latable.co.il` ב-Cloudflare DNS
- [ ] הגדר דומיין ב-Resend Receiving
- [ ] אמת את הדומיין ב-Resend
- [ ] צור Webhook ב-Resend עם endpoint + events
- [ ] הוסף `RESEND_WEBHOOK_SECRET` ל-`.env`
- [ ] הגדר Email Routing rules ב-Cloudflare
- [ ] שלח מייל בדיקה ובדוק שה-webhook מגיע
- [ ] תאמר לי שהכל עובד ואני אבנה את ה-endpoint 😄
