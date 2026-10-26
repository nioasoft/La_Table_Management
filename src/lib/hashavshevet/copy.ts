/** Hebrew UI copy for the Hashavshevet send feature. All user-facing strings live here. */
import type { HConnectPlugin } from "@/lib/hconnect";
import type { RowStatus } from "./classify";
import { STALE_PENDING_MINUTES, type ExportType, type HConnectOutcome, type SendStatus } from "./types";

type ApiErrorCode = Extract<HConnectOutcome, { kind: "api_error" }>["code"];

export function formatShekel(n: number): string {
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
  arrived: "סימון שהגיעה לחשבשבת",
};

export const copy = {
  noCompany: "לזכיין אין חברה בחשבשבת",
  notLive: (companyName: string) => `החברה ${companyName} עדיין לא מופעלת לשליחה`,
  beforeLive: "התקופה קודמת לתאריך ההתחלה של החברה, והיא כבר יוצאה באקסל",
  dataChanged: "הנתונים השתנו מאז התצוגה המקדימה. רעננו ובדקו שוב",
  /** `chunks` = requests sent; each one may land as its own temporary batch (spec §7, §13). */
  sentAwaitingApproval: (count: number, total: number, companyName: string, chunks: number) =>
    `נשלחו ${count} שורות בסך ${formatShekel(total)} לחברה ${companyName}. המנה ממתינה לאישור בחשבשבת (זמני)` +
    (chunks > 1 ? `. השליחה חולקה ל-${chunks} בקשות, וכל אחת עשויה להופיע כמנה זמנית נפרדת` : ""),
  sentApproved: (count: number, total: number, companyName: string, chunks: number) =>
    `נשלחו ${count} שורות בסך ${formatShekel(total)} לחברה ${companyName}` + (chunks > 1 ? ` ב-${chunks} בקשות` : ""),
  unknownOutcome: "לא ידוע אם השליחה הגיעה. בדקו באזור הזמני בחשבשבת",
  /** Ruling R27: the rows went out and were approved, but marking them exported in the system failed. */
  approvedBookkeepingFailed: "השורות הגיעו לחשבשבת, אבל סימון הייצוא במערכת נכשל. פנו לתמיכה עם פרטי השליחה",
  sendConflict: "השורות האלה כבר נשלחות או נשלחו ממקום אחר. רעננו ובדקו שוב",
  sendBlocked: "יש שגיאות שחוסמות את השליחה. תקנו אותן ונסו שוב",
  rateLimited: "יותר מדי שליחות בזמן קצר. נסו שוב בעוד דקה",
  sendTimeBudgetExceeded: "נגמר הזמן לבקשה הזו, ולכן חלק מהשורות לא נשלחו. הן לא נעולות, ואפשר לשלוח אותן שוב",
  /** H-Connect's per-row reason is technical English (field: reason); shown as-is behind a Hebrew lead. */
  rowRejected: (detail: string) => `חשבשבת דחתה את השורה: ${detail}`,
  noCommissionInvoices: "אין חשבוניות עמלה לתקופה הנבחרת",
  zeroCommissionInvoice: (invoiceNumber: string | null, clientName: string, franchiseeName: string) =>
    `חשבונית עמלה ${invoiceNumber || "ללא מספר"} של ${clientName} (${franchiseeName}) בסכום 0.00, ולכן אי אפשר לשלוח אותה. בדקו את הסכום`,
  /** A built row the API cannot take: amount rounds to 0.00, or no API mapping (empty apiRow). */
  unsendableRow: (label: string) =>
    `אי אפשר לשלוח את השורה ${label}: הסכום שלה 0.00 או שחסרים בה נתונים לחשבשבת. בדקו את הנתונים`,
  unsupportedJournalDocType: "סוג מסמך 1 (פקודת יומן) בעמלות לקוחות עדיין לא נתמך לשליחה",
  invalidRequest: "הבקשה אינה תקינה",
  serverError: (requestId: string) => `אירעה שגיאה בשרת. מספר בקשה: ${requestId}`,
  companyNotFound: "החברה לא נמצאה",
  mappingTargetNotFound: "המותג, הזכיין או החברה לא נמצאו",
  sendNotFound: "השליחה לא נמצאה",
  /** The row is missing, already open, or its send is not approved yet (spec §9). */
  rowNotLocked: "אפשר לפתוח רק שורה נעולה של שליחה שאושרה. רעננו ובדקו שוב",
  /** The send is in `currentStatus`, which does not allow `outcome` (spec lifecycle box). */
  invalidTransition: (outcome: ResolveOutcomeKey, currentStatus: SendStatus) =>
    currentStatus === "pending"
      ? `אי אפשר לבצע ${resolveOutcomeLabels[outcome]} כל עוד השליחה מתבצעת. המתינו לסיום השליחה או עד שיעברו ${STALE_PENDING_MINUTES} דקות, ורעננו`
      : `אי אפשר לבצע ${resolveOutcomeLabels[outcome]} כשהשליחה ${sendStatusLabels[currentStatus]}. רעננו ובדקו שוב`,
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

/** The send button and its preview dialog (spec §9). */
export const previewCopy = {
  sendButton: "שלח לחשבשבת",
  sendLabel: (what: string) => `שלח ${what} לחשבשבת`,
  /** What the reconciliation page's by-franchisee send buttons send (the `what` of sendLabel). */
  byFranchiseeSendWhat: { franchisee_client_invoices: "חשבוניות", journal_entries: "תנועות יומן" },
  dialogTitle: (exportType: ExportType) => `שליחה לחשבשבת: ${exportLabels[exportType]}`,
  dialogDescription: "בדקו את השורות. שום דבר לא נשלח עד הלחיצה על שלח",
  loading: "טוען תצוגה מקדימה…",
  loadFailed: "טעינת התצוגה המקדימה נכשלה. נסו שוב",
  requestFailed: "הבקשה נכשלה. בדקו את החיבור ונסו שוב",
  /** M9: the send got no answer, so it may have gone out. Never "retry": check first. */
  sendOutcomeUnknown: `${copy.unknownOutcome} ובמסך "שליחות לחשבשבת" לפני ששולחים שוב`,
  empty: "אין מה לשלוח",
  emptyHint: "לא נמצאו שורות לתקופה או לסינון שנבחרו",
  retry: "נסו שוב",
  refresh: "רענן",
  send: "שלח",
  sending: "שולח…",
  close: "סגור",
  requiresApprovalNote: "המנה תיכנס לזמני ותחכה לאישורך בחשבשבת",
  noCompanyGroup: "ללא חברה",
  unknownCompany: "לא מזוהה",
  statusColumn: "סטטוס",
  amountColumn: "סכום",
  groupSummary: (count: number, total: number) => `${count} שורות חדשות, סה"כ ${formatShekel(total)}`,
  grandTotal: (count: number, total: number) => `סה"כ לשליחה: ${count} שורות, ${formatShekel(total)}`,
  blockingTitle: "מה חוסם את השליחה",
  resultTitle: "תוצאת השליחה",
  nothingToSend: "אין שורות חדשות לשליחה",
  someCompaniesNotLive: "יש שורות לחברה שעדיין לא מופעלת לשליחה",
  unknownSender: "משתמש לא ידוע",
  notSent: "לא נשלחה",
  sentBy: (when: string, who: string) => `נשלחה ב-${when} על ידי ${who}`,
  changedAmount: (oldAmount: string, newAmount: string) => `נשלח ${oldAmount}, עכשיו ${newAmount}`,
  rowStatus: {
    new: "חדשה",
    sent: "נשלחה",
    changed: "השתנתה",
    before_live: "לפני ההפעלה",
    no_company: "אין חברה",
    not_live: "החברה לא מופעלת",
  } satisfies Record<RowStatus, string>,
} as const;

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

/** The settings screen (spec §9, §7 ניהול): companies, activation and mappings. */
export const settingsCopy = {
  title: "חשבשבת",
  subtitle: "חברות בחשבשבת, תאריך הפעלת השליחה ושיוך מותגים וזכיינים לחברה",
  readOnlyNote: "רק משתמש-על יכול לערוך את ההגדרות. אתם במצב צפייה",
  loading: "טוען הגדרות…",
  loadFailed: "טעינת ההגדרות נכשלה. נסו שוב",
  retry: "נסו שוב",
  saved: "השינוי נשמר",
  saveFailed: "השמירה נכשלה. נסו שוב",
  companiesTitle: "חברות",
  companiesEmpty: "אין חברות מוגדרות בחשבשבת",
  fileColumn: "קובץ",
  compIdColumn: "מספר חברה",
  nameColumn: "שם",
  statusColumn: "סטטוס",
  approvalColumn: "דורשת אישור",
  actionsColumn: "פעולות",
  approvalHint: "כשמופעל, כל שליחה ממתינה לאישור שלך בחשבשבת",
  statusLive: (date: string) => `פעילה מ-${date}`,
  statusOff: "לא מופעלת",
  activate: "הפעל שליחה",
  deactivate: "כבה",
  activateTitle: (companyName: string) => `הפעלת שליחה: ${companyName}`,
  activateDescription: "תקופות שקודמות לתאריך הזה כבר יוצאו באקסל ולא יישלחו. מהתאריך הזה ואילך הייצוא יישלח לחשבשבת",
  activateDateLabel: "פעילה מתאריך",
  activateConfirm: "הפעל",
  deactivateTitle: (companyName: string) => `כיבוי שליחה: ${companyName}`,
  deactivateDescription: "אחרי הכיבוי אי אפשר יהיה לשלוח לחברה הזו, והייצוא ימשיך להיות באקסל. שליחות שכבר נשלחו לא מושפעות",
  deactivateConfirm: "כבה שליחה",
  cancel: "ביטול",
  mappingsTitle: "שיוך לחברה בחשבשבת",
  mappingsHint: "עמלות ספקים ותמלוגים נשלחים לפי החברה של המותג, וכל שאר הייצואים לפי החברה של הזכיין. בלי חברה אי אפשר לשלוח",
  brandsTitle: "מותגים",
  brandsEmpty: "אין מותגים לשיוך",
  franchiseesTitle: "זכיינים פעילים",
  franchiseesEmpty: "אין זכיינים פעילים",
  brandColumn: "מותג",
  franchiseeColumn: "זכיין",
  companyColumn: "חברה בחשבשבת",
  noCompany: "ללא חברה בחשבשבת",
  pickCompany: "בחרו חברה",
} as const;

/**
 * Releasing a send's rows (reject / "לא הגיע") lets them be sent again, so nothing of this send may
 * stay in Hashavshevet: not in the temporary area, and not as a .dat that Masofon2 picks up again.
 */
const CLEAN_UP_SEND =
  "מחקו מהאזור הזמני בחשבשבת כל מה שהגיע מהשליחה הזו, וודאו שלא נשאר קובץ .dat שלה בתיקייה C:\\hash7\\Hconnect (מסופון 2 קולט שוב קבצים שנשארו שם)";

/** An unknown or stuck send: what may have arrived, and what to do before each answer. */
const DID_IT_ARRIVE =
  'בשליחה של כמה בקשות ייתכן שהבקשות הראשונות הגיעו גם אם האחרונה לא. בדקו באזור הזמני בחשבשבת. אם השליחה הגיעה, בחרו "הגיע" והיא תעבור לאישור. ' +
  `לפני שבוחרים "לא הגיע", ${CLEAN_UP_SEND}`;

/** The sends screen (spec §9): Reut's approval queue, history and the send detail. */
export const sendsCopy = {
  title: "שליחות לחשבשבת",
  subtitle: "אישור ודחייה של מנות זמניות, והיסטוריית כל השליחות",
  loading: "טוען שליחות…",
  loadFailed: "טעינת השליחות נכשלה. נסו שוב",
  retry: "נסו שוב",
  emptyTitle: "אין שליחות",
  emptyHint: 'שליחות שייצאו מכפתורי "שלח לחשבשבת" יופיעו כאן',
  queueTitle: "ממתינות לאישור",
  queueHint: "השוו את מספר השורות והסכום למנה הזמנית בחשבשבת לפני האישור",
  queueEmpty: "אין שליחות שממתינות לאישור",
  historyTitle: "היסטוריה",
  historyEmpty: "אין שליחות בהיסטוריה",
  historyFilteredEmpty: "אין שליחות שמתאימות לסינון",
  allOption: "הכול",
  statusFilter: "סטטוס",
  companyFilter: "חברה",
  exportFilter: "סוג ייצוא",
  companyColumn: "חברה",
  exportColumn: "ייצוא",
  periodColumn: "תקופה",
  rowsColumn: "שורות",
  totalColumn: 'סה"כ',
  sentColumn: "נשלחה",
  statusColumn: "סטטוס",
  noPeriod: "—",
  rowsCount: (count: number) => `${count} שורות`,
  sentBy: (when: string, who: string | null) => (who ? `נשלחה ב-${when} על ידי ${who}` : `נשלחה ב-${when}`),
  approve: "אישרתי בחשבשבת",
  reject: "דחיתי",
  arrived: "הגיע",
  notArrived: "לא הגיע",
  unknownNote: `לא ידוע אם השליחה הגיעה. ${DID_IT_ARRIVE}`,
  staleWarning: `השליחה נתקעה לפני שחזרה תשובה. ${DID_IT_ARRIVE}`,
  resolved: "השליחה עודכנה",
  resolveFailed: "העדכון נכשל. נסו שוב",
  rejectTitle: "דחיית שליחה",
  rejectDescription: `לפני הדחייה ${CLEAN_UP_SEND}. אחר כך שורות השליחה ישוחררו ויהיה אפשר לשלוח אותן שוב`,
  noteLabel: "הערה (חובה)",
  notePlaceholder: "מה לא תקין בשליחה?",
  notArrivedPlaceholder: "מה בדקתם? למשל: האזור הזמני ריק ואין קובץ .dat בתיקייה",
  rejectConfirm: "דחה ושחרר שורות",
  cancel: "ביטול",
  detailTitle: "פרטי שליחה",
  detailDescription: "השורות שננעלו, התשובה של חשבשבת ופתיחה של שורות נעולות",
  details: "פרטים",
  sentOn: "נשלחה",
  resolutionNote: "הערת טיפול",
  detailLoading: "טוען פרטי שליחה…",
  detailLoadFailed: "טעינת פרטי השליחה נכשלה. נסו שוב",
  close: "סגור",
  fileLabel: "קובץ בחשבשבת",
  rowsTitle: "שורות",
  noRows: "אין שורות לשליחה הזו",
  rowKeyColumn: "מפתח שורה",
  amountColumn: "סכום",
  lockColumn: "מצב",
  rowActionColumn: "פעולה",
  rowLocked: "נעולה",
  rowReleased: "נפתחה",
  releasedBy: (reason: string, who: string | null) => (who ? `${reason} (${who})` : reason),
  payloadToggle: "השורה כפי שנשלחה",
  responseTitle: "תשובת חשבשבת (גולמית)",
  noResponse: "לא נשמרה תשובה לשליחה הזו",
  unlockRow: "פתח שורה",
  unlockTitle: "פתיחת שורה",
  unlockDescription: "השורה תשוחרר ויהיה אפשר לשלוח אותה שוב. הפעולה נרשמת עם שמך והסיבה",
  unlockReasonLabel: "סיבה (חובה)",
  unlockReasonPlaceholder: "למה לפתוח את השורה?",
  unlockConfirm: "פתח שורה",
  unlocked: "השורה נפתחה",
  unlockFailed: "פתיחת השורה נכשלה. נסו שוב",
  releasedAutomatically: "לא הגיעה לחשבשבת, שוחררה אוטומטית",
  rejectedWithNote: (note: string) => `נדחתה: ${note}`,
} as const;
