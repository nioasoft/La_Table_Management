-- ממתי ספק לא פעיל: תקופות שהתחילו לפני התאריך עדיין חייבות דוח
ALTER TABLE "supplier"
  ADD COLUMN IF NOT EXISTS "inactive_from" date;
