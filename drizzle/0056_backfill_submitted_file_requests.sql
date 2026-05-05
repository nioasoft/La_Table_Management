-- Backfill file_request rows that were already fulfilled but never marked
-- "submitted" because markFileRequestAsSubmitted was wired but never called.
--
-- Two upload paths are matched:
--   1. Public upload link: uploaded_file.upload_link_id = fr.upload_link_id
--   2. Admin BKMV upload (no upload_link): uploaded_file.franchisee_id = fr.entity_id
--      AND uploaded_file.period_start_date >= file_request cycle start
--      AND uploaded_file.created_at >= fr.created_at
--
-- Without this backfill, the daily upload-reminders cron keeps sending
-- "תזכורת: קובץ מבנה אחיד BKMV טרם הועלה" to franchisee owners and
-- accountants even after the operations team has already uploaded the file.
UPDATE "file_request" AS fr
SET
  "status" = 'submitted',
  "submitted_at" = matched.matched_uploaded_at,
  "updated_at" = NOW()
FROM (
  SELECT
    fr.id AS fr_id,
    MIN(uf.created_at) AS matched_uploaded_at
  FROM "file_request" fr
  JOIN "uploaded_file" uf
    ON (
      -- Public upload path
      (uf.upload_link_id IS NOT NULL AND uf.upload_link_id = fr.upload_link_id)
      OR
      -- Admin BKMV upload path: franchisee + cycle period match
      (
        fr.entity_type = 'franchisee'
        AND fr.document_type = 'bkmv'
        AND uf.franchisee_id = fr.entity_id
        AND uf.created_at >= fr.created_at
        AND fr.metadata->>'startDate' IS NOT NULL
        AND uf.period_start_date IS NOT NULL
        AND uf.period_start_date >= TO_DATE(fr.metadata->>'startDate', 'DD/MM/YYYY')
      )
    )
  WHERE fr.status IN ('sent', 'in_progress')
  GROUP BY fr.id
) AS matched
WHERE fr."id" = matched.fr_id;
