/** Hebrew UI copy for the Hashavshevet send feature. All user-facing strings live here. */
import type { HConnectPlugin } from "@/lib/hconnect";
import type { ExportType, HConnectOutcome, SendStatus } from "./types";

type ApiErrorCode = Extract<HConnectOutcome, { kind: "api_error" }>["code"];

function shekel(n: number): string {
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ResolveOutcomeKey = "approved" | "rejected" | "arrived";

/** Status as a predicate on "the send" ("...כשהשליחה ממתינה לאישור"); also the status chip text. */
export const sendStatusLabels: Record<SendStatus, string> = {
  pending: "בשליחה",
  awaiting_approval: "ממתינה לאישור",
  approved: "אושרה",
  rejected: "נדחתה",
  failed: "נכשלה",
  unknown: "במצב לא ידוע",
};

const resolveOutcomeLabels: Record<ResolveOutcomeKey, string> = {
  approved: "אישור",
  rejected: "דחייה",
  arrived: "סימון כהגיעה",
};

export const copy = {
  noCompany: "לזכיין אין חברה בחשבשבת",
  notLive: (companyName: string) => `החברה ${companyName} עדיין לא מופעלת לשליחה`,
  beforeLive: "התקופה קודמת לתאריך ההתחלה של החברה, והיא כבר יוצאה באקסל",
  dataChanged: "הנתונים השתנו מאז התצוגה המקדימה. רעננו ובדקו שוב",
  /** `chunks` = requests sent; each one may land as its own temporary batch (spec §7, §13). */
  sentAwaitingApproval: (count: number, total: number, companyName: string, chunks: number) =>
    `נשלחו ${count} שורות בסך ${shekel(total)} לחברה ${companyName}. המנה ממתינה לאישור בחשבשבת (זמני)` +
    (chunks > 1 ? `. השליחה חולקה ל-${chunks} בקשות, וכל אחת עשויה להופיע כמנה זמנית נפרדת` : ""),
  sentApproved: (count: number, total: number, companyName: string, chunks: number) =>
    `נשלחו ${count} שורות בסך ${shekel(total)} לחברה ${companyName}` + (chunks > 1 ? ` ב-${chunks} בקשות` : ""),
  unknownOutcome: "לא ידוע אם השליחה הגיעה. בדקו באזור הזמני בחשבשבת",
  sendConflict: "השורות האלה כבר נשלחות או נשלחו ממקום אחר. רעננו ובדקו שוב",
  sendBlocked: "יש שגיאות שחוסמות את השליחה. תקנו אותן ונסו שוב",
  rateLimited: "יותר מדי שליחות בזמן קצר. נסו שוב בעוד דקה",
  sendTimeBudgetExceeded: "נגמר הזמן לבקשה הזו, ולכן חלק מהשורות לא נשלחו. הן לא נעולות, ואפשר לשלוח אותן שוב",
  /** H-Connect's per-row reason is technical English (field: reason); shown as-is behind a Hebrew lead. */
  rowRejected: (detail: string) => `חשבשבת דחתה את השורה: ${detail}`,
  unsupportedJournalDocType: "סוג מסמך 1 (פקודת יומן) בעמלות לקוחות עדיין לא נתמך לשליחה",
  invalidRequest: "הבקשה אינה תקינה",
  serverError: (requestId: string) => `אירעה שגיאה בשרת. מספר בקשה: ${requestId}`,
  companyNotFound: "החברה לא נמצאה",
  mappingTargetNotFound: "המותג, הזכיין או החברה לא נמצאו",
  sendNotFound: "השליחה לא נמצאה",
  rowNotLocked: "השורה לא נמצאה או שכבר נפתחה",
  /** The send is in `currentStatus`, which does not allow `outcome` (spec lifecycle box). */
  invalidTransition: (outcome: ResolveOutcomeKey, currentStatus: SendStatus) =>
    `אי אפשר לבצע ${resolveOutcomeLabels[outcome]} כשהשליחה ${sendStatusLabels[currentStatus]}. רעננו ובדקו שוב`,
} as const;

/** Short Hebrew name of each export, for buttons, dialogs and the sends screen. */
export const exportLabels: Record<ExportType, string> = {
  supplier_commissions: "עמלות ספקים",
  royalties: "תמלוגים ושיווק",
  client_commissions: "עמלות לקוחות",
  franchisee_client_invoices: "חשבוניות לקוחות של זכיין",
  journal_entries: "פקודות יומן",
  client_commission_invoices: "חשבוניות עמלה מלקוחות",
};

/** Spec §10: Hebrew message for a rejected H-Connect call. */
export function apiErrorMessage(code: ApiErrorCode, plugin: HConnectPlugin, companyName: string): string {
  switch (code) {
    case "permission":
      return `אין הרשאה לממשק ${plugin} בחברה ${companyName}. בדקו את הגדרות H-Connect`;
    case "not_in_service":
      return "השרת של חשבשבת לא זמין. נסו שוב מאוחר יותר";
    case "validation":
      return "חשבשבת דחתה את השורות. ראו את השגיאה ליד כל שורה";
    case "other":
      return "חשבשבת דחתה את הבקשה. נסו שוב או פנו לתמיכה";
  }
}
