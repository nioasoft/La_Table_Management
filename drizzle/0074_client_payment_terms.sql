-- תנאי תשלום מול הלקוח (טקסט חופשי, כמו אצל הספקים)
ALTER TABLE "client"
  ADD COLUMN IF NOT EXISTS "payment_terms" text;
