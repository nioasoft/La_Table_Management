/**
 * Hebrew Translation Constants for Email Templates
 *
 * This file contains all translation strings for the email templates
 * used in the La Table Management System.
 *
 * "LaTable" brand name remains in English throughout.
 *
 * Organization:
 * - common: Shared strings across email templates
 * - layout: Email layout component strings
 * - fileRequest: File request email template
 * - supplierRequest: Supplier sales report request email
 * - franchiseeRequest: Franchisee document request email
 * - reminder: Reminder email template
 * - custom: Custom email template
 * - uploadNotification: Upload notification email template
 */

export const emailTranslations = {
  // ==========================================================================
  // COMMON - Shared strings across email templates
  // ==========================================================================
  common: {
    // Salutations
    dear: "שלום",
    dearWithName: "שלום {name},",

    // Sign-offs
    bestRegards: "בברכה,",
    team: "צוות {brandName}",
    managementTeam: "צוות הנהלת {brandName}",
    system: "מערכת {brandName}",

    // Common phrases
    deadline: "תאריך יעד",
    submitBy: "נא להגיש עד:",
    period: "תקופה",
    contactSupport: "לשאלות או עזרה, אנא פנו לצוות התמיכה שלנו.",
    contactAccountManager: "לשאלות או עזרה, אנא פנו למנהל החשבון שלכם.",
    contactUs: "לשאלות או עזרה, אנא צרו קשר.",

    // Entity types
    entityTypes: {
      supplier: "ספק",
      franchisee: "זכיין",
      brand: "מותג",
    },
  },

  // ==========================================================================
  // LAYOUT - Email layout component strings
  // ==========================================================================
  layout: {
    footerText: "LaTable Management",
    autoEmailNotice: "הודעה זו נשלחה אוטומטית. אנא אל תשיבו ישירות להודעה זו.",
  },

  // ==========================================================================
  // FILE REQUEST - File/document request email template
  // ==========================================================================
  fileRequest: {
    // Subject lines
    subjectRequest: "בקשת קובץ: {documentType} - {entityName}",
    subjectReminder: "תזכורת: נדרש {documentType} - {entityName}",

    // Badge
    reminderBadge: "תזכורת",

    // Headings
    headingRequest: "בקשת מסמך",
    headingReminder: "תזכורת: בקשת מסמך",

    // Body text
    requestMessage:
      "אנו מבקשים בזאת שתעלו את המסמך הבא: {documentType} עבור {entityName}.",
    reminderMessage:
      "זוהי תזכורת ידידותית שעדיין ממתינים להגשת המסמך {documentType} עבור {entityName}.",

    // Button
    uploadButton: "העלה מסמך",

    // Help text
    helpText:
      "לחצו על הכפתור למעלה להעלאת המסמך באופן מאובטח. הקישור יפוג תוקפו אוטומטית מטעמי אבטחה.",
  },

  // ==========================================================================
  // SUPPLIER REQUEST - Supplier sales report request email
  // ==========================================================================
  supplierRequest: {
    // Subject
    subject: "בקשת דוח מכירות - {period}",

    // Heading
    heading: "בקשת דוח מכירות",

    // Body text
    requestMessage:
      "אנו מבקשים בזאת שתגישו את דוח המכירות שלכם עבור {brandName} לתקופה {period}.",
    submitBy: "נא להגיש את הדוח עד {deadline}.",

    // Button
    uploadButton: "העלה דוח",
  },

  // ==========================================================================
  // FRANCHISEE REQUEST - Franchisee document request email
  // ==========================================================================
  franchiseeRequest: {
    // Subject
    subject: "בקשת מסמכים לתקופה {period}",

    // Heading
    heading: "בקשת העלאת מסמכים",

    // Body text
    requestMessage:
      "כחלק ממחזור הדיווח הרגיל ב-{brandName}, אנו מבקשים שתעלו את המסמכים הנדרשים לתקופה {period}.",
    deadlineLabel: "תאריך יעד:",

    // Info box
    infoBoxText:
      "אנא ודאו שכל המסמכים מדויקים ומלאים לפני ההגשה. הגשות חלקיות עשויות לדרוש מעקב נוסף.",

    // Button
    uploadButton: "העלה מסמכים",

    // Help text
    helpText:
      "אם נתקלתם בבעיות בתהליך ההעלאה או יש לכם שאלות לגבי המסמכים הנדרשים, אנא פנו לצוות התמיכה שלנו.",
  },

  // ==========================================================================
  // REMINDER - Reminder email template
  // ==========================================================================
  reminder: {
    // Subject
    subject: "תזכורת: הגשת מסמכים לתקופה {period}",

    // Badge
    reminderBadge: "תזכורת",

    // Heading
    heading: "הגשת מסמכים ממתינה",

    // Body text
    reminderMessage:
      "זוהי תזכורת ידידותית שעדיין ממתינים להגשת המסמכים שלכם עבור {brandName} לתקופה {period}.",
    deadlineLabel: "תאריך יעד",
    urgentMessage: "כדי למנוע עיכובים בעיבוד, אנא הגישו את המסמכים בהקדם האפשרי באמצעות הקישור למטה.",

    // Button
    submitButton: "הגש מסמכים עכשיו",

    // Small text / disclaimer
    disclaimerText:
      "אם כבר הגשתם את המסמכים, אנא התעלמו מתזכורת זו. לשאלות או עזרה, פנו לצוות התמיכה שלנו.",
  },

  // ==========================================================================
  // CUSTOM - Custom email template
  // ==========================================================================
  custom: {
    // Default subject
    defaultSubject: "הודעה מותאמת אישית",

    // Default body (when no custom body provided)
    defaultGreeting: "שלום {entityName},",
    defaultMessage: "הודעה זו נוגעת ל-{brandName} לתקופה {period}.",
    deadlineLabel: "תאריך יעד:",

    // Button
    viewDetailsButton: "צפה בפרטים",
  },

  // ==========================================================================
  // UPLOAD NOTIFICATION - Upload notification email template
  // ==========================================================================
  uploadNotification: {
    // Subject
    subject: "קובץ חדש הועלה: {fileName} - {entityName}",

    // Badge
    newUploadBadge: "העלאה חדשה",

    // Heading
    heading: "הודעה על העלאת קובץ",

    // Body text
    introMessage: "קובץ חדש הועלה באמצעות קישור מאובטח. להלן הפרטים:",

    // Detail labels
    details: {
      entity: "ישות:",
      fileName: "שם קובץ:",
      fileSize: "גודל קובץ:",
      uploadedBy: "הועלה ע״י:",
      uploadDate: "תאריך העלאה:",
    },

    // Button
    reviewButton: "בדוק ועבד קובץ",

    // Help text
    helpText: "לחצו על הכפתור למעלה לבדיקה ועיבוד הקובץ שהועלה במערכת.",
  },
} as const;

// Type export for the email translations object
export type EmailTranslations = typeof emailTranslations;

/**
 * Helper function to get email translation with interpolation.
 *
 * @param template - The translation string with {variable} placeholders
 * @param params - Object containing variable values
 * @returns The interpolated string
 *
 * @example
 * interpolateEmail("שלום {name}!", { name: "יוסי" }) // "שלום יוסי!"
 * interpolateEmail(emailTranslations.fileRequest.subjectRequest, { documentType: "חשבונית", entityName: "ספק א" })
 */
export function interpolateEmail(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (key in params) {
      return String(params[key]);
    }
    // Return original placeholder if param not found
    return match;
  });
}

/**
 * Helper to build email subject lines.
 */
export const emailSubjects = {
  fileRequest: (
    documentType: string,
    entityName: string,
    isReminder: boolean = false
  ): string => {
    const template = isReminder
      ? emailTranslations.fileRequest.subjectReminder
      : emailTranslations.fileRequest.subjectRequest;
    return interpolateEmail(template, { documentType, entityName });
  },

  supplierRequest: (period: string): string => {
    return interpolateEmail(emailTranslations.supplierRequest.subject, {
      period,
    });
  },

  franchiseeRequest: (period: string): string => {
    return interpolateEmail(emailTranslations.franchiseeRequest.subject, {
      period,
    });
  },

  reminder: (period: string): string => {
    return interpolateEmail(emailTranslations.reminder.subject, { period });
  },

  uploadNotification: (fileName: string, entityName: string): string => {
    return interpolateEmail(emailTranslations.uploadNotification.subject, {
      fileName,
      entityName,
    });
  },
};

/**
 * Helper to build sign-off text.
 */
export const emailSignOff = {
  team: (brandName: string): string => {
    return interpolateEmail(emailTranslations.common.team, { brandName });
  },

  managementTeam: (brandName: string): string => {
    return interpolateEmail(emailTranslations.common.managementTeam, {
      brandName,
    });
  },

  system: (brandName: string): string => {
    return interpolateEmail(emailTranslations.common.system, { brandName });
  },
};
