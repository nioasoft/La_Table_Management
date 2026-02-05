/**
 * Hebrew Translation Constants for La Table Management System
 *
 * This file contains all UI string translations for the Hebrew localization.
 * "LaTable" brand name remains in English throughout.
 *
 * Organization:
 * - common: Shared strings used across multiple pages
 * - auth: Authentication pages (sign-in, sign-up, pending-approval)
 * - dashboard: Dashboard page and widgets
 * - admin: Admin management pages (users, suppliers, franchisees, brands, etc.)
 * - forms: Form labels, placeholders, and validation messages
 * - errors: Error messages
 * - status: Status labels and badges
 */

export const he = {
  // ==========================================================================
  // COMMON - Shared strings across the application
  // ==========================================================================
  common: {
    // Brand name - always English
    brandName: "LaTable",
    appTitle: "LaTable Management",
    appDescription: "מערכת ניהול זכיינות",

    // Navigation
    dashboard: "לוח בקרה",
    signOut: "התנתקות",
    signIn: "התחברות",
    signUp: "הרשמה",
    back: "חזור",
    next: "הבא",
    previous: "הקודם",
    cancel: "ביטול",
    save: "שמור",
    saving: "שומר...",
    update: "עדכן",
    create: "צור",
    delete: "מחק",
    edit: "ערוך",
    view: "צפה",
    viewDetails: "צפה בפרטים",
    viewAll: "צפה בהכל",
    refresh: "רענן",
    retry: "נסה שוב",
    close: "סגור",
    confirm: "אשר",
    search: "חיפוש",
    filter: "סינון",
    loading: "טוען...",
    processing: "מעבד...",
    noData: "אין נתונים",
    notApplicable: "לא רלוונטי",

    // Common labels
    name: "שם",
    email: "אימייל",
    phone: "טלפון",
    address: "כתובת",
    description: "תיאור",
    status: "סטטוס",
    role: "תפקיד",
    code: "קוד",
    notes: "הערות",
    date: "תאריך",
    createdAt: "נוצר בתאריך",
    updatedAt: "עודכן בתאריך",
    actions: "פעולות",

    // Yes/No
    yes: "כן",
    no: "לא",

    // Filters
    all: "הכל",
    active: "פעיל",
    inactive: "לא פעיל",

    // Formatting
    from: "מ-",
    to: "עד",
    of: "מתוך",
  },

  // ==========================================================================
  // AUTH - Authentication pages
  // ==========================================================================
  auth: {
    signIn: {
      title: "התחברות",
      description: "הזן את פרטי ההתחברות שלך",
      emailLabel: "אימייל",
      emailPlaceholder: "name@example.com",
      passwordLabel: "סיסמה",
      passwordPlaceholder: "הזן את הסיסמה שלך",
      submitButton: "התחבר",
      orContinueWith: "או המשך עם",
      continueWithGoogle: "המשך עם Google",
      noAccount: "אין לך חשבון?",
      signUpLink: "הירשם",
      errors: {
        invalidCredentials: "אימייל או סיסמה שגויים",
        unexpectedError: "אירעה שגיאה לא צפויה. נסה שוב.",
        googleError: "ההתחברות עם Google נכשלה. נסה שוב.",
      },
    },

    signUp: {
      title: "יצירת חשבון",
      description: "הזן את הפרטים שלך ליצירת חשבון",
      nameLabel: "שם",
      namePlaceholder: "השם שלך",
      emailLabel: "אימייל",
      emailPlaceholder: "name@example.com",
      passwordLabel: "סיסמה",
      passwordPlaceholder: "צור סיסמה",
      passwordHint: "הסיסמה חייבת להכיל לפחות 6 תווים",
      submitButton: "צור חשבון",
      orContinueWith: "או המשך עם",
      continueWithGoogle: "המשך עם Google",
      hasAccount: "כבר יש לך חשבון?",
      signInLink: "התחבר",
      errors: {
        signUpFailed: "ההרשמה נכשלה. נסה שוב.",
        unexpectedError: "אירעה שגיאה לא צפויה. נסה שוב.",
        googleError: "ההרשמה עם Google נכשלה. נסה שוב.",
      },
    },

    pendingApproval: {
      title: "החשבון ממתין לאישור",
      description: "החשבון שלך נוצר בהצלחה וממתין לאישור מנהל.",
      registrationComplete: "ההרשמה הושלמה",
      accountCreatedWith: "החשבון נוצר עם האימייל:",
      waitingMessage:
        "מנהל יבדוק את ההרשמה שלך ויפעיל את החשבון. תוכל לגשת ללוח הבקרה לאחר האישור.",
      takingTooLong:
        "אם אתה מאמין שזה לוקח יותר מדי זמן, אנא צור קשר עם המנהל.",
      checkStatus: "בדוק סטטוס אישור",
      signOut: "התנתק",
    },
  },

  // ==========================================================================
  // HOMEPAGE
  // ==========================================================================
  home: {
    title: "LaTable Management",
    subtitle: "ברוכים הבאים למערכת ניהול הזכיינות",
    secondarySubtitle: "מערכת ניהול זכיינות מסעדות",
    getStarted: "התחל עכשיו",
    learnMore: "למד עוד",
  },

  // ==========================================================================
  // DASHBOARD
  // ==========================================================================
  dashboard: {
    title: "לוח בקרה",

    // Profile card
    profile: {
      title: "פרופיל",
      description: "פרטי החשבון שלך",
      nameLabel: "שם",
      emailLabel: "אימייל",
      roleLabel: "תפקיד",
      statusLabel: "סטטוס",
    },

    // Welcome card
    welcome: {
      title: "ברוך הבא!",
      superUserMessage: "יש לך גישה מלאה למערכת",
      adminMessage: "יש לך גישת ניהול",
      defaultMessage: "ברוך הבא ל-LaTable Management",
      superUserDescription:
        "בתור משתמש על, אתה יכול לנהל משתמשים, לאשר הרשמות ולהגדיר את המערכת.",
      adminDescription:
        "בתור מנהל, אתה יכול לצפות ולנהל היבטים שונים של המערכת.",
      defaultDescription:
        "החשבון שלך פעיל ואתה יכול לגשת לתכונות המוקצות לך.",
    },

    // Administration card
    administration: {
      title: "ניהול",
      description: "גישה מהירה לתכונות ניהול",
      userManagement: "ניהול משתמשים",
      franchiseeManagement: "ניהול זכיינים",
      settlementApprovals: "אישורי התחשבנות",
    },

    // Franchisee owner card
    franchiseeOwner: {
      title: "הזכיינות שלי",
      description: "נהל את הזכיינות שלך",
      description2: "גש למידע ולדוחות של הזכיינות שלך.",
      viewDetails: "צפה בפרטים",
      comingSoon: "בקרוב",
    },

    // Dashboard widgets
    widgets: {
      loadingStats: "טוען סטטיסטיקות...",
      errorLoadingStats: "שגיאה בטעינת סטטיסטיקות",
      unableToLoad: "לא ניתן לטעון את סטטיסטיקות לוח הבקרה.",

      actionItems: {
        title: "פריטים לטיפול",
        description: "פריטים הדורשים את תשומת לבך",
        allCaughtUp: "הכל מעודכן! אין פריטים ממתינים.",

        pendingCrossReferences: "הפניות צולבות ממתינות",
        pendingCrossReferencesDesc: "פריטים ממתינים להשוואה",

        discrepancies: "פערים",
        discrepanciesDesc: "פריטים הדורשים בדיקה",

        awaitingApproval: "ממתין לאישור",
        awaitingApprovalDesc: "התחשבנויות ממתינות לבדיקה",
      },
    },

    // Upcoming reminders widget
    reminders: {
      title: "תזכורות קרובות",
      description: "אופציות שכירות, הסכמי זכיינות ותזכורות מותאמות",
      loadingReminders: "טוען תזכורות...",
      errorLoadingReminders: "שגיאה בטעינת תזכורות",
      unableToLoad: "לא ניתן לטעון תזכורות קרובות.",
      noReminders: "אין תזכורות קרובות!",
      pending: "ממתינות",
      thisWeek: "השבוע",
      thisMonth: "החודש",
      viewAllReminders: "צפה בכל {count} התזכורות",

      types: {
        leaseOption: "אופציית שכירות",
        franchiseAgreement: "הסכם זכיינות",
        custom: "מותאם אישית",
      },

      urgency: {
        overdue: "באיחור",
        dueSoon: "בקרוב",
        thisWeek: "השבוע",
        upcoming: "קרוב",
      },
    },

    // Commission settlement widget
    commissionSettlement: {
      title: "סטטוס עמלות והתחשבנות",
      description: "סקירת התקופה הנוכחית והתקדמות תהליך העבודה",
      loadingStatus: "טוען סטטוס תקופה...",
      errorLoadingStatus: "שגיאה בטעינת סטטוס",
      unableToLoad: "לא ניתן לטעון סטטוס עמלות והתחשבנות.",

      currentPeriod: {
        title: "תקופה נוכחית",
        noActivePeriod: "אין תקופה פעילה",
        daysRemaining: "ימים נותרים",
      },

      commissionSummary: {
        title: "עמלות התקופה",
        totalAmount: "סכום כולל",
        pending: "ממתין",
        approved: "מאושר",
        paid: "שולם",
      },

      workflow: {
        title: "תהליך התחשבנות",
        open: "פתוח",
        processing: "בעיבוד",
        pendingApproval: "ממתין",
        approved: "מאושר",
        done: "הושלם",
      },
    },

    // Upload status widget
    uploadStatus: {
      title: "סטטוס העלאות",
      description: "עקוב אחר מי העלה קבצים וקישורי העלאה ממתינים",
      loadingStatus: "טוען סטטוס העלאות...",
      errorLoadingStatus: "שגיאה בטעינת סטטוס העלאות",
      unableToLoad: "לא ניתן לטעון סטטוס העלאות.",

      stats: {
        totalEntities: "סה״כ ישויות",
        withUploads: "עם העלאות",
        pendingLinks: "קישורים ממתינים",
        expiringSoon: "יפוג בקרוב",
      },

      tabs: {
        overview: "סקירה כללית",
        suppliers: "ספקים",
        franchisees: "זכיינים",
      },

      sections: {
        pendingUploadLinks: "קישורי העלאה ממתינים",
        awaitingUploads: "ממתינים להעלאה",
        noUploadLinks: "לא נוצרו קישורי העלאה",
        awaitingUpload: "ממתין להעלאה",
        uploaded: "הועלה",
        noUploadLinksShort: "ללא קישורים",
      },

      expiry: {
        noExpiry: "ללא תפוגה",
        expired: "פג תוקף",
        expiresIn: "יפוג בעוד {days} ימים",
      },

      status: {
        uploaded: "הועלה",
        pending: "ממתין",
        expired: "פג תוקף",
        complete: "הושלם",
        noLinks: "ללא קישורים",
      },

      allComplete: "כל ההעלאות הושלמו!",
      noEntitiesFound: "לא נמצאו {entityType}",
    },

    // Period status widget - Settlement workflow overview
    periodStatus: {
      title: "סטטוס תקופה נוכחית",
      description: "סקירה כוללת של התקדמות תהליך ההתחשבנות",
      loadingStatus: "טוען סטטוס תקופה...",
      errorLoadingStatus: "שגיאה בטעינת סטטוס",
      unableToLoad: "לא ניתן לטעון סטטוס תקופה.",

      currentPeriod: {
        title: "תקופה נוכחית",
        noActivePeriod: "אין תקופה פעילה",
        daysRemaining: "ימים נותרים",
        daysElapsed: "ימים חלפו",
        statusOpen: "פתוח",
        statusProcessing: "בעיבוד",
      },

      reportStatus: {
        title: "סטטוס דוחות",
        overallReceived: "דוחות שהתקבלו",
        suppliers: "ספקים",
        franchisees: "זכיינים",
        missing: "דוחות חסרים",
        received: "התקבלו",
        total: "סה״כ",
      },

      crossReference: {
        title: "סטטוס התאמות",
        matchRate: "אחוז התאמה",
        matched: "תואמים",
        discrepancies: "פערים",
        pending: "ממתינים",
        total: "סה״כ",
      },

      pendingActions: {
        title: "פעולות ממתינות",
        allClear: "אין פעולות ממתינות!",
        highPriority: "עדיפות גבוהה",
        mediumPriority: "עדיפות בינונית",
        lowPriority: "עדיפות נמוכה",
      },

      actions: {
        discrepancy: "פערים לבדיקה",
        approval: "ממתין לאישור",
        missingReport: "דוחות חסרים",
        expiringLink: "קישורים יפוגו בקרוב",
      },

      workflow: {
        title: "התקדמות תהליך",
        open: "פתוח",
        processing: "בעיבוד",
        pendingApproval: "ממתין",
        approved: "מאושר",
        invoiced: "הושלם",
      },
    },
  },

  // ==========================================================================
  // ADMIN PAGES
  // ==========================================================================
  admin: {
    // User Management
    users: {
      title: "ניהול משתמשים",

      stats: {
        totalUsers: "סה״כ משתמשים",
        pendingApproval: "ממתינים לאישור",
        activeUsers: "משתמשים פעילים",
        suspended: "מושעים",
      },

      tabs: {
        all: "הכל",
        pending: "ממתינים",
        active: "פעילים",
        suspended: "מושעים",
      },

      list: {
        title: "כל המשתמשים",
        titlePending: "משתמשים ממתינים לאישור",
        titleActive: "משתמשים פעילים",
        titleSuspended: "משתמשים מושעים",
        description: "נהל משתמשי מערכת",
        descriptionPending: "בדוק ואשר או דחה הרשמות משתמשים חדשות",
        descriptionActive: "נהל משתמשים פעילים במערכת",
        descriptionSuspended: "צפה ונהל משתמשים מושעים",
      },

      empty: {
        noUsersFound: "לא נמצאו משתמשים",
        noMatchingSearch: "לא נמצאו משתמשים התואמים את החיפוש",
        noPendingUsers: "אין משתמשים ממתינים לאישור",
        noSuspendedUsers: "אין משתמשים מושעים",
      },

      search: {
        placeholder: "חפש משתמשים...",
      },

      actions: {
        selectRole: "בחר תפקיד...",
        approve: "אשר",
        reject: "דחה",
        changeRole: "שנה תפקיד",
        permissions: "הרשאות",
        suspend: "השעה",
        reactivate: "הפעל מחדש",
      },

      dialogs: {
        reject: {
          title: "דחה הרשמת משתמש",
          description:
            "האם אתה בטוח שברצונך לדחות את הרשמת {name}? פעולה זו תמחק את החשבון לצמיתות.",
          reasonLabel: "סיבה (אופציונלי)",
          reasonPlaceholder: "הזן סיבה לדחייה...",
          confirmButton: "דחה משתמש",
        },

        delete: {
          title: "מחק משתמש",
          description:
            "האם אתה בטוח שברצונך למחוק לצמיתות את חשבון {name}? פעולה זו לא ניתנת לביטול.",
          confirmButton: "מחק משתמש",
        },

        changeRole: {
          title: "שנה תפקיד משתמש",
          description:
            "שנה את התפקיד של {name}. פעולה זו תעדכן את ההרשאות שלו.",
          currentRole: "תפקיד נוכחי:",
          newRoleLabel: "תפקיד חדש",
          selectRole: "בחר תפקיד...",
          confirmButton: "שנה תפקיד",
        },
      },

      info: {
        registered: "נרשם:",
        approved: "אושר:",
      },

      confirmSuspend: "האם אתה בטוח שברצונך להשעות משתמש זה?",
    },

    // Supplier Management
    suppliers: {
      title: "ניהול ספקים",

      stats: {
        totalSuppliers: "סה״כ ספקים",
        activeSuppliers: "ספקים פעילים",
        inactiveSuppliers: "ספקים לא פעילים",
        hiddenSuppliers: "ספקים מוסתרים",
      },

      filters: {
        allSuppliers: "כל הספקים",
        activeOnly: "פעילים בלבד",
      },

      list: {
        title: "כל הספקים",
        titleActive: "ספקים פעילים",
        description: "נהל את הספקים והגדרות העמלות שלהם",
      },

      empty: {
        noSuppliers: "לא נמצאו ספקים. צור את הספק הראשון!",
        noActiveSuppliers: "לא נמצאו ספקים פעילים",
      },

      form: {
        createTitle: "צור ספק חדש",
        editTitle: "ערוך ספק",
        createDescription: "מלא את הפרטים ליצירת ספק חדש",
        editDescription: "עדכן את פרטי הספק",

        sections: {
          basicInfo: "מידע בסיסי",
          primaryContact: "איש קשר ראשי",
          secondaryContact: "איש קשר משני",
          commissionSettings: "הגדרות עמלות",
          taxPayment: "מס ותשלום",
          associatedBrands: "מותגים מקושרים",
          bkmvAliases: "שמות חלופיים (מבנה אחיד)",
        },

        fields: {
          code: "קוד",
          codePlaceholder: "לדוגמה: SUP001",
          name: "שם",
          namePlaceholder: "שם הספק",
          companyId: "מספר חברה",
          companyIdPlaceholder: "מספר רישום חברה",
          address: "כתובת",
          addressPlaceholder: "כתובת מלאה",
          description: "הערות",
          descriptionPlaceholder: "הערות על הספק",

          contactName: "שם איש קשר",
          contactNamePlaceholder: "שם איש הקשר",
          contactEmail: "אימייל איש קשר",
          contactEmailPlaceholder: "contact@example.com",
          contactPhone: "טלפון איש קשר",
          contactPhonePlaceholder: "+972-XX-XXX-XXXX",

          commissionRate: "אחוז עמלה",
          commissionRatePlaceholder: "לדוגמה: 5.00",
          commissionType: "סוג עמלה",
          commissionTypePlaceholder: "בחר סוג",
          commissionTypePercentage: "אחוז",
          commissionTypePerItem: "לפריט",
          settlementFrequency: "תדירות התחשבנות",
          settlementFrequencyPlaceholder: "בחר תדירות",
          settlementWeekly: "שבועי",
          settlementBiWeekly: "דו-שבועי",
          settlementMonthly: "חודשי",
          settlementQuarterly: "רבעוני",
          settlementSemiAnnual: "חצי שנתי",
          settlementAnnual: "שנתי",
          vatIncluded: "כולל מע״מ",
          vatExempt: "פטור ממע״מ",

          taxId: "מספר עוסק",
          taxIdPlaceholder: "מספר עוסק מורשה",
          paymentTerms: "תנאי תשלום",
          paymentTermsPlaceholder: "לדוגמה: שוטף + 30",

          isActive: "פעיל",
          isHidden: "הסתר מדוחות עמלות",
          isHiddenDescription: "ספק מוסתר לא יופיע בדוחות עמלות (לדוגמה: הדברה, ביטוח, סליקה)",
          bkmvAliases: "שמות חלופיים",
          bkmvAliasesPlaceholder: "הקלד שם וליחץ Enter להוספה",
          bkmvAliasesDescription: "שמות הספק כפי שהם מופיעים בקבצי מבנה אחיד (BKMVDATA) של זכיינים. משמש להתאמת אוטומטית של שמות.",
          addAlias: "הוסף שם חלופי",
          removeAlias: "הסר",
          noAliases: "לא הוגדרו שמות חלופיים",
        },

        commissionChange: {
          title: "זוהה שינוי בשיעור העמלה",
          changingFrom: "משנה מ-{from}% ל-{to}%",
          effectiveDate: "תאריך תחולה",
          reason: "סיבה לשינוי",
          reasonPlaceholder: "לדוגמה: עדכון שנתי",
          additionalNotes: "הערות נוספות",
          notesPlaceholder: "הערות נוספות על השינוי...",
        },
      },

      card: {
        code: "קוד:",
        companyId: "מספר חברה:",
        settlement: "התחשבנות:",
        vat: "מע״מ:",
        vatIncluded: "כלול",
        vatNotIncluded: "לא כלול",
        vatExempt: "פטור",
        contact: "איש קשר:",
        brands: "מותגים:",
        created: "נוצר:",
      },

      actions: {
        view: "צפה",
        history: "היסטוריה",
        fileMapping: "מיפוי קבצים",
        documents: "מסמכים",
        deactivate: "בטל פעיל",
        activate: "הפעל",
        set: "מוגדר",
        hide: "הסתר מדוחות",
        show: "הצג בדוחות",
      },

      badge: {
        hidden: "מוסתר",
      },

      history: {
        title: "היסטוריית שינויי עמלות",
        noChanges: "לא נרשמו שינויים בשיעור העמלה עדיין.",
        reason: "סיבה:",
        notes: "הערות:",
        system: "מערכת",
      },

      confirmDelete:
        "האם אתה בטוח שברצונך למחוק ספק זה? פעולה זו לא ניתנת לביטול.",

      // Supplier detail page
      detail: {
        backToSuppliers: "חזרה לספקים",
        editSupplier: "ערוך ספק",
        returnToSuppliers: "חזרה לספקים",
        error: "שגיאה",
        supplierNotFound: "הספק לא נמצא",
        failedToLoad: "נכשלה טעינת פרטי הספק",

        tabs: {
          overview: "סקירה כללית",
          commissionHistory: "היסטוריית עמלות",
          documents: "מסמכים",
          uploadHistory: "היסטוריית העלאות",
          crossReferences: "הפניות צולבות",
          processedFiles: "קבצים מעובדים",
          products: "פריטים ומע״מ",
        },

        overview: {
          basicInfo: {
            title: "מידע בסיסי",
            companyId: "מספר חברה",
            taxId: "מספר עוסק",
            address: "כתובת",
            description: "תיאור",
            created: "נוצר",
          },
          commission: {
            title: "הגדרות עמלות",
            defaultRate: "שיעור ברירת מחדל",
            notSet: "לא מוגדר",
            commissionType: "סוג עמלה",
            percentage: "אחוז",
            perItem: "לפריט",
            settlementFrequency: "תדירות התחשבנות",
            vat: "מע״מ",
            vatIncluded: "כלול",
            vatNotIncluded: "לא כלול",
            vatExempt: "פטור ממע״מ",
            paymentTerms: "תנאי תשלום",
          },
          contact: {
            primaryTitle: "איש קשר ראשי",
            secondaryTitle: "איש קשר משני",
            name: "שם",
            email: "אימייל",
            phone: "טלפון",
            noContact: "אין פרטי איש קשר",
            noSecondaryContact: "אין איש קשר משני",
          },
          brands: {
            title: "מותגים מקושרים",
          },
          fileMapping: {
            title: "הגדרת מיפוי קבצים",
            description: "הגדרות לניתוח קבצי דוחות ספקים",
            fileType: "סוג קובץ",
            headerRow: "שורת כותרת",
            dataStartRow: "שורת התחלת נתונים",
            rowsToSkip: "שורות לדילוג",
            columnMappings: "מיפוי עמודות",
            franchiseeColumn: "עמודת זכיין:",
            amountColumn: "עמודת סכום:",
            dateColumn: "עמודת תאריך:",
          },
        },

        commissionHistory: {
          title: "היסטוריית שיעורי עמלות",
          description: "עקוב אחר כל השינויים בשיעור העמלה לאורך זמן",
          noChanges: "לא נרשמו שינויים בשיעור העמלה עדיין",
          effective: "תחולה:",
          reason: "סיבה:",
          notes: "הערות:",
          system: "מערכת",
        },

        uploadHistory: {
          title: "קישורי העלאה והיסטוריה",
          description: "צפה בכל קישורי ההעלאה שנוצרו לספק זה והיסטוריית ההעלאות",
          noLinks: "לא נוצרו קישורי העלאה לספק זה",
          created: "נוצר:",
          expires: "פג תוקף:",
          used: "נוצל:",
          filesUploaded: "{count} קבצים הועלו",
          fileUploaded: "קובץ אחד הועלה",
          openLink: "פתח קישור",
        },

        crossReferences: {
          title: "היסטוריית הפניות צולבות",
          description: "השוואות סכומים ורשומות התאמה מול זכיינים",
          noReferences: "לא נמצאו הפניות צולבות לספק זה",
          unknownFranchisee: "זכיין לא ידוע",
          matched: "תואם",
          discrepancy: "פער",
          pending: "ממתין",
          supplierAmount: "סכום ספק",
          franchiseeAmount: "סכום זכיין",
          difference: "הפרש",
          threshold: "סף",
          created: "נוצר:",
          by: "ע״י:",
          reviewedBy: "נבדק ע״י:",
          reviewNotes: "הערות בדיקה:",
        },

        processedFiles: {
          title: "קבצים מעובדים",
          description: "קבצי Excel שהועלו ועובדו עבור ספק זה",
          noFiles: "לא נמצאו קבצים מעובדים לספק זה",
          loadError: "שגיאה בטעינת קבצים",
          viewAll: "צפה בכל הקבצים",
          statuses: {
            auto_approved: "אושר אוטומטית",
            approved: "אושר",
            needs_review: "ממתין לבדיקה",
            rejected: "נדחה",
            pending: "בעיבוד",
          },
          stats: {
            totalFranchisees: "זכיינים",
            exactMatches: "מדויקים",
            fuzzyMatches: "חלקיים",
            unmatched: "לא מותאמים",
          },
          summary: {
            totalGross: "סה״כ כולל מע״מ:",
            totalNet: "סה״כ לפני מע״מ:",
            rowsProcessed: "שורות שעובדו:",
          },
          table: {
            originalName: "שם בקובץ",
            matchedFranchisee: "זכיין מותאם",
            grossAmount: "כולל מע״מ",
            netAmount: "לפני מע״מ",
            matchStatus: "סטטוס",
          },
          actions: {
            review: "בדיקה",
            view: "צפה",
          },
        },

        settlementFrequencies: {
          weekly: "שבועי",
          bi_weekly: "דו-שבועי",
          monthly: "חודשי",
          quarterly: "רבעוני",
          semi_annual: "חצי שנתי",
          annual: "שנתי",
          notSet: "לא מוגדר",
        },

        statuses: {
          active: "פעיל",
          expired: "פג תוקף",
          used: "נוצל",
          cancelled: "בוטל",
        },
      },
    },

    // Franchisee Management
    franchisees: {
      title: "ניהול זכיינים",

      stats: {
        total: "סה״כ",
        active: "פעילים",
        pending: "ממתינים",
        inactive: "לא פעילים",
        suspended: "מושעים",
        terminated: "סיום",
      },

      filters: {
        allBrands: "כל המותגים",
        allStatuses: "כל הסטטוסים",
      },

      list: {
        title: "כל הזכיינים",
        description: "נהל את מיקומי הזכיינות והמפעילים שלך",
      },

      empty: {
        noFranchisees: "לא נמצאו זכיינים. צור את הזכיין הראשון!",
        noMatchingFilters: "לא נמצאו זכיינים התואמים את הסינון",
      },

      form: {
        createTitle: "צור זכיין חדש",
        editTitle: "ערוך זכיין",
        createDescription: "מלא את הפרטים ליצירת זכיין חדש",
        editDescription: "עדכן את פרטי הזכיין",

        sections: {
          basicInfo: "מידע בסיסי",
          aliases: "כינויים",
          address: "כתובת",
          primaryContact: "איש קשר ראשי",
          owners: "בעלים",
          importantDates: "תאריכים חשובים",
        },

        fields: {
          brand: "מותג",
          brandPlaceholder: "בחר מותג",
          name: "שם",
          namePlaceholder: "שם הזכיין",
          code: "קוד",
          codePlaceholder: "לדוגמה: FR001",
          companyId: "מספר חברה",
          companyIdPlaceholder: "מספר רישום חברה",
          status: "סטטוס",

          streetAddress: "כתובת רחוב",
          streetAddressPlaceholder: "כתובת רחוב",
          city: "עיר",
          cityPlaceholder: "עיר",
          state: "מחוז/אזור",
          statePlaceholder: "מחוז או אזור",
          postalCode: "מיקוד",
          postalCodePlaceholder: "מיקוד",
          country: "מדינה",
          countryPlaceholder: "מדינה",

          contactName: "שם",
          contactNamePlaceholder: "שם איש קשר",
          contactPhone: "טלפון",
          contactPhonePlaceholder: "+972-XX-XXX-XXXX",
          contactEmail: "אימייל",
          contactEmailPlaceholder: "contact@example.com",

          ownerName: "שם",
          ownerNamePlaceholder: "שם הבעלים",
          ownerPhone: "טלפון",
          ownerEmail: "אימייל",
          ownershipPercentage: "אחוז בעלות",

          openingDate: "תאריך פתיחה",
          leaseOption1End: "סיום אופציה 1",
          leaseOption2End: "סיום אופציה 2",
          leaseOption3End: "סיום אופציה 3",
          franchiseAgreementEnd: "סיום הסכם זכיינות",

          notes: "הערות",
          notesPlaceholder: "הערות נוספות",
          hashavshevetItemKey: "מפתח פריט (חשבשבת)",
          hashavshevetItemKeyPlaceholder: "מפתח פריט לייבוא חשבשבת",
          isActive: "פעיל",
        },

        aliases: {
          addAlias: "הוסף כינוי",
          placeholder: "הוסף שם כינוי...",
        },

        owners: {
          addOwner: "הוסף בעלים",
          count: "בעלים ({count})",
        },
      },

      card: {
        code: "קוד:",
        companyId: "מספר חברה:",
        aliases: "כינויים:",
        address: "כתובת",
        primaryContact: "איש קשר ראשי",
        owners: "בעלים",
        importantDates: "תאריכים חשובים",
        opening: "פתיחה:",
        leaseOption1End: "אופציה 1:",
        leaseOption2End: "אופציה 2:",
        leaseOption3End: "אופציה 3:",
        agreementEnd: "סיום הסכם:",
        notes: "הערות",
        created: "נוצר:",
        updated: "עודכן:",
        more: "עוד",
        less: "פחות",
        details: "פרטים",
        documents: "מסמכים",
        history: "היסטוריה",
      },

      statusChange: {
        title: "שנה סטטוס זכיין",
        description: "שנה סטטוס עבור",
        from: "מ-",
        to: "ל-",
        reasonLabel: "סיבה לשינוי",
        reasonPlaceholder: "הזן סיבה לשינוי הסטטוס...",
        notesLabel: "הערות נוספות (אופציונלי)",
        notesPlaceholder: "הזן הערות נוספות...",
        confirmButton: "אשר שינוי",
      },

      statusHistory: {
        title: "היסטוריית שינויי סטטוס",
        noChanges: "לא נרשמו שינויי סטטוס עדיין.",
        initial: "התחלתי:",
        reason: "סיבה:",
        notes: "הערות:",
      },

      statuses: {
        active: "פעיל",
        inactive: "לא פעיל",
        pending: "ממתין",
        suspended: "מושעה",
        terminated: "סיום",
      },

      confirmDelete:
        "האם אתה בטוח שברצונך למחוק זכיין זה? פעולה זו לא ניתנת לביטול.",
    },

    // Brand Management
    brands: {
      title: "ניהול מותגים",

      stats: {
        totalBrands: "סה״כ מותגים",
        activeBrands: "מותגים פעילים",
        inactiveBrands: "מותגים לא פעילים",
      },

      filters: {
        allBrands: "כל המותגים",
        activeOnly: "פעילים בלבד",
      },

      list: {
        title: "כל המותגים",
        titleActive: "מותגים פעילים",
        description: "נהל את מותגי הזכיינות שלך",
      },

      empty: {
        noBrands: "לא נמצאו מותגים. צור את המותג הראשון!",
        noActiveBrands: "לא נמצאו מותגים פעילים",
      },

      form: {
        createTitle: "צור מותג חדש",
        editTitle: "ערוך מותג",
        createDescription: "מלא את הפרטים ליצירת מותג חדש",
        editDescription: "עדכן את פרטי המותג",

        fields: {
          code: "קוד",
          codePlaceholder: "לדוגמה: PAT_VINI",
          nameHe: "שם בעברית",
          nameHePlaceholder: "לדוגמה: פט ויני",
          nameEn: "שם באנגלית",
          nameEnPlaceholder: "לדוגמה: Pat Vini",
          logoUrl: "לוגו (URL)",
          logoUrlPlaceholder: "/logos/brand-name.jpeg",
          website: "אתר",
          websitePlaceholder: "https://example.com",
          contactEmail: "אימייל ליצירת קשר",
          contactEmailPlaceholder: "contact@example.com",
          contactPhone: "טלפון ליצירת קשר",
          contactPhonePlaceholder: "+972-XX-XXX-XXXX",
          address: "כתובת",
          addressPlaceholder: "כתובת מלאה",
          description: "תיאור",
          descriptionPlaceholder: "תיאור המותג",
          isActive: "פעיל",
        },

        validation: {
          codeNameRequired: "קוד ושם בעברית הם שדות חובה",
        },
      },

      card: {
        code: "קוד:",
        created: "נוצר:",
      },

      actions: {
        deactivate: "בטל פעיל",
        activate: "הפעל",
      },

      confirmDelete:
        "האם אתה בטוח שברצונך למחוק מותג זה? פעולה זו לא ניתנת לביטול.",

      confirmDeactivate: {
        title: "ביטול פעיל מותג",
        description: "האם אתה בטוח שברצונך לבטל את המותג? המותג לא יהיה זמין לשימוש.",
      },

      confirmActivate: {
        title: "הפעלת מותג",
        description: "האם להפעיל מחדש את המותג?",
      },
    },

    // Settlements Management
    settlements: {
      title: "ניהול תקופות התחשבנות",

      stats: {
        total: "סה״כ",
        pendingApproval: "ממתין לאישור",
        approved: "מאושר",
        processing: "בעיבוד",
        open: "פתוח",
        invoiced: "חשבונית",
      },

      filters: {
        allStatuses: "כל הסטטוסים",
        pendingApproval: "ממתין לאישור",
        open: "פתוח",
        processing: "בעיבוד",
        approved: "מאושר",
        invoiced: "חשבונית הופקה",
        cancelled: "בוטל",
        allPeriods: "כל התקופות",
        monthly: "חודשי",
        quarterly: "רבעוני",
        semiAnnual: "חצי שנתי",
        annual: "שנתי",
      },

      list: {
        title: "תקופות התחשבנות",
        description: "בדוק ואשר תקופות התחשבנות. אישור נועל את התקופה ומונע עריכה.",
        descriptionView: "צפה בתקופות התחשבנות",
        pendingCount: "{count} ממתינים לאישור",
      },

      empty: {
        noSettlements: "לא נמצאו תקופות התחשבנות",
        noMatchingFilters: "לא נמצאו תקופות התואמות את הסינון",
      },

      table: {
        periodName: "שם התקופה",
        franchisee: "זכיין",
        type: "סוג",
        period: "תקופה",
        status: "סטטוס",
        netAmount: "סכום לפני מע״מ",
        approval: "אישור",
        actions: "פעולות",
        until: "עד",
      },

      periodTypes: {
        monthly: "חודשי",
        quarterly: "רבעוני",
        semi_annual: "חצי שנתי",
        annual: "שנתי",
      },

      statuses: {
        open: "פתוח",
        processing: "בעיבוד",
        pending_approval: "ממתין לאישור",
        approved: "מאושר",
        invoiced: "חשבונית הופקה",
        draft: "טיוטה",
        pending: "ממתין",
        completed: "הושלם",
        cancelled: "בוטל",
      },

      actions: {
        approve: "אשר",
        reopen: "פתח מחדש",
        startProcessing: "התחל עיבוד",
        submitForApproval: "שלח לאישור",
        createInvoice: "הפק חשבונית",
      },

      dialogs: {
        approve: {
          title: "אישור תקופת התחשבנות",
          description: "אתה עומד לאשר את תקופת ההתחשבנות",
          warning: "אישור ינעל את התקופה ולא ניתן יהיה לערוך אותה.",
          franchisee: "זכיין:",
          period: "תקופה:",
          netAmount: "סכום לפני מע״מ לתשלום:",
          approvedBy: "אושר ע״י:",
          approvedAt: "בתאריך:",
          confirmButton: "אשר תקופה",
        },

        reopen: {
          title: "פתיחה מחדש של תקופת התחשבנות",
          description: "אתה עומד לפתוח מחדש את תקופת ההתחשבנות",
          warning: "פתיחה מחדש תבטל את האישור ותאפשר עריכה.",
          reasonLabel: "סיבה לפתיחה מחדש",
          reasonPlaceholder: "הזן סיבה לפתיחה מחדש...",
          confirmButton: "פתח מחדש",
        },
      },

      messages: {
        approveSuccess: "התקופה אושרה בהצלחה",
        reopenSuccess: "התקופה נפתחה מחדש",
        statusUpdateSuccess: "הסטטוס עודכן בהצלחה",
        loadError: "שגיאה בטעינת התקופות",
        updateError: "שגיאה בעדכון הסטטוס",
      },
    },

    // Settlement Workflow
    settlementWorkflow: {
      title: "תהליך התחשבנות",
      description: "9 שלבים לסיום תהליך ההתחשבנות החודשי",

      periodSelection: {
        title: "תקופת התחשבנות",
        placeholder: "בחר תקופה",
        fromDate: "מתאריך:",
        toDate: "עד תאריך:",
      },

      progress: {
        title: "התקדמות כללית",
        steps: "שלבים",
        completed: "הושלמו",
        active: "פעיל",
        pending: "ממתינים",
      },

      quickStats: {
        title: "סטטיסטיקות מהירות",
        activeSuppliers: "ספקים פעילים",
        franchisees: "זכיינים",
        pendingGaps: "פערים ממתינים",
        expectedCommissions: "עמלות צפויות",
      },

      steps: {
        title: "שלבי התהליך",
        periodSelection: {
          title: "בחירת תקופה",
          description: "בחר את תקופת ההתחשבנות לעיבוד",
          action: "בחר תקופה",
        },
        fileStatus: {
          title: "סטטוס קבצים",
          description: "בדוק סטטוס העלאת קבצי ספקים וזכיינים",
          action: "צפה בסטטוס",
        },
        sendRequests: {
          title: "שליחת בקשות דוחות",
          description: "שלח בקשות לספקים ולזכיינים להעלאת קבצים",
          action: "שלח בקשות",
        },
        sendReminders: {
          title: "שליחת תזכורות",
          description: "שלח תזכורות לישויות שטרם העלו קבצים",
          action: "שלח תזכורות",
        },
        fileProcessing: {
          title: "עיבוד והצלבת קבצים",
          description: "עבד את הקבצים שהתקבלו וצלב נתונים",
          action: "הפעל עיבוד",
        },
        gapHandling: {
          title: "טיפול בפערים",
          description: "בדוק ותקן פערים והתאמות בנתונים",
          action: "טפל בפערים",
        },
        commissionCalculation: {
          title: "חישוב עמלות",
          description: "חשב עמלות לכל ספק וזכיין",
          action: "חשב עמלות",
        },
        finalApproval: {
          title: "אישור סופי",
          description: "אשר את כל הנתונים לפני הפקת חשבוניות",
          actionSuperUser: "אשר התחשבנות",
          actionAdmin: "שלח לאישור",
        },
        invoiceGeneration: {
          title: "הפקת דוחות וחשבוניות",
          description: "הפק דוחות סיכום וחשבוניות",
          action: "הפק חשבוניות",
        },
      },

      status: {
        completed: "הושלם",
        active: "פעיל",
        pending: "ממתין",
        error: "שגיאה",
        of: "מתוך",
      },

      quickActions: {
        title: "פעולות מהירות",
        managePeriods: "ניהול תקופות",
        crossReference: "הצלבת נתונים",
        commissions: "עמלות",
        reminders: "תזכורות",
        suppliers: "ספקים",
        franchisees: "זכיינים",
      },

      messages: {
        actionSuccess: "הפעולה בוצעה בהצלחה",
        actionError: "שגיאה בביצוע הפעולה",
      },
    },

    // Reconciliation
    reconciliation: {
      title: "התאמת הפניות צולבות",
      pageTitle: "התאמת הפניות צולבות",

      stats: {
        totalComparisons: "סה״כ השוואות",
        matched: "תואמים",
        discrepancies: "פערים",
        pendingReview: "ממתין לבדיקה",
      },

      filters: {
        title: "חיפוש וסינון",
        description: "בחר תקופה וסינונים אופציונליים לצפייה בנתוני התאמה",
        periodStartDate: "תאריך תחילת תקופה",
        periodEndDate: "תאריך סיום תקופה",
        supplier: "ספק (אופציונלי)",
        franchisee: "זכיין (אופציונלי)",
        allSuppliers: "כל הספקים",
        allFranchisees: "כל הזכיינים",
        filterByStatus: "סנן לפי סטטוס:",
        all: "הכל",
        selectDateRange: "נא לבחור טווח תאריכים",
      },

      actions: {
        search: "חיפוש",
        loading: "טוען...",
        refreshStats: "רענן סטטיסטיקות",
        manualCompare: "השוואה ידנית",
      },

      manualCompare: {
        title: "השוואת סכומים ידנית",
        description: "השווה בין סכומי דיווח ספק וזכיין באופן ידני. סכומים בהפרש של עד {threshold} יסומנו כתואמים.",
        supplier: "ספק *",
        supplierPlaceholder: "בחר ספק",
        franchisee: "זכיין *",
        franchiseePlaceholder: "בחר זכיין",
        supplierAmount: "סכום מדווח ספק (ש״ח) *",
        supplierAmountPlaceholder: "לדוגמה: 1500.00",
        franchiseeAmount: "סכום מדווח זכיין (ש״ח) *",
        franchiseeAmountPlaceholder: "לדוגמה: 1505.00",
        periodStartDate: "תאריך תחילת תקופה *",
        periodEndDate: "תאריך סיום תקופה *",
        threshold: "סף (ש״ח)",
        cancel: "ביטול",
        compare: "השווה",
        comparing: "משווה...",
      },

      report: {
        title: "דוח התאמה",
        period: "תקופה:",
        generated: "נוצר:",
      },

      summary: {
        totalPairs: "סה״כ זוגות",
        totalSupplierAmount: "סה״כ סכום ספקים",
        totalFranchiseeAmount: "סה״כ סכום זכיינים",
        totalDifference: "סה״כ הפרש",
        matched: "תואמים",
        discrepancies: "פערים",
        pending: "ממתין",
        selected: "נבחרו",
      },

      bulkActions: {
        bulkApprove: "אישור קבוצתי ({count})",
      },

      table: {
        selectAll: "בחר הכל",
        supplier: "ספק",
        franchisee: "זכיין",
        supplierAmount: "סכום ספק",
        franchiseeAmount: "סכום זכיין",
        difference: "הפרש",
        status: "סטטוס",
        actions: "פעולות",
        noEntries: "לא נמצאו רשומות לסינון הנבחר.",
      },

      statuses: {
        matched: "תואם",
        discrepancy: "פער",
        pending: "ממתין",
      },

      entryActions: {
        quickReview: "סקירה מהירה",
        resolve: "טיפול",
      },

      reviewDialog: {
        title: "סקירת פער",
        description: "סקור את הפער בין סכומי הדיווח של הספק והזכיין.",
        supplier: "ספק:",
        franchisee: "זכיין:",
        supplierAmount: "סכום ספק:",
        franchiseeAmount: "סכום זכיין:",
        difference: "הפרש:",
        reviewNotes: "הערות סקירה",
        reviewNotesPlaceholder: "הוסף הערות על פער זה...",
        cancel: "ביטול",
        confirmDiscrepancy: "אשר כפער",
        markAsMatched: "סמן כתואם",
      },

      bulkApproveDialog: {
        title: "אישור קבוצתי של פריטים",
        description: "אתה עומד לאשר {count} פריטים נבחרים. פריטים עם פערים ידולגו מכיוון שהם דורשים סקירה פרטנית.",
        totalSelected: "סה״כ נבחרו:",
        alreadyMatched: "תואמים כבר (יאושרו):",
        pending: "ממתינים (יאושרו):",
        approvalNotes: "הערות אישור (אופציונלי)",
        approvalNotesPlaceholder: "הוסף הערות לאישור הקבוצתי...",
        cancel: "ביטול",
        approve: "אשר {count} פריטים",
        approving: "מאשר...",
      },

      messages: {
        compareResult: "תוצאת השוואה: {status}\nהפרש: {difference}\nסף: {threshold}",
        bulkApproveResult: "האישור הקבוצתי הושלם:\n- אושרו: {approved}\n- דולגו: {skipped}\n- נכשלו: {failed}",
        failedToCompare: "נכשלה ההשוואה",
        failedToBulkApprove: "נכשל האישור הקבוצתי",
        failedToUpdateStatus: "נכשל עדכון הסטטוס",
        failedToFetchReport: "נכשלה טעינת דוח ההתאמה",
      },

      // Discrepancy detail page
      discrepancy: {
        pageTitle: "טיפול בפער",
        backToReconciliation: "חזרה להתאמות",
        error: "שגיאה",
        crossRefNotFound: "הפניה צולבת לא נמצאה",

        // Amount comparison card
        amountComparison: {
          title: "השוואת סכומים",
          description: "השוואת סכומים מדווחים מצד הספק מול הזכיין",
          supplier: "ספק",
          franchisee: "זכיין",
          unknownSupplier: "ספק לא ידוע",
          unknownFranchisee: "זכיין לא ידוע",
          difference: "הפרש",
          differencePercent: "אחוז הפרש",
        },

        // Details card
        details: {
          title: "פרטים",
          period: "תקופה:",
          threshold: "סף:",
          created: "נוצר:",
          lastReviewed: "נבדק לאחרונה:",
          reviewNotes: "הערות בדיקה:",
        },

        // Resolution history card
        history: {
          title: "היסטוריית טיפול",
          resolvedOn: "נפתר בתאריך",
          resolutionType: "סוג טיפול:",
        },

        // Quick actions card
        quickActions: {
          title: "פעולות מהירות",
          description: "אשר, דחה או בקש תיקון",
          approve: "אשר",
          reject: "דחה",
          requestFile: "בקש קובץ מתוקן",
        },

        // Resolution form
        resolutionForm: {
          title: "טופס טיפול",
          description: "שלח את הטיפול עם הסבר",
          resolutionType: "סוג טיפול *",
          resolutionTypePlaceholder: "בחר סוג טיפול",
          adjustmentType: "סוג התאמה *",
          adjustmentTypePlaceholder: "בחר סוג התאמה",
          adjustmentAmount: "סכום התאמה (ש״ח) *",
          adjustmentAmountPlaceholder: "לדוגמה: 100.00",
          explanation: "הסבר *",
          explanationPlaceholder: "ספק הסבר מפורט לטיפול זה...",
          submit: "שלח טיפול",
          submitting: "שולח...",
        },

        // Resolution types
        resolutionTypes: {
          accept_supplier: "קבל סכום ספק",
          accept_franchisee: "קבל סכום זכיין",
          adjustment: "התאמה ידנית",
          request_correction: "בקש תיקון",
        },

        // Adjustment types
        adjustmentTypes: {
          credit: "זיכוי",
          deposit: "פיקדון",
          supplier_error: "טעות ספק",
          timing: "הפרשי עיתוי",
          other: "אחר",
        },

        // Resolved status card
        resolved: {
          title: "טופל",
          message: "פער זה טופל. אין צורך בפעולה נוספת.",
        },

        // File request dialog
        fileRequestDialog: {
          title: "בקשת קובץ מתוקן",
          description: "שלח בקשה לקובץ דוח מתוקן לפתרון הפער.",
          requestFrom: "בקש מ- *",
          supplierOption: "ספק ({name})",
          franchiseeOption: "זכיין ({name})",
          unknown: "לא ידוע",
          recipientEmail: "אימייל נמען *",
          recipientEmailPlaceholder: "email@example.com",
          message: "הודעה (אופציונלי)",
          messagePlaceholder: "הוסף הערות או הוראות נוספות...",
          cancel: "ביטול",
          send: "שלח בקשה",
          sending: "שולח...",
        },

        // Approval dialog
        approvalDialog: {
          approveTitle: "אישור פער",
          rejectTitle: "דחיית טיפול",
          approveDescription: "אשר שפער זה מקובל ויש לסמנו כתואם.",
          rejectDescription: "אשר שפער זה יישאר ללא טיפול.",
          explanation: "הסבר (אופציונלי)",
          approvalReasonPlaceholder: "סיבת האישור...",
          rejectionReasonPlaceholder: "סיבת הדחייה...",
          cancel: "ביטול",
          approve: "אשר",
          reject: "דחה",
        },

        // Messages
        messages: {
          selectResolutionType: "יש לבחור סוג טיפול",
          provideExplanation: "יש לספק הסבר",
          fillAdjustmentDetails: "יש למלא את פרטי ההתאמה",
          enterEmail: "יש להזין כתובת אימייל",
          resolutionSuccess: "הטיפול נשלח בהצלחה!",
          fileRequestSuccess: "בקשת הקובץ נשלחה בהצלחה!",
          approvalSuccess: "הפער אושר בהצלחה!",
          rejectionSuccess: "הפער נדחה בהצלחה!",
          failedToSubmit: "נכשלה שליחת הטיפול",
          failedToSendRequest: "נכשלה שליחת הבקשה",
          failedToApprove: "נכשל האישור",
          failedToReject: "נכשלה הדחייה",
        },
      },
    },

    // Commissions
    commissions: {
      title: "עמלות",

      // Supplier commission report page
      supplier: {
        pageTitle: "דוח עמלות לפי ספק",
        backToDashboard: "לוח בקרה",

        filters: {
          title: "בחירת ספק ומסננים",
          description: "בחר ספק וסנן את הנתונים לפי תאריכים, מותג וסטטוס",
          supplier: "ספק",
          supplierRequired: "ספק *",
          selectSupplier: "בחר ספק",
          fromDate: "מתאריך",
          toDate: "עד תאריך",
          brand: "מותג",
          allBrands: "כל המותגים",
          status: "סטטוס",
          allStatuses: "כל הסטטוסים",
          historicalComparison: "השוואה היסטורית",
          previousPeriodFrom: "תקופה קודמת - מתאריך",
          previousPeriodTo: "תקופה קודמת - עד תאריך",
          showReport: "הצג דוח",
          exportToExcel: "ייצוא ל-Excel",
          exportError: "שגיאה בייצוא הדוח",
        },

        supplierInfo: {
          code: "קוד:",
          settlementFrequency: {
            monthly: "חודשי",
            quarterly: "רבעוני",
            weekly: "שבועי",
            notSet: "לא הוגדר",
          },
          vat: "מע״מ",
          vatIncluded: "כלול",
          vatNotIncluded: "לא כלול",
        },

        summary: {
          totalFranchisees: "סה״כ זכיינים",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          avgRate: "שיעור ממוצע:",
        },

        comparison: {
          title: "השוואה לתקופה קודמת",
          previousGross: "סכום כולל מע״מ קודם",
          previousNet: "סכום לפני מע״מ קודם",
          previousCommission: "סכום עמלה קודם",
        },

        tabs: {
          byFranchisee: "לפי זכיין",
          byPeriod: "לפי תקופה",
          fullDetails: "פירוט מלא",
        },

        franchiseeTable: {
          title: "עמלות לפי זכיין",
          description: "פירוט סכומים מצטברים עבור כל זכיין",
          franchisee: "זכיין",
          code: "קוד",
          brand: "מותג",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          avgRate: "שיעור ממוצע",
          total: "סה״כ",
          noData: "לא נמצאו נתונים",
        },

        periodTable: {
          title: "עמלות לפי תקופה",
          description: "פירוט סכומים מצטברים לכל תקופת התחשבנות",
          startDate: "תאריך התחלה",
          endDate: "תאריך סיום",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          total: "סה״כ",
          noData: "לא נמצאו נתונים",
        },

        detailsTable: {
          title: "פירוט מלא",
          description: "כל העמלות הבודדות עם פרטים מלאים",
          showLess: "הצג פחות",
          showAll: "הצג הכל",
          franchisee: "זכיין",
          brand: "מותג",
          period: "תקופה",
          gross: "כולל מע״מ",
          net: "לפני מע״מ",
          rate: "שיעור",
          commission: "עמלה",
          status: "סטטוס",
          noData: "לא נמצאו נתונים",
          showingRecords: "מוצגות {shown} רשומות מתוך {total}",
        },

        emptyState: {
          title: "בחר ספק להצגת הדוח",
          description: "בחר ספק מהרשימה לעיל ולחץ על \"הצג דוח\"",
        },

        statuses: {
          pending: "ממתין",
          calculated: "חושב",
          approved: "מאושר",
          paid: "שולם",
          cancelled: "בוטל",
        },
      },

      // Brand commission report page
      brand: {
        pageTitle: "דוח עמלות לפי מותג",
        invoiceReady: "מוכן להפקת חשבונית",
        backToDashboard: "לוח בקרה",

        filters: {
          title: "בחירת מותג ומסננים",
          description: "בחר מותג וסנן את הנתונים לפי תאריכים, ספק וסטטוס. הדוח מוכן להפקת חשבונית.",
          brandRequired: "מותג *",
          selectBrand: "בחר מותג",
          fromDate: "מתאריך",
          toDate: "עד תאריך",
          supplier: "ספק",
          allSuppliers: "כל הספקים",
          status: "סטטוס",
          allStatuses: "כל הסטטוסים",
          showReport: "הצג דוח",
          exportToExcel: "ייצוא ל-Excel",
          exportError: "שגיאה בייצוא הדוח",
        },

        brandInfo: {
          code: "קוד:",
        },

        summary: {
          franchiseesAndSuppliers: "זכיינים וספקים",
          franchisees: "זכיינים",
          suppliers: "ספקים",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          totalBrandPurchases: "סה״כ רכישות מותג",
          netAmount: "סכום לפני מע״מ",
          beforeVat: "לפני מע״מ",
          commissionAmountToPay: "סכום עמלה לתשלום",
          avgRate: "שיעור ממוצע:",
        },

        period: {
          reportPeriod: "תקופת הדוח:",
          generatedAt: "הופק:",
        },

        tabs: {
          byFranchisee: "לפי זכיין",
          bySupplier: "לפי ספק",
          byPeriod: "לפי תקופה",
          fullDetails: "פירוט מלא",
        },

        franchiseeTable: {
          title: "עמלות לפי זכיין",
          description: "פירוט סכומים מצטברים עבור כל זכיין במותג",
          franchisee: "זכיין",
          code: "קוד",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          avgRate: "שיעור ממוצע",
          total: "סה״כ",
          noData: "לא נמצאו נתונים",
        },

        supplierTable: {
          title: "עמלות לפי ספק",
          description: "פירוט סכומים מצטברים לכל ספק במותג",
          supplier: "ספק",
          code: "קוד",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          avgRate: "שיעור ממוצע",
          total: "סה״כ",
          noData: "לא נמצאו נתונים",
        },

        periodTable: {
          title: "עמלות לפי תקופה",
          description: "פירוט סכומים מצטברים לכל תקופת התחשבנות",
          startDate: "תאריך התחלה",
          endDate: "תאריך סיום",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          total: "סה״כ",
          noData: "לא נמצאו נתונים",
        },

        detailsTable: {
          title: "פירוט מלא",
          description: "כל העמלות הבודדות עם פרטים מלאים",
          showLess: "הצג פחות",
          showAll: "הצג הכל",
          supplier: "ספק",
          franchisee: "זכיין",
          period: "תקופה",
          gross: "כולל מע״מ",
          net: "לפני מע״מ",
          rate: "שיעור",
          commission: "עמלה",
          status: "סטטוס",
          noData: "לא נמצאו נתונים",
          showingRecords: "מוצגות {shown} רשומות מתוך {total}",
        },

        emptyState: {
          title: "בחר מותג להצגת הדוח",
          description: "בחר מותג מהרשימה לעיל ולחץ על \"הצג דוח\" לצפייה בכל העמלות של המותג",
        },

        statuses: {
          pending: "ממתין",
          calculated: "חושב",
          approved: "מאושר",
          paid: "שולם",
          cancelled: "בוטל",
        },
      },

      // Franchisee purchase report page
      franchisee: {
        pageTitle: "דוח רכישות לפי זכיין",
        backToAdmin: "ניהול",
        breadcrumb: "דוח רכישות זכיין",
        description: "צפייה בכל הספקים שהזכיין רכש מהם, סכומים ופירוט מלא",

        actions: {
          refresh: "רענון",
          exportToExcel: "ייצוא לאקסל",
          loadReport: "טען דוח",
          applyFilter: "החל סינון",
          reset: "איפוס",
        },

        franchiseeSelection: {
          title: "בחירת זכיין",
          description: "בחר זכיין להצגת דוח הרכישות שלו",
          label: "זכיין",
          placeholder: "בחר זכיין...",
        },

        filters: {
          title: "סינון",
          description: "סנן את הדוח לפי תאריכים, ספק או סטטוס",
          fromDate: "מתאריך",
          toDate: "עד תאריך",
          supplier: "ספק",
          allSuppliers: "כל הספקים",
          status: "סטטוס",
          allStatuses: "כל הסטטוסים",
        },

        franchiseeInfo: {
          title: "פרטי זכיין",
          name: "שם זכיין",
          code: "קוד",
          brand: "מותג",
          contact: "איש קשר",
          email: "אימייל",
          phone: "טלפון",
        },

        summary: {
          totalPurchases: "סה״כ רכישות",
          records: "רשומות",
          netAmount: "סכום לפני מע״מ",
          commission: "עמלה",
          suppliersCount: "מספר ספקים",
          activeSuppliers: "ספקים פעילים",
          periodRange: "טווח תקופה",
          notAvailable: "לא זמין",
          generated: "הופק",
        },

        tabs: {
          bySupplier: "לפי ספק",
          byPeriod: "לפי תקופה",
          fullDetails: "פירוט מלא",
        },

        supplierTable: {
          title: "סיכום לפי ספק",
          description: "פירוט רכישות מקובץ לפי ספק",
          supplier: "ספק",
          code: "קוד",
          purchaseCount: "מספר רכישות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          avgRate: "עמלה ממוצעת",
          noData: "אין נתונים להצגה",
        },

        periodTable: {
          title: "סיכום לפי תקופה",
          description: "פירוט רכישות מקובץ לפי תקופת התחשבנות",
          startDate: "תאריך התחלה",
          endDate: "תאריך סיום",
          purchaseCount: "מספר רכישות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          commissionAmount: "סכום עמלה",
          noData: "אין נתונים להצגה",
        },

        detailsTable: {
          title: "פירוט מלא",
          description: "כל רשומות הרכישות בפירוט מלא",
          supplier: "ספק",
          period: "תקופה",
          gross: "כולל מע״מ",
          net: "לפני מע״מ",
          commission: "עמלה",
          rate: "שיעור",
          status: "סטטוס",
          noData: "אין נתונים להצגה",
          showingRecords: "מציג {shown} מתוך {total} רשומות. ייצא לאקסל לצפייה בכל הרשומות.",
        },

        emptyState: {
          selectFranchisee: {
            title: "בחר זכיין",
            description: "בחר זכיין מהרשימה למעלה כדי להציג את דוח הרכישות שלו",
          },
          loadReport: {
            title: "טען דוח",
            description: "לחץ על כפתור \"טען דוח\" להצגת נתוני הרכישות של הזכיין",
          },
        },

        statuses: {
          pending: "ממתין",
          calculated: "חושב",
          approved: "מאושר",
          paid: "שולם",
          cancelled: "בוטל",
        },
      },

      // Invoice report page
      invoice: {
        pageTitle: "דוחות חשבוניות",
        superUserOnly: "משתמש על בלבד",
        backToDashboard: "לוח בקרה",

        description: {
          title: "הפקת דוחות חשבוניות לספקים",
          content: "דף זה מאפשר ל-Super User להפיק דוחות חשבוניות לספקים. הדוח מפורט לפי מותג - חשבונית אחת לכל מותג לכל ספק. הקובץ מוכן לייצוא לאקסל עם הכנה לפורמט חשבשבת עתידי.",
        },

        filters: {
          title: "בחירת ספק ותקופה",
          description: "בחר ספק ותקופה להפקת דוח חשבוניות",
          supplierRequired: "ספק *",
          selectSupplier: "בחר ספק",
          fromDate: "מתאריך *",
          toDate: "עד תאריך *",
          commissionStatus: "סטטוס עמלות",
          allStatuses: "כל הסטטוסים",
          statusApproved: "מאושר (מומלץ)",
          statusCalculated: "חושב",
          statusPaid: "שולם",
        },

        actions: {
          showData: "הצג נתונים",
          exportToExcel: "ייצוא דוח חשבוניות ל-Excel",
        },

        supplierInfo: {
          code: "קוד:",
          period: "תקופה:",
        },

        summary: {
          brands: "מותגים",
          separateInvoices: "חשבוניות נפרדות",
          totalCommissions: "סה״כ עמלות",
          commissionRecords: "רשומות עמלה",
          netAmount: "סכום לפני מע״מ",
          beforeVat: "לפני מע״מ",
          commissionAmount: "סכום עמלה",
          totalToPay: "סה״כ לתשלום",
        },

        table: {
          title: "חשבוניות לפי מותג",
          description: "כל שורה מייצגת חשבונית נפרדת שיש להנפיק לספק עבור מותג ספציפי",
          brandCode: "קוד מותג",
          brandName: "שם מותג",
          commissions: "עמלות",
          grossAmount: "סכום כולל מע״מ",
          netAmount: "סכום לפני מע״מ",
          avgRate: "שיעור עמלה ממוצע",
          invoiceAmount: "סכום חשבונית",
          total: "סה״כ",
          invoices: "חשבוניות",
          noData: "לא נמצאו נתונים לתקופה והספק שנבחרו",
        },

        export: {
          title: "ייצוא לאקסל",
          description: "קובץ האקסל המיוצא כולל את הגליונות הבאים:",
          sheets: {
            summary: "סיכום - פרטי ספק ותקופה עם סיכומים כלליים",
            brandSummary: "סיכום לפי מותג - סכומים מצטברים לכל מותג",
            invoicePerBrand: "חשבונית - [שם מותג] - גליון נפרד לכל מותג עם פירוט מלא",
            fullDetails: "פירוט מלא - כל העמלות הבודדות ברשימה אחת",
            hashavshevet: "הכנה לחשבשבת - נתונים מובנים לייבוא עתידי לחשבשבת",
          },
        },

        emptyState: {
          title: "בחר ספק ותקופה להפקת דוח",
          description: "בחר ספק ותאריכים לעיל ולחץ על \"הצג נתונים\" לצפייה בנתוני החשבוניות",
        },

        errors: {
          loadSuppliers: "שגיאה בטעינת רשימת הספקים",
          loadInvoiceData: "שגיאה בטעינת נתוני חשבוניות",
          exportReport: "שגיאה בייצוא הדוח",
        },
      },

      // Variance report page
      variance: {
        pageTitle: "דוח סטיות רכש ספקים",
        backToDashboard: "לוח בקרה",
        breadcrumb: {
          admin: "ניהול",
          reports: "דוחות עמלות",
          variance: "סטיות רכש",
        },
        description: "השוואת אחוזי רכש בין תקופות וזיהוי סטיות חריגות מעל 10%",

        actions: {
          refresh: "רענון",
          exportToExcel: "ייצוא לאקסל",
          generateReport: "הפק דוח",
        },

        filters: {
          title: "הגדרות השוואה",
          description: "בחר תקופות להשוואה וסף סטייה לזיהוי חריגות",
          currentPeriod: "תקופה נוכחית",
          previousPeriod: "תקופה קודמת (להשוואה)",
          fromDate: "מתאריך",
          toDate: "עד תאריך",
          brand: "מותג",
          allBrands: "כל המותגים",
          threshold: "סף סטייה (%)",
          thresholdDefault: "10% (ברירת מחדל)",
        },

        presets: {
          monthVsPrevious: "חודש נוכחי מול קודם",
          quarterVsPrevious: "רבעון נוכחי מול קודם",
          yearVsPrevious: "שנה נוכחית מול קודמת",
        },

        summary: {
          totalSuppliers: "סה״כ ספקים",
          activeSuppliers: "ספקים פעילים בתקופות הנבחרות",
          suppliersWithVariance: "ספקים עם סטייה",
          varianceAbove: "סטייה מעל {threshold}%",
          currentPurchases: "רכש נוכחי",
          previousPurchases: "רכש קודם",
        },

        alerts: {
          varianceDetected: "זוהו סטיות חריגות!",
          varianceDescription: "נמצאו {count} ספקים עם סטייה באחוז הרכש מעל {threshold}%. מומלץ לבדוק את הספקים המסומנים.",
          noVariance: "לא נמצאו סטיות חריגות",
          noVarianceDescription: "כל הספקים נמצאים בטווח הסטייה המותר ({threshold}%)",
        },

        tabs: {
          flagged: "ספקים חריגים",
          all: "כל הספקים",
        },

        table: {
          flaggedTitle: "ספקים עם סטייה חריגה",
          flaggedDescription: "ספקים עם סטייה באחוז הרכש מעל {threshold}%",
          allTitle: "כל הספקים",
          allDescription: "רשימת כל הספקים והשוואת אחוזי הרכש בין התקופות",
          supplier: "ספק",
          code: "קוד",
          currentPercent: "% נוכחי",
          previousPercent: "% קודם",
          variance: "סטייה",
          change: "שינוי",
          status: "סטטוס",
          currentPurchases: "רכש נוכחי",
          previousPurchases: "רכש קודם",
          noData: "אין נתונים להצגה",
        },

        statuses: {
          flagged: "חריג",
          normal: "תקין",
        },

        emptyState: {
          title: "בחר תקופות להשוואה",
          description: "הגדר את התקופות להשוואה ולחץ על \"הפק דוח\" לצפייה בסטיות הרכש",
        },

        errors: {
          title: "שגיאה",
          failedToFetch: "נכשלה טעינת הדוח",
          failedToExport: "נכשל ייצוא הדוח",
        },
      },
    },

    // Email Templates
    emailTemplates: {
      title: "ניהול תבניות אימייל",
      pageTitle: "ניהול תבניות אימייל",

      stats: {
        totalTemplates: "סה״כ תבניות",
        active: "פעילות",
        inactive: "לא פעילות",
        categories: "קטגוריות",
      },

      filters: {
        allTemplates: "כל התבניות",
        activeOnly: "פעילות בלבד",
        allTypes: "כל הסוגים",
        filterStatus: "סנן לפי סטטוס",
        filterByType: "סנן לפי סוג",
      },

      list: {
        title: "כל תבניות האימייל",
        titleActive: "תבניות אימייל פעילות",
        description: "נהל תבניות אימייל לבקשות ספקים, בקשות זכיינים, תזכורות ואימיילים מותאמים אישית",
      },

      empty: {
        noTemplates: "לא נמצאו תבניות. צור את תבנית האימייל הראשונה!",
        noActiveTemplates: "לא נמצאו תבניות פעילות",
      },

      card: {
        code: "קוד:",
        subject: "נושא:",
        variables: "משתנים:",
        updated: "עודכן:",
      },

      actions: {
        addTemplate: "הוסף תבנית",
        refresh: "רענן",
        preview: "תצוגה מקדימה",
        copyCode: "העתק קוד",
        codeCopied: "הקוד הועתק ללוח",
        deactivate: "השבת",
        activate: "הפעל",
        edit: "ערוך",
        delete: "מחק",
      },

      form: {
        createTitle: "צור תבנית חדשה",
        editTitle: "ערוך תבנית",
        createDescription: "מלא את הפרטים ליצירת תבנית אימייל חדשה",
        editDescription: "עדכן את פרטי תבנית האימייל",

        fields: {
          name: "שם *",
          namePlaceholder: "לדוגמה: בקשת דוח חודשי מספק",
          code: "קוד *",
          codePlaceholder: "לדוגמה: supplier_monthly_request",
          type: "סוג",
          selectType: "בחר סוג",
          description: "תיאור",
          descriptionPlaceholder: "תיאור קצר של התבנית",
          subject: "נושא *",
          subjectPlaceholder: "לדוגמה: בקשה לדוח {{period}} - {{brand_name}}",
          insertVariables: "הוסף משתנים",
          htmlBody: "גוף HTML *",
          htmlBodyPlaceholder: "<p>שלום {{entity_name}},</p><p>נא לשלוח את הדוח לתקופת {{period}}...</p>",
          plainTextBody: "גוף טקסט פשוט (אופציונלי)",
          plainTextBodyPlaceholder: "שלום {{entity_name}}, נא לשלוח את הדוח לתקופת {{period}}...",
          isActive: "פעיל",
        },

        validation: {
          required: "שם, קוד, נושא וגוף HTML הם שדות חובה",
        },
      },

      preview: {
        title: "תצוגה מקדימה של האימייל",
        description: "תצוגה מקדימה של תבנית האימייל עם נתונים לדוגמה",
      },

      deleteDialog: {
        title: "האם אתה בטוח?",
        description: "פעולה זו לא ניתנת לביטול. תבנית האימייל תימחק לצמיתות.",
        cancel: "ביטול",
        confirm: "מחק",
        deleting: "מוחק...",
      },

      messages: {
        createSuccess: "התבנית נוצרה בהצלחה",
        updateSuccess: "התבנית עודכנה בהצלחה",
        deleteSuccess: "התבנית נמחקה בהצלחה",
        activateSuccess: "התבנית הופעלה בהצלחה",
        deactivateSuccess: "התבנית הושבתה בהצלחה",
        loadError: "שגיאה בטעינת תבניות האימייל",
        saveError: "שגיאה בשמירת התבנית",
        deleteError: "שגיאה במחיקת התבנית",
        statusUpdateError: "שגיאה בעדכון סטטוס התבנית",
        previewError: "שגיאה בתצוגה מקדימה",
      },

      statuses: {
        active: "פעיל",
        inactive: "לא פעיל",
      },

      templateTypes: {
        supplier_request: "בקשת ספק",
        franchisee_request: "בקשת זכיין",
        reminder: "תזכורת",
        file_request: "בקשת קובץ",
        custom: "מותאם אישית",
      },

      variableDescriptions: {
        entity_name: {
          label: "שם ישות",
          description: "שם הספק או הזכיין",
        },
        period: {
          label: "תקופה",
          description: "תקופת הדיווח (לדוגמה: ינואר 2024)",
        },
        upload_link: {
          label: "קישור העלאה",
          description: "קישור מאובטח להעלאת מסמכים",
        },
        deadline: {
          label: "מועד אחרון",
          description: "תאריך מועד אחרון לבקשה",
        },
        brand_name: {
          label: "שם מותג",
          description: "שם מותג הזכיינות",
        },
      },
    },

    // Franchisee Reminders
    franchiseeReminders: {
      title: "תזכורות זכיינים",

      // Stats
      stats: {
        totalReminders: "סה״כ תזכורות",
        pending: "ממתינות",
        sent: "נשלחו",
        upcomingThisWeek: "השבוע הקרוב",
      },

      // Filters
      filters: {
        allStatus: "כל הסטטוסים",
        pending: "ממתינות",
        sent: "נשלחו",
        dismissed: "נדחו",
        allTypes: "כל הסוגים",
        leaseOption: "אופציית שכירות",
        franchiseAgreement: "הסכם זכיינות",
        custom: "מותאם אישית",
        filterByStatus: "סנן לפי סטטוס",
        filterByType: "סנן לפי סוג",
      },

      // Actions
      actions: {
        addReminder: "הוסף תזכורת",
        refresh: "רענן",
        markAsSent: "סמן כנשלח",
        dismiss: "דחה",
      },

      // Status labels
      status: {
        pending: "ממתין",
        sent: "נשלח",
        acknowledged: "אושר",
        dismissed: "נדחה",
      },

      // Type labels
      types: {
        leaseOption: "אופציית שכירות",
        franchiseAgreement: "הסכם זכיינות",
        custom: "מותאם אישית",
      },

      // Form
      form: {
        createTitle: "צור תזכורת חדשה",
        editTitle: "ערוך תזכורת",
        createDescription: "מלא את הפרטים ליצירת תזכורת חדשה לזכיין",
        editDescription: "עדכן את פרטי התזכורת",

        fields: {
          franchisee: "זכיין",
          franchiseePlaceholder: "בחר זכיין",
          reminderType: "סוג תזכורת",
          typePlaceholder: "בחר סוג",
          title: "כותרת",
          titlePlaceholder: "לדוגמה: תום אופציית שכירות",
          reminderDate: "תאריך תזכורת",
          daysBeforeNotification: "ימים לפני התראה",
          recipients: "נמענים (אימיילים מופרדים בפסיקים)",
          recipientsPlaceholder: "email1@example.com, email2@example.com",
          description: "תיאור",
          descriptionPlaceholder: "פרטים נוספים על תזכורת זו",
        },

        validation: {
          requiredFields: "זכיין, כותרת, תאריך תזכורת ונמענים הם שדות חובה",
          invalidEmail: "פורמט אימייל לא תקין: {email}",
        },
      },

      // List
      list: {
        title: "תזכורות זכיינים",
        description: "נהל תזכורות עבור אופציות שכירות, הסכמי זכיינות והתראות מותאמות",
        emptyState: "לא נמצאו תזכורות. צור את התזכורת הראשונה!",
        franchisee: "זכיין:",
        reminderDate: "תאריך תזכורת:",
        notify: "התראה:",
        daysBeforeTemplate: "{days} ימים לפני",
        recipients: "נמענים:",
        recipientCount: "{count} נמענים",
        oneRecipient: "נמען אחד",
      },

      // Confirmation dialogs
      confirmDelete: "האם אתה בטוח שברצונך למחוק תזכורת זו? פעולה זו לא ניתנת לביטול.",

      // Error messages
      errors: {
        failedToFetch: "שגיאה בטעינת התזכורות",
        failedToCreate: "שגיאה ביצירת התזכורת",
        failedToUpdate: "שגיאה בעדכון התזכורת",
        failedToDelete: "שגיאה במחיקת התזכורת",
        failedToMarkAsSent: "שגיאה בסימון כנשלח",
        failedToDismiss: "שגיאה בדחיית התזכורת",
        failedToSave: "שגיאה בשמירת התזכורת",
      },
    },

    // Communication Schedules
    schedules: {
      title: "לוחות זמנים",
      description: "סקירת לוחות זמנים לבקשות קבצים מספקים וזכיינים",

      stats: {
        totalSuppliers: "סה״כ ספקים",
        withPendingRequests: "בקשות ממתינות",
        withoutEmail: "ללא אימייל",
      },

      filters: {
        allTypes: "כל הסוגים",
        suppliers: "ספקים",
        franchisees: "זכיינים",
        allFrequencies: "כל התדירויות",
        frequency: "תדירות",
      },

      frequencies: {
        weekly: "שבועי",
        bi_weekly: "דו-שבועי",
        monthly: "חודשי",
        quarterly: "רבעוני",
        semi_annual: "חצי שנתי",
        annual: "שנתי",
      },

      table: {
        name: "שם",
        type: "סוג",
        frequency: "תדירות",
        email: "אימייל",
        lastRequest: "בקשה אחרונה",
        nextRequest: "בקשה הבאה",
        pendingRequests: "בקשות ממתינות",
        actions: "פעולות",
        noEmail: "לא הוגדר",
        never: "מעולם לא",
      },

      actions: {
        refresh: "רענן",
        sendNow: "שלח עכשיו",
      },

      emptyState: "לא נמצאו לוחות זמנים",

      errors: {
        failedToFetch: "שגיאה בטעינת לוחות הזמנים",
        failedToSend: "שגיאה בשליחת הבקשה",
      },

      messages: {
        sendSuccess: "הבקשה נשלחה בהצלחה",
      },
    },

    // CRON Monitor
    cronMonitor: {
      title: "מעקב משימות",
      description: "מעקב ובקרה על משימות אוטומטיות",

      stats: {
        totalJobs: "סה״כ משימות",
        pendingItems: "פריטים ממתינים",
        lastRun: "הרצה אחרונה",
      },

      jobs: {
        fileRequests: {
          name: "בקשות קבצים",
          description: "שליחת בקשות קבצים מתוזמנות לספקים",
        },
        settlementRequests: {
          name: "בקשות התחשבנות",
          description: "שליחת בקשות התחשבנות לפי תדירות",
        },
        uploadReminders: {
          name: "תזכורות העלאה",
          description: "שליחת תזכורות לבקשות שטרם קיבלו מענה",
        },
        franchiseeReminders: {
          name: "תזכורות זכיינים",
          description: "שליחת תזכורות לזכיינים על מועדים חשובים",
        },
      },

      status: {
        ok: "תקין",
        pending: "ממתין",
        error: "שגיאה",
        running: "פועל",
      },

      pendingRequests: {
        title: "בקשות ממתינות לתשובה",
        emptyState: "אין בקשות ממתינות",
        sentAt: "נשלח",
        reminders: "תזכורות",
        sendReminder: "שלח תזכורת",
      },

      actions: {
        refresh: "רענן",
        runNow: "הפעל עכשיו",
        dryRun: "הרצה יבשה",
      },

      errors: {
        failedToFetch: "שגיאה בטעינת נתוני המשימות",
        failedToRun: "שגיאה בהפעלת המשימה",
      },

      messages: {
        runSuccess: "המשימה הופעלה בהצלחה",
        dryRunSuccess: "הרצה יבשה הושלמה",
      },
    },

    // Email Logs
    emailLogs: {
      title: "יומן אימיילים",
      description: "היסטוריית אימיילים שנשלחו מהמערכת",

      stats: {
        total: "סה״כ",
        delivered: "נמסרו",
        failed: "נכשלו",
        last24Hours: "24 שעות אחרונות",
      },

      filters: {
        allStatuses: "כל הסטטוסים",
        status: "סטטוס",
        allTemplates: "כל התבניות",
        template: "תבנית",
        dateRange: "טווח תאריכים",
        search: "חיפוש אימייל",
        searchPlaceholder: "הקלד כתובת אימייל...",
      },

      statuses: {
        pending: "ממתין",
        sent: "נשלח",
        delivered: "נמסר",
        failed: "נכשל",
        bounced: "חזר",
      },

      table: {
        recipient: "נמען",
        subject: "נושא",
        template: "תבנית",
        status: "סטטוס",
        sentAt: "נשלח",
        actions: "פעולות",
        noTemplate: "ללא תבנית",
      },

      details: {
        title: "פרטי אימייל",
        from: "מאת",
        to: "אל",
        subject: "נושא",
        template: "תבנית",
        status: "סטטוס",
        sentAt: "נשלח",
        deliveredAt: "נמסר",
        failedAt: "נכשל",
        errorMessage: "הודעת שגיאה",
        messageId: "מזהה הודעה",
        preview: "תצוגה מקדימה",
        close: "סגור",
      },

      actions: {
        refresh: "רענן",
        viewDetails: "צפה בפרטים",
        sendManual: "שלח מייל",
      },

      emptyState: "לא נמצאו אימיילים",

      errors: {
        failedToFetch: "שגיאה בטעינת יומן האימיילים",
        failedToSend: "שגיאה בשליחת האימייל",
      },

      messages: {
        sendSuccess: "האימייל נשלח בהצלחה",
      },

      // Manual send dialog
      sendDialog: {
        title: "שליחת אימייל ידני",
        description: "שלח אימייל חדש באמצעות תבנית קיימת",
        selectTemplate: "בחר תבנית",
        recipientEmail: "כתובת נמען",
        recipientEmailPlaceholder: "email@example.com",
        recipientName: "שם נמען (אופציונלי)",
        recipientNamePlaceholder: "שם הנמען",
        variables: "משתנים",
        variablesDescription: "מלא את המשתנים הנדרשים לתבנית",
        cancel: "ביטול",
        send: "שלח",
        sending: "שולח...",
      },
    },

    // Reports
    reports: {
      title: "דוחות",

      // Deposits report
      deposits: {
        title: "דוח מעקב פיקדונות",
        description: "מעקב אחר יתרות פיקדון לפי זכיין וספק",
        pageTitle: "דוח מעקב פיקדונות",
        backToDashboard: "לוח בקרה",
        breadcrumb: {
          admin: "ניהול",
          reports: "דוחות",
          deposits: "מעקב פיקדונות",
        },

        tabs: {
          byFranchisee: "לפי זכיין",
          byBrand: "לפי מותג",
          details: "פירוט",
        },

        columns: {
          franchisee: "זכיין",
          brand: "מותג",
          supplier: "ספק",
          deposits: "פיקדונות",
          runningBalance: "יתרה מצטברת",
          lastDate: "תאריך אחרון",
          status: "סטטוס",
          date: "תאריך",
          amount: "סכום",
          balance: "יתרה",
          description: "תיאור",
        },

        summary: {
          totalDeposits: "סה״כ פיקדונות",
          activeAccounts: "חשבונות פעילים",
          totalBalance: "יתרה כוללת",
        },

        filters: {
          title: "סינון",
          franchisee: "זכיין",
          allFranchisees: "כל הזכיינים",
          brand: "מותג",
          allBrands: "כל המותגים",
          supplier: "ספק",
          allSuppliers: "כל הספקים",
          fromDate: "מתאריך",
          toDate: "עד תאריך",
          clearFilters: "נקה סינון",
          applyFilters: "החל סינון",
        },

        actions: {
          refresh: "רענון",
          export: "ייצוא",
          exportToExcel: "ייצוא לאקסל",
          exportToPdf: "ייצוא ל-PDF",
        },

        emptyState: {
          title: "אין נתונים להצגה",
          description: "לא נמצאו פיקדונות לפי הקריטריונים שנבחרו",
        },

        errors: {
          loadFailed: "שגיאה בטעינת נתוני פיקדונות",
          exportFailed: "שגיאה בייצוא הדוח",
          title: "שגיאה",
          retry: "נסה שוב",
        },
      },

      // Unauthorized suppliers report
      unauthorized: {
        title: "דוח ספקים לא מורשים",
        description: "זיהוי ספקים שמופיעים ב-BKMV ללא הגדרה במערכת",
        pageTitle: "דוח ספקים לא מורשים",
        backToDashboard: "לוח בקרה",
        breadcrumb: {
          admin: "ניהול",
          reports: "דוחות",
          unauthorized: "ספקים לא מורשים",
        },

        columns: {
          bkmvName: "שם ספק (BKMV)",
          totalAmount: "סכום כולל",
          transactionCount: "מספר עסקאות",
          franchiseeCount: "מספר זכיינים",
          firstSeen: "נצפה לראשונה",
          lastSeen: "נצפה לאחרונה",
          fileCount: "מספר קבצים",
          actions: "פעולות",
        },

        summary: {
          totalSuppliers: "ספקים לא מורשים",
          totalAmount: "סכום כולל",
          affectedFranchisees: "זכיינים מושפעים",
          recentActivity: "פעילות אחרונה",
        },

        details: {
          title: "פרטי ספק לא מורשה",
          franchisees: "זכיינים",
          franchiseeName: "שם זכיין",
          amount: "סכום",
          transactions: "עסקאות",
          close: "סגור",
          viewDetails: "צפה בפרטים",
        },

        filters: {
          title: "סינון",
          search: "חיפוש לפי שם ספק",
          fromDate: "מתאריך",
          toDate: "עד תאריך",
          minAmount: "סכום מינימלי",
          franchisee: "זכיין",
          allFranchisees: "כל הזכיינים",
          clearFilters: "נקה סינון",
          applyFilters: "החל סינון",
        },

        actions: {
          refresh: "רענון",
          export: "ייצוא",
          exportToExcel: "ייצוא לאקסל",
          viewDetails: "צפה בפרטים",
        },

        emptyState: {
          title: "לא נמצאו ספקים לא מורשים",
          description: "כל הספקים ב-BKMV מוגדרים במערכת",
        },

        errors: {
          loadFailed: "שגיאה בטעינת נתונים",
          exportFailed: "שגיאה בייצוא הדוח",
          title: "שגיאה",
          retry: "נסה שוב",
        },
      },

      // Common report translations
      common: {
        export: "ייצוא",
        exportExcel: "ייצוא לאקסל",
        exportPdf: "ייצוא ל-PDF",
        loading: "טוען...",
        noData: "אין נתונים להצגה",
        error: "שגיאה בטעינת הנתונים",
        retry: "נסה שוב",
        filters: "סינון",
        clearFilters: "נקה סינון",
        search: "חיפוש",
        total: "סה״כ",
        period: "תקופה",
        date: "תאריך",
        amount: "סכום",
        refresh: "רענון",
        actions: "פעולות",
        cancel: "ביטול",
        confirm: "אישור",
        save: "שמור",
        close: "סגור",
        back: "חזור",
      },
    },
  },

  // ==========================================================================
  // FORMS - Shared form elements
  // ==========================================================================
  forms: {
    required: "שדה חובה",
    optional: "אופציונלי",
    selectPlaceholder: "בחר...",
    searchPlaceholder: "חפש...",

    validation: {
      required: "שדה זה הוא חובה",
      email: "כתובת אימייל לא תקינה",
      minLength: "מינימום {min} תווים",
      maxLength: "מקסימום {max} תווים",
      number: "יש להזין מספר תקין",
      positiveNumber: "יש להזין מספר חיובי",
      date: "תאריך לא תקין",
      phone: "מספר טלפון לא תקין",
    },
  },

  // ==========================================================================
  // ERRORS - Error messages
  // ==========================================================================
  errors: {
    generic: "אירעה שגיאה. נסה שוב.",
    networkError: "שגיאת רשת. בדוק את החיבור שלך.",
    unauthorized: "אין הרשאה לבצע פעולה זו",
    notFound: "הפריט לא נמצא",
    serverError: "שגיאת שרת. נסה שוב מאוחר יותר.",
    validationError: "יש לתקן את השגיאות בטופס",
    sessionExpired: "פג תוקף החיבור. יש להתחבר מחדש.",
    insufficientPermissions: "אין לך הרשאות מספיקות",

    // API errors
    failedToFetch: "שגיאה בטעינת הנתונים",
    failedToCreate: "שגיאה ביצירת הפריט",
    failedToUpdate: "שגיאה בעדכון הפריט",
    failedToDelete: "שגיאה במחיקת הפריט",
    failedToSave: "שגיאה בשמירת הנתונים",
  },

  // ==========================================================================
  // STATUS - Status labels and badges
  // ==========================================================================
  status: {
    // User status
    user: {
      active: "פעיל",
      pending: "ממתין",
      suspended: "מושעה",
      unknown: "לא ידוע",
    },

    // General status
    general: {
      active: "פעיל",
      inactive: "לא פעיל",
      enabled: "מופעל",
      disabled: "מושבת",
    },
  },

  // ==========================================================================
  // ROLES - User role labels
  // ==========================================================================
  roles: {
    super_user: "משתמש על",
    admin: "מנהל",
    franchisee_owner: "בעל זכיינות",
    noRole: "ללא תפקיד",
  },

  // ==========================================================================
  // UPLOAD PAGE - Public upload page
  // ==========================================================================
  upload: {
    loading: "טוען...",
    error: "שגיאה",
    invalidLink: "קישור לא תקין",
    loadingError: "שגיאה בטעינת הקישור",

    success: {
      title: "הקבצים הועלו בהצלחה!",
      message: "תודה רבה. הקבצים נשמרו במערכת.",
      uploadedFiles: "קבצים שהועלו:",
    },

    info: {
      for: "עבור:",
      filesToUpload: "קבצים להעלאה:",
      maxSize: "גודל מקסימלי:",
      validUntil: "בתוקף עד:",
      allowedTypes: "סוגי קבצים מותרים:",
    },

    fileUpload: {
      dragHere: "גרור קובץ לכאן",
      orClick: "או לחץ לבחירת קובץ",
      removeFile: "הסר קובץ",
      uploading: "מעלה...",
      uploadButton: "העלה קובץ",
    },

    email: {
      label: "כתובת אימייל (אופציונלי)",
      placeholder: "your@email.com",
      hint: "הזן כתובת אימייל אם ברצונך לקבל אישור על ההעלאה",
    },

    errors: {
      invalidFileType: "סוג קובץ לא מורשה",
      fileTooLarge: "גודל הקובץ חורג מהמקסימום ({maxSize})",
      uploadFailed: "שגיאה בהעלאת הקובץ",
    },

    entityTypes: {
      brand: "מותג",
      supplier: "ספק",
      franchisee: "זכיין",
    },
  },

  // ==========================================================================
  // COMPONENTS - Reusable component strings
  // ==========================================================================
  components: {
    // Permissions Editor
    permissionsEditor: {
      title: "הרשאות עבור {userName}",
      description: "הגדר הרשאות ברמת מודול עבור משתמש זה.",
      customPermissions: "הרשאות מותאמות",
      usingRoleDefaults: "משתמש בברירות מחדל לתפקיד",

      // Table headers
      moduleHeader: "מודול",

      // Module names
      modules: {
        brands: "מותגים",
        suppliers: "ספקים",
        franchisees: "זכיינים",
        documents: "מסמכים",
        settlements: "התחשבנויות",
        commissions: "עמלות",
        reminders: "תזכורות",
        users: "משתמשים",
        email_templates: "תבניות אימייל",
        management_companies: "חברות ניהול",
      },

      // Permission actions
      actions: {
        view: "צפייה",
        edit: "עריכה",
        create: "יצירה",
        delete: "מחיקה",
        approve: "אישור",
      },

      // Buttons
      resetToDefaults: "אפס לברירות מחדל",
      cancel: "ביטול",
      savePermissions: "שמור הרשאות",

      // Messages
      errors: {
        loadFailed: "שגיאה בטעינת הרשאות",
        saveFailed: "שגיאה בשמירת הרשאות",
        resetFailed: "שגיאה באיפוס הרשאות",
      },

      // Confirm dialog
      confirmReset: "האם אתה בטוח שברצונך לאפס את ההרשאות לברירות המחדל של התפקיד? פעולה זו תסיר את כל ההרשאות המותאמות.",
    },

    // Alias Manager
    aliasManager: {
      addAlias: "הוסף",
      placeholder: "הוסף כינוי...",
      noAliases: "עדיין לא נוספו כינויים",
      removeAliasLabel: "הסר כינוי",

      // Help section
      help: {
        title: "למה להשתמש בכינויים?",
        description: "כינויים עוזרים לזהות את הזכיין כשספקים משתמשים בשמות שונים בקבצים שלהם.",
        examplesTitle: "דוגמאות:",
        examples: {
          shortNames: "וריאציות קצרות של השם (לדוגמה: \"פאט ויני ת\"א\" במקום \"פאט ויני תל אביב\")",
          alternativeSpellings: "כתיב חלופי (לדוגמה: \"Pat Vini\" במקום \"פאט ויני\")",
          branchNumbers: "מספרי סניף (לדוגמה: \"סניף 001\", \"Branch 1\")",
          internalCodes: "קודים פנימיים שמשמשים ספקים",
        },
      },

      // Limit indicator
      limitIndicator: "{current} / {max} כינויים",
    },

    // File Mapping Config
    fileMappingConfig: {
      title: "הגדרת מיפוי קבצים",
      description: "הגדר כיצד לנתח קבצי דוחות ספק (xlsx, csv, xls)",
      configured: "מוגדר",
      expand: "הרחב",
      collapse: "כווץ",

      // Messages
      messages: {
        saveSuccess: "מיפוי הקובץ נשמר בהצלחה",
        saveError: "שמירת מיפוי הקובץ נכשלה",
        deleteSuccess: "מיפוי הקובץ הוסר בהצלחה",
        deleteError: "מחיקת מיפוי הקובץ נכשלה",
        deleteConfirm: "האם אתה בטוח שברצונך להסיר את הגדרת מיפוי הקובץ?",
      },

      // File Type
      fileType: {
        label: "סוג קובץ *",
        placeholder: "בחר סוג קובץ",
        xlsx: "Excel (.xlsx)",
        xls: "Excel Legacy (.xls)",
        csv: "CSV (.csv)",
      },

      // Column Mappings
      columnMappings: {
        title: "מיפוי עמודות",
        franchiseeColumn: {
          label: "עמודת זכיין *",
          placeholder: "לדוגמה: A או שם_עמודה",
          description: "אות עמודה (A, B, C) או שם כותרת העמודה",
        },
        amountColumn: {
          label: "עמודת סכום *",
          placeholder: "לדוגמה: B או סכום",
          description: "עמודה לסכומים כספיים",
        },
        dateColumn: {
          label: "עמודת תאריך *",
          placeholder: "לדוגמה: C או תאריך",
          description: "עמודה לתאריכי עסקאות",
        },
      },

      // Row Configuration
      rowConfig: {
        title: "הגדרת שורות",
        headerRow: {
          label: "שורת כותרת *",
          description: "מספר השורה המכילה את כותרות העמודות",
        },
        dataStartRow: {
          label: "שורת התחלת נתונים *",
          description: "השורה הראשונה המכילה נתונים בפועל",
        },
        rowsToSkip: {
          label: "שורות לדילוג בסוף",
          placeholder: "אופציונלי",
          description: "מספר שורות לדילוג בסוף (לדוגמה: סיכומים)",
        },
      },

      // Skip Keywords
      skipKeywords: {
        title: "מילות מפתח לדילוג",
        description: "שורות המכילות מילות מפתח אלו ידולגו בעת הניתוח (לדוגמה: שורות פיקדון, שורות סיכום)",
        noKeywords: "לא הוגדרו מילות מפתח לדילוג",
        placeholder: "הוסף מילת מפתח (לדוגמה: פיקדון, deposit)",
        addButton: "הוסף",
      },

      // Actions
      actions: {
        removeConfiguration: "הסר הגדרה",
        saveConfiguration: "שמור הגדרה",
      },
    },

    // Document Manager
    documentManager: {
      title: "מסמכים",
      manageDocuments: "ניהול מסמכים עבור {entityName}",
      uploadDocument: "העלה מסמך",
      noDocuments: "טרם הועלו מסמכים",
      clickToUpload: "לחץ על \"העלה מסמך\" להוספת מסמך",

      // Upload dialog
      uploadDialog: {
        title: "העלאת מסמך",
        description: "העלה מסמך חדש עבור {entityName}",
        fileLabel: "קובץ",
        selected: "נבחר: {fileName} ({fileSize})",
        nameLabel: "שם המסמך",
        namePlaceholder: "הזן שם מסמך",
        typeLabel: "סוג מסמך",
        typePlaceholder: "בחר סוג",
        descriptionLabel: "תיאור (אופציונלי)",
        descriptionPlaceholder: "הזן תיאור",
        uploading: "מעלה...",
        upload: "העלה",
      },

      // Edit dialog
      editDialog: {
        title: "עריכת מסמך",
        description: "עדכן פרטי מסמך",
        statusLabel: "סטטוס",
        statusPlaceholder: "בחר סטטוס",
        saving: "שומר...",
        saveChanges: "שמור שינויים",
      },

      // Document types
      documentTypes: {
        agreement: "הסכם",
        correspondence: "התכתבות",
        invoice: "חשבונית",
        other: "אחר",
      },

      // Document statuses
      statuses: {
        active: "פעיל",
        draft: "טיוטה",
        expired: "פג תוקף",
        archived: "בארכיון",
      },

      // Validation errors
      errors: {
        selectFile: "נא לבחור קובץ",
        enterName: "נא להזין שם מסמך",
      },

      // Size labels
      unknownSize: "גודל לא ידוע",

      // Action buttons
      download: "הורד",
      edit: "ערוך",
      deleteConfirm: "אשר",
    },

    // Manual Adjustment Form
    manualAdjustmentForm: {
      title: "הוספת התאמה ידנית",
      description: "הוסף התאמה ידנית לתקופת ההתחשבנות לטיפול בפערים",
      triggerButton: "הוספת התאמה ידנית",

      // Form labels
      adjustmentType: "סוג התאמה",
      adjustmentTypePlaceholder: "בחר סוג התאמה",
      amount: "סכום",
      amountPlaceholder: "הזן סכום",
      reason: "סיבה",
      reasonPlaceholder: "הזן סיבת ההתאמה",
      description_field: "תיאור",
      descriptionPlaceholder: "הזן תיאור מפורט",
      descriptionOptional: "(אופציונלי)",
      descriptionRequired: "תיאור נדרש עבור סוג \"אחר\"",
      referenceNumber: "מספר אסמכתא",
      referenceNumberOptional: "(אופציונלי)",
      referenceNumberPlaceholder: "הזן מספר אסמכתא",
      required: "*",

      // Adjustment types
      adjustmentTypes: {
        credit: "זיכוי",
        deposit: "פיקדון",
        supplierError: "טעות ספק",
        timing: "הפרשי עיתוי",
        other: "אחר",
      },

      // Buttons
      cancel: "ביטול",
      save: "שמור התאמה",
      saving: "שומר...",

      // Error messages
      errors: {
        failedToCreate: "נכשל ביצירת התאמה",
        unexpectedError: "אירעה שגיאה",
      },
    },

    // Franchisee Detail Card
    franchiseeDetailCard: {
      title: "פרטי זכיין",
      // Add more strings as needed
    },
  },

  // ==========================================================================
  // RECONCILIATION V2 (Supplier Reconciliation)
  // ==========================================================================
  reconciliationV2: {
    pageTitle: "התאמות ספקים",
    selectSupplier: "בחר ספק",
    selectPeriod: "בחר תקופה",
    startReconciliation: "התחל התאמה",
    continueSession: "המשך עבודה על סשן קיים",
    supplierData: "נתוני ספק",
    franchiseeData: "נתוני זכיין",
    supplierAmount: "סכום ספק",
    franchiseeAmount: "סכום זכיין",
    difference: "הפרש",
    approve: "אישור",
    toReview: "לבדיקה",
    matched: "תואם",
    needsReview: "לבדיקה",
    autoApproved: "אושר אוטומטית",
    manuallyApproved: "אושר ידנית",
    approveFile: "אשר קובץ",
    rejectFile: "דחה קובץ",
    rejectionReason: "סיבת דחייה",
    sendNewUploadLink: "שלח קישור העלאה חדש",
    reviewQueue: "תור בדיקה",
    history: "היסטוריה",
    resolve: "פתור",
    notes: "הערות",
    noItems: "אין פריטים",

    // Session statuses
    status: {
      inProgress: "בתהליך",
      completed: "הושלם",
      fileApproved: "קובץ אושר",
      fileRejected: "קובץ נדחה",
      pending: "ממתין",
      resolved: "נפתר",
      sentToReviewQueue: "בתור בדיקה",
    },

    // Statistics
    stats: {
      totalFranchisees: "סה״כ זכיינים",
      matched: "מאושרים",
      needsReview: "לבדיקה",
      inQueue: "בתור",
      totalDifference: "סה״כ הפרש",
    },

    // Messages
    messages: {
      sessionCreated: "סשן התאמה נוצר בהצלחה",
      comparisonApproved: "השוואה אושרה",
      addedToQueue: "נוסף לתור בדיקה",
      fileApproved: "קובץ אושר בהצלחה",
      fileRejected: "קובץ נדחה",
      itemResolved: "פריט נפתר בהצלחה",
      errorCreatingSession: "שגיאה ביצירת סשן התאמה",
      errorApprovingComparison: "שגיאה באישור השוואה",
      errorAddingToQueue: "שגיאה בהוספה לתור בדיקה",
      errorApprovingFile: "שגיאה באישור הקובץ",
      errorRejectingFile: "שגיאה בדחיית הקובץ",
      errorResolvingItem: "שגיאה בפתרון פריט",
    },

    // Info section
    info: {
      howItWorks: "איך זה עובד?",
      step1Title: "בחירת ספק ותקופה",
      step1Desc: "בחר ספק שיש לו קבצים מעובדים ותקופה להשוואה",
      step2Title: "השוואת סכומים",
      step2Desc: "המערכת משווה את סכומי הספק לסכומים מקבצי BKMVDATA של הזכיינים",
      step3Title: "סף ₪30",
      step3Desc: "הפרשים עד ₪30 מאושרים אוטומטית. הפרשים גדולים יותר דורשים אישור ידני",
      step4Title: "אישור או דחיית הקובץ",
      step4Desc: "לאחר בדיקת כל הפערים, ניתן לאשר או לדחות את קובץ הספק",
    },

    // Review queue
    reviewQueuePage: {
      title: "תור בדיקת פערים",
      description: "פריטים שנשלחו לבדיקה ידנית מסשנים שונים",
      pendingItems: "פריטים ממתינים",
      pendingItemsDesc: "רשימת כל הפריטים שממתינים לבדיקה ופתרון",
      noItemsTitle: "אין פריטים בתור בדיקה!",
      noItemsDesc: "כל הפערים נפתרו",
    },

    // History page
    historyPage: {
      title: "היסטוריית התאמות",
      description: "צפייה בכל ההתאמות שבוצעו לאורך זמן",
      filters: "סינון",
      results: "תוצאות",
      noResults: "לא נמצאו רשומות היסטוריה",
      allSuppliers: "כל הספקים",
      allFranchisees: "כל הזכיינים",
      fromDate: "מתאריך",
      toDate: "עד תאריך",
      applyFilter: "החל סינון",
      clearFilter: "נקה סינון",
    },
  },

  // ==========================================================================
  // SIDEBAR NAVIGATION
  // ==========================================================================
  sidebar: {
    // Brand
    brandName: "LaTable",
    brandSubtitle: "מערכת ניהול",

    // Main navigation items
    navigation: {
      dashboard: "לוח בקרה",
      settlementWorkflow: "תהליך התחשבנות",
      dataManagement: "ניהול נתונים",
      reports: "דוחות",
      settings: "הגדרות",
      archive: "ארכיון",
    },

    // Sub-navigation items
    subNavigation: {
      // Settlement Workflow
      settlements: "התחשבנויות",
      reconciliation: "התאמות",
      commissions: "עמלות",
      settlementSimple: "התחשבנות",

      // Data Management
      suppliers: "ספקים",
      franchisees: "זכיינים",
      brands: "מותגים",
      bkmvdata: "מבנה אחיד",
      supplierFiles: "קבצי ספקים",

      // Reports
      supplierReconciliation: "התאמות ספקים",
      reportsHub: "מרכז דוחות",
      commissionsReport: "דוח עמלות",
      varianceReport: "דוח סטיות",
      invoiceReport: "דוח חשבוניות",
      unauthorizedReport: "ספקים לא מורשים",
      depositsReport: "מעקב פיקדונות",
      filesReport: "ניהול קבצים",
      supplierFilesReport: "נתוני קבצי ספקים",
      hashavshevetExport: "ייצוא לחשבשבת",
      generalReports: "דוחות כלליים",

      // Settings
      users: "משתמשים",
      communications: "תקשורת",
      vatRates: "שיעורי מע״מ",
    },

    // User section
    user: {
      profile: "פרופיל",
      signOut: "התנתק",
    },

    // Toggle
    collapse: "כווץ תפריט",
    expand: "הרחב תפריט",
  },
} as const;

// Type export for the translations object
export type HebrewTranslations = typeof he;
