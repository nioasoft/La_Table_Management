interface BackupEmailParams {
  date: string;
  sizeBytes: number;
  downloadUrl: string;
  retentionDays: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatHebrewDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function renderBackupEmailHtml(params: BackupEmailParams): string {
  const { date, sizeBytes, downloadUrl, retentionDays } = params;
  const hebrewDate = formatHebrewDate(date);
  const sizeFormatted = formatBytes(sizeBytes);

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>גיבוי מסד נתונים יומי</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;direction:rtl;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#1f2937;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;text-align:right;">
                גיבוי מסד נתונים יומי
              </h1>
              <p style="margin:8px 0 0;color:#9ca3af;font-size:14px;text-align:right;">
                La Table Management
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.6;text-align:right;">
                שלום,
              </p>
              <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.6;text-align:right;">
                הגיבוי היומי של מסד הנתונים הושלם בהצלחה. להלן פרטי הגיבוי:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:6px;margin:0 0 24px;">
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;text-align:right;width:140px;">
                    תאריך
                  </td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right;">
                    ${hebrewDate}
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;text-align:right;">
                    גודל קובץ
                  </td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right;">
                    ${sizeFormatted}
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;color:#6b7280;font-size:14px;text-align:right;">
                    סטטוס
                  </td>
                  <td style="padding:12px 16px;color:#059669;font-size:14px;font-weight:600;text-align:right;">
                    ✓ הצלחה
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 0 16px;">
                    <a href="${downloadUrl}"
                       style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:600;">
                      הורד את הגיבוי
                    </a>
                  </td>
                </tr>
              </table>
              <div style="background-color:#fef3c7;border-right:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin:24px 0 0;">
                <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;text-align:right;">
                  <strong>אזהרה:</strong> הקישור מאפשר גישה לכל נתוני המערכת. אנא שמור עליו פרטי ואל תעביר לאחרים.
                  הקישור תקף ל-${retentionDays} ימים, לאחר מכן הקובץ נמחק אוטומטית.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#6b7280;font-size:12px;text-align:center;">
                מייל זה נשלח אוטומטית מ-
                <a href="https://www.latable.co.il" style="color:#2563eb;text-decoration:none;">www.latable.co.il</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderBackupEmailText(params: BackupEmailParams): string {
  const { date, sizeBytes, downloadUrl, retentionDays } = params;
  return [
    `גיבוי מסד נתונים יומי - La Table Management`,
    ``,
    `תאריך: ${formatHebrewDate(date)}`,
    `גודל קובץ: ${formatBytes(sizeBytes)}`,
    `סטטוס: הצלחה`,
    ``,
    `קישור הורדה: ${downloadUrl}`,
    ``,
    `אזהרה: הקישור מאפשר גישה לכל נתוני המערכת. הקישור תקף ל-${retentionDays} ימים.`,
  ].join("\n");
}
