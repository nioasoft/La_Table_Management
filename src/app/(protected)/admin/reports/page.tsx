"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Coins,
  TrendingUp,
  AlertTriangle,
  Wallet,
  FileBarChart,
  ChevronLeft,
  ArrowLeft,
  Receipt,
  Building2,
  Store,
  Tag,
  FileSpreadsheet,
} from "lucide-react";

// Report card data
interface ReportCardData {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  status: "active" | "coming_soon";
  color: string;
}

const reportCards: ReportCardData[] = [
  {
    title: "דוח עמלות",
    description: "סיכום עמלות כולל עם פירוט לפי מותג, ספק ותקופה. כולל ייצוא לאקסל ו-PDF.",
    href: "/admin/reports/commissions",
    icon: <Coins className="h-6 w-6" />,
    status: "active",
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    title: "דוח סטיות",
    description: "השוואת אחוזי רכש בין תקופות וזיהוי סטיות חריגות מעל סף מוגדר.",
    href: "/admin/reports/variance",
    icon: <TrendingUp className="h-6 w-6" />,
    status: "active",
    color: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "ספקים לא מורשים",
    description: "זיהוי ספקים שמופיעים בקבצי BKMV אך אינם רשומים במערכת עם הסכם עמלות.",
    href: "/admin/reports/unauthorized",
    icon: <AlertTriangle className="h-6 w-6" />,
    status: "active",
    color: "text-orange-600",
  },
  {
    title: "מעקב פיקדונות",
    description: "מעקב אחר פיקדונות ספקי אלכוהול - יתרות פתוחות ותנועות לפי ספק וזכיין.",
    href: "/admin/reports/deposits",
    icon: <Wallet className="h-6 w-6" />,
    status: "active",
    color: "text-purple-600",
  },
  {
    title: "דוח חשבוניות",
    description: "הפקת חשבוניות לספקים לפי מותג ותקופה - מוכן לייצוא לאקסל וחשבשבת.",
    href: "/admin/reports/invoice",
    icon: <Receipt className="h-6 w-6" />,
    status: "active",
    color: "text-indigo-600",
  },
  {
    title: "דוח עמלות לפי ספק",
    description: "פירוט עמלות לכל ספק עם השוואה לתקופות קודמות והצגת מגמות.",
    href: "/admin/commissions/supplier",
    icon: <Building2 className="h-6 w-6" />,
    status: "active",
    color: "text-cyan-600 dark:text-cyan-400",
  },
  {
    title: "דוח רכישות לפי זכיין",
    description: "סיכום רכישות וחיובים לכל זכיין לפי תקופות עם ניתוח פילוחים.",
    href: "/admin/commissions/franchisee",
    icon: <Store className="h-6 w-6" />,
    status: "active",
    color: "text-pink-600 dark:text-pink-400",
  },
  {
    title: "דוח עמלות לפי מותג",
    description: "ניתוח עמלות לפי מותג - פת ויני, מינה טומאי, קינג קונג עם סיכום כולל.",
    href: "/admin/commissions/brand",
    icon: <Tag className="h-6 w-6" />,
    status: "active",
    color: "text-amber-600 dark:text-amber-400",
  },
  {
    title: "נתוני קבצי ספקים",
    description: "צפייה בקבצים שהועלו מספקים - סכומים, עמלות מחושבות ואפשרות הורדה.",
    href: "/admin/reports/supplier-files",
    icon: <FileSpreadsheet className="h-6 w-6" />,
    status: "active",
    color: "text-teal-600 dark:text-teal-400",
  },
];

export default function ReportsHubPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports");
      return;
    }

    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <nav className="flex items-center space-x-1 space-x-reverse text-sm text-muted-foreground mb-2">
          <Link href="/admin" className="hover:text-foreground">
            ניהול
          </Link>
          <ChevronLeft className="h-4 w-4 rotate-180" />
          <span className="text-foreground">דוחות</span>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">מרכז דוחות</h1>
        <p className="text-muted-foreground mt-1">
          בחר את סוג הדוח שברצונך להציג או לייצא
        </p>
      </div>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reportCards.map((report) => (
          <Card
            key={report.href}
            className="group hover:shadow-lg transition-all duration-200 hover:border-primary/50"
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className={`p-2 rounded-lg bg-muted ${report.color}`}>
                  {report.icon}
                </div>
                {report.status === "coming_soon" && (
                  <span className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-1 rounded-full">
                    בקרוב
                  </span>
                )}
              </div>
              <CardTitle className="text-xl mt-4">{report.title}</CardTitle>
              <CardDescription className="text-sm">
                {report.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                variant={report.status === "active" ? "default" : "secondary"}
                disabled={report.status === "coming_soon"}
                className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
              >
                <Link href={report.href}>
                  <FileBarChart className="h-4 w-4 me-2" />
                  צפה בדוח
                  <ArrowLeft className="h-4 w-4 ms-2 group-hover:translate-x-[-4px] transition-transform" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Stats Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">גישה מהירה</CardTitle>
          <CardDescription>
            קישורים ישירים לדוחות נפוצים ואפשרויות ייצוא
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href="/admin/reports/commissions?status=pending">
                <Coins className="h-4 w-4 me-2" />
                עמלות ממתינות
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/reports/variance">
                <TrendingUp className="h-4 w-4 me-2" />
                סטיות חריגות
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/reports/unauthorized">
                <AlertTriangle className="h-4 w-4 me-2" />
                ספקים לא מורשים
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/reports/invoice">
                <Receipt className="h-4 w-4 me-2" />
                הפקת חשבוניות
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/reports/supplier-files">
                <FileSpreadsheet className="h-4 w-4 me-2" />
                קבצי ספקים
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
