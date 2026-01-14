"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  LogOut,
  ChevronRight,
  RefreshCw,
  Loader2,
  Calendar,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Building2,
  FileText,
  Upload,
  GitCompare,
  Settings,
  FileCheck,
  ArrowLeft,
  Lock,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, SettlementStatus, SettlementPeriodType } from "@/db/schema";
import {
  WorkflowStepper,
  getStepFromStatus,
  WORKFLOW_STEPS,
  type WorkflowStep,
  type StepConfig,
} from "@/components/settlements/WorkflowStepper";

// Settlement data from API
interface SettlementData {
  id: string;
  name: string;
  periodType: SettlementPeriodType;
  periodStartDate: string;
  periodEndDate: string;
  status: SettlementStatus;
  dueDate: string | null;
  notes: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  franchisee?: {
    id: string;
    name: string;
    code: string;
  } | null;
  approvedByUser?: {
    name: string;
    email: string;
  } | null;
}

// Status configuration
const statusConfig: Record<
  SettlementStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }
> = {
  open: { label: "פתוח", variant: "outline", color: "text-blue-600" },
  processing: { label: "בעיבוד", variant: "secondary", color: "text-amber-600" },
  pending_approval: { label: "ממתין לאישור", variant: "default", color: "text-amber-600" },
  approved: { label: "מאושר", variant: "default", color: "text-green-600" },
  invoiced: { label: "חשבונית הופקה", variant: "secondary", color: "text-green-600" },
  // Legacy statuses
  draft: { label: "טיוטה", variant: "outline", color: "text-gray-600" },
  pending: { label: "ממתין", variant: "secondary", color: "text-amber-600" },
  completed: { label: "הושלם", variant: "default", color: "text-green-600" },
  cancelled: { label: "בוטל", variant: "destructive", color: "text-red-600" },
};

// Period type labels
const periodTypeLabels: Record<SettlementPeriodType, string> = {
  monthly: "חודשי",
  quarterly: "רבעוני",
  semi_annual: "חצי שנתי",
  annual: "שנתי",
};

// Quick action cards
interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  color: string;
  disabled?: boolean;
}

export default function SettlementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const settlementId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [settlement, setSettlement] = useState<SettlementData | null>(null);
  const [allowedTransitions, setAllowedTransitions] = useState<string[]>([]);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;
  const isSuperUser = userRole === "super_user";

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlements/${settlementId}`);
      return;
    }

    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session && settlementId) {
      fetchSettlement();
    }
  }, [session, isPending, router, userRole, settlementId]);

  const fetchSettlement = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/settlements/${settlementId}?details=true`);
      if (!response.ok) {
        if (response.status === 404) {
          toast.error("תקופת התחשבנות לא נמצאה");
          router.push("/admin/settlements");
          return;
        }
        throw new Error("Failed to fetch settlement");
      }
      const data = await response.json();
      setSettlement(data.settlement);
      setAllowedTransitions(data.allowedTransitions || []);
    } catch (error) {
      console.error("Error fetching settlement:", error);
      toast.error("שגיאה בטעינת התקופה");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const response = await fetch(`/api/settlements/${settlementId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: newStatus }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update status");
      }

      toast.success("הסטטוס עודכן בהצלחה");
      await fetchSettlement();
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה בעדכון הסטטוס");
    }
  };

  const handleStepClick = (step: StepConfig) => {
    router.push(`/admin/settlements/${settlementId}/${step.href}`);
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString("he-IL", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isLocked = settlement?.status === "approved" || settlement?.status === "invoiced";

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!settlement) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">תקופת התחשבנות לא נמצאה</h2>
          <Button onClick={() => router.push("/admin/settlements")}>
            חזרה לרשימת התקופות
          </Button>
        </div>
      </div>
    );
  }

  const currentStep = getStepFromStatus(settlement.status);

  // Quick actions based on current step
  const quickActions: QuickAction[] = [
    {
      id: "files",
      label: "ניהול קבצים",
      description: "העלאה וצפייה בקבצים מספקים",
      icon: <Upload className="h-6 w-6" />,
      href: "files",
      color: "bg-blue-500",
    },
    {
      id: "reconciliation",
      label: "הצלבה",
      description: "הצלבת נתונים בין ספקים לזכיינים",
      icon: <GitCompare className="h-6 w-6" />,
      href: "reconciliation",
      color: "bg-purple-500",
    },
    {
      id: "adjustments",
      label: "התאמות",
      description: "טיפול בפערים והוספת התאמות",
      icon: <Settings className="h-6 w-6" />,
      href: "adjustments",
      color: "bg-amber-500",
    },
    {
      id: "reports",
      label: "דוחות",
      description: "הפקת דוחות וחשבוניות",
      icon: <FileCheck className="h-6 w-6" />,
      href: "reports",
      color: "bg-green-500",
    },
  ];

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/settlements">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1" />
              חזרה לתקופות
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{settlement.name}</h1>
              {isLocked && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  נעול
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {periodTypeLabels[settlement.periodType]} •{" "}
              {formatDate(settlement.periodStartDate)} - {formatDate(settlement.periodEndDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchSettlement}>
            <RefreshCw className="ml-2 h-4 w-4" />
            רענון
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="ml-2 h-4 w-4" />
            התנתקות
          </Button>
        </div>
      </div>

      {/* Status Badge */}
      <div className="mb-6">
        <Badge
          variant={statusConfig[settlement.status].variant}
          className={`text-sm px-3 py-1 ${
            settlement.status === "approved"
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
              : settlement.status === "pending_approval"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
              : ""
          }`}
        >
          {statusConfig[settlement.status].label}
        </Badge>
      </div>

      {/* Workflow Stepper */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            תהליך התחשבנות
          </CardTitle>
          <CardDescription>
            לחץ על שלב כדי לעבור אליו
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowStepper
            currentStep={currentStep}
            settlementId={settlementId}
            onStepClick={handleStepClick}
          />
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Settlement Details */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              פרטי התקופה
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">סוג תקופה:</span>
              <Badge variant="outline">{periodTypeLabels[settlement.periodType]}</Badge>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך התחלה:</span>
              <span>{formatDate(settlement.periodStartDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך סיום:</span>
              <span>{formatDate(settlement.periodEndDate)}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך יעד:</span>
              <span>{formatDate(settlement.dueDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">נוצר:</span>
              <span>{formatDateTime(settlement.createdAt)}</span>
            </div>
            {settlement.approvedAt && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">אושר:</span>
                  <span>{formatDateTime(settlement.approvedAt)}</span>
                </div>
                {settlement.approvedByUser && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ע״י:</span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      {settlement.approvedByUser.name}
                    </span>
                  </div>
                )}
              </>
            )}
            {settlement.notes && (
              <>
                <Separator />
                <div>
                  <span className="text-muted-foreground block mb-1">הערות:</span>
                  <p className="text-sm bg-muted p-2 rounded">{settlement.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              פעולות מהירות
            </CardTitle>
            <CardDescription>
              בחר פעולה להמשיך בתהליך ההתחשבנות
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {quickActions.map((action) => (
                <Link
                  key={action.id}
                  href={`/admin/settlements/${settlementId}/${action.href}`}
                  className="block"
                >
                  <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-2 hover:border-primary/50">
                    <CardContent className="p-4 flex items-start gap-4">
                      <div
                        className={`p-3 rounded-lg text-white ${action.color}`}
                      >
                        {action.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{action.label}</h3>
                        <p className="text-sm text-muted-foreground">
                          {action.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Actions */}
      {allowedTransitions.length > 0 && !isLocked && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              שינוי סטטוס
            </CardTitle>
            <CardDescription>
              פעולות זמינות לשינוי סטטוס התקופה
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {allowedTransitions.includes("start_processing") && (
                <Button onClick={() => handleStatusChange("start_processing")}>
                  <Play className="ml-2 h-4 w-4" />
                  התחל עיבוד
                </Button>
              )}
              {allowedTransitions.includes("submit_for_approval") && (
                <Button onClick={() => handleStatusChange("submit_for_approval")}>
                  <CheckCircle2 className="ml-2 h-4 w-4" />
                  שלח לאישור
                </Button>
              )}
              {allowedTransitions.includes("approve") && isSuperUser && (
                <Button
                  onClick={() => handleStatusChange("approve")}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="ml-2 h-4 w-4" />
                  אשר תקופה
                </Button>
              )}
              {allowedTransitions.includes("invoice") && isSuperUser && (
                <Button onClick={() => handleStatusChange("invoice")} variant="outline">
                  <FileCheck className="ml-2 h-4 w-4" />
                  הפק חשבונית
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
