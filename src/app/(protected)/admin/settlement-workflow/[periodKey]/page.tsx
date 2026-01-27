"use client";

import { useEffect, useState, useMemo } from "react";
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
  Play,
  Mail,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, SettlementPeriodType, FileRequestStatus } from "@/db/schema";
import {
  WorkflowStepper,
  type WorkflowStep,
  type StepConfig,
} from "@/components/settlements/WorkflowStepper";
import { getPeriodByKey, formatPeriodRange, getPeriodTypeLabel } from "@/lib/settlement-periods";

// Supplier info
interface SupplierInfo {
  id: string;
  name: string;
  code: string;
  email: string | null;
  contactName: string | null;
  fileRequest: {
    id: string;
    status: FileRequestStatus;
    uploadUrl: string | null;
    sentAt: string | null;
    submittedAt: string | null;
    filesUploaded: number;
  } | null;
}

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

export default function PeriodWorkflowPage() {
  const router = useRouter();
  const params = useParams();
  const periodKey = decodeURIComponent(params.periodKey as string);

  const [isLoading, setIsLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierInfo[]>([]);
  const [isSendingRequests, setIsSendingRequests] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("collecting");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  // Parse period info from key (memoized to prevent infinite loop)
  const periodInfo = useMemo(() => getPeriodByKey(periodKey), [periodKey]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlement-workflow/${encodeURIComponent(periodKey)}`);
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

    // Use periodKey to get periodInfo inside effect to avoid dependency issues
    const currentPeriodInfo = getPeriodByKey(periodKey);
    if (!isPending && session && currentPeriodInfo) {
      fetchSuppliers(currentPeriodInfo.type);
    }
  }, [session, isPending, router, userRole, periodKey]);

  const fetchSuppliers = async (periodType: SettlementPeriodType) => {
    try {
      setIsLoading(true);
      // Fetch suppliers for this period frequency
      const response = await fetch(`/api/settlements/periods?frequency=${periodType}&includeFileRequests=true&periodKey=${encodeURIComponent(periodKey)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch suppliers");
      }
      const data = await response.json();
      // Get suppliers for this frequency
      const frequencySuppliers = data.suppliersByFrequency?.[periodType] || [];
      const suppliersWithStatus = frequencySuppliers.map((supplier: {
        id: string;
        name: string;
        code: string;
        email?: string | null;
        contactName?: string | null;
      }) => ({
        ...supplier,
        email: supplier.email || null,
        contactName: supplier.contactName || null,
        fileRequest: data.fileRequests?.find((fr: { entityId: string }) => fr.entityId === supplier.id) || null,
      }));
      setSuppliers(suppliersWithStatus);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      toast.error("שגיאה בטעינת הספקים");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStepClick = (step: StepConfig) => {
    // Navigate to the step's page
    router.push(`/admin/settlement-workflow/${encodeURIComponent(periodKey)}/${step.href}`);
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const sendFileRequest = async (supplier: SupplierInfo) => {
    if (!supplier.email) {
      throw new Error("לספק זה לא מוגדר אימייל");
    }

    const response = await fetch("/api/file-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "supplier",
        entityId: supplier.id,
        documentType: `דוח ${getPeriodTypeLabel(periodInfo?.type || "quarterly")} - ${periodInfo?.nameHe}`,
        recipientEmail: supplier.email,
        recipientName: supplier.contactName || supplier.name,
        sendImmediately: true,
        dueDate: periodInfo?.dueDate?.toISOString().split("T")[0],
        metadata: {
          periodKey,
          periodType: periodInfo?.type,
        },
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to send request");
    }
  };

  const handleSendRequests = async () => {
    if (!periodInfo || isSendingRequests) return;

    const suppliersToSend = suppliers.filter((supplier) => supplier.email && !supplier.fileRequest);
    if (suppliersToSend.length === 0) {
      toast.info("כל הבקשות כבר נשלחו");
      return;
    }

    setIsSendingRequests(true);
    const failedSuppliers: string[] = [];

    for (const supplier of suppliersToSend) {
      try {
        await sendFileRequest(supplier);
      } catch (error) {
        console.error(`Error sending request to ${supplier.name}:`, error);
        failedSuppliers.push(supplier.name);
      }
    }

    if (failedSuppliers.length > 0) {
      toast.error(`שגיאה בשליחת בקשות ל-${failedSuppliers.length} ספקים`);
    } else {
      toast.success(`נשלחו ${suppliersToSend.length} בקשות`);
    }

    await fetchSuppliers(periodInfo.type);
    setIsSendingRequests(false);
  };

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return "-";
    return date.toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  if (!periodInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">תקופה לא נמצאה</h2>
          <p className="text-muted-foreground mb-4">מפתח תקופה: {periodKey}</p>
          <Button onClick={() => router.push("/admin/settlements")}>
            חזרה לרשימת התקופות
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const suppliersToSend = suppliers.filter((supplier) => supplier.email && !supplier.fileRequest);
  const canSendRequests = suppliersToSend.length > 0 && !isSendingRequests;

  // Quick actions
  const quickActions: QuickAction[] = [
    {
      id: "send-requests",
      label: "שלח בקשות לקבצים",
      description: "שליחת אימיילים לספקים לקבלת דוחות",
      icon: <Mail className="h-6 w-6" />,
      href: "#send",
      color: "bg-blue-500",
    },
    {
      id: "files",
      label: "ניהול קבצים",
      description: "העלאה וצפייה בקבצים מספקים",
      icon: <Upload className="h-6 w-6" />,
      href: "files",
      color: "bg-indigo-500",
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
              <h1 className="text-2xl font-bold">{periodInfo.nameHe}</h1>
              <Badge variant="outline">{getPeriodTypeLabel(periodInfo.type)}</Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {formatDate(periodInfo.startDate)} - {formatDate(periodInfo.endDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => periodInfo && fetchSuppliers(periodInfo.type)}>
            <RefreshCw className="me-2 h-4 w-4" />
            רענון
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="me-2 h-4 w-4" />
            התנתקות
          </Button>
        </div>
      </div>

      {/* Status */}
      <div className="mb-6">
        <Badge variant="secondary" className="text-sm px-3 py-1">
          <Clock className="h-3 w-3 ms-1" />
          איסוף קבצים
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
            settlementId={periodKey}
            onStepClick={handleStepClick}
          />
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Period Details */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              פרטי התקופה
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">סוג תקופה:</span>
              <Badge variant="outline">{getPeriodTypeLabel(periodInfo.type)}</Badge>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך התחלה:</span>
              <span>{formatDate(periodInfo.startDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך סיום:</span>
              <span>{formatDate(periodInfo.endDate)}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">תאריך יעד:</span>
              <span>{formatDate(periodInfo.dueDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">מספר ספקים:</span>
              <span className="font-bold">{suppliers.length}</span>
            </div>
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
                action.id === "send-requests" ? (
                  <Card
                    key={action.id}
                    className={`h-full border-2 transition-colors ${
                      canSendRequests
                        ? "cursor-pointer hover:bg-muted/50 hover:border-primary/50"
                        : "cursor-not-allowed opacity-60"
                    }`}
                    onClick={canSendRequests ? handleSendRequests : undefined}
                  >
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className={`p-3 rounded-lg text-white ${action.color}`}>
                        {action.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{action.label}</h3>
                        <p className="text-sm text-muted-foreground">
                          {isSendingRequests ? "שולח בקשות..." : action.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Link
                    key={action.id}
                    href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}/${action.href}`}
                    className="block"
                  >
                    <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer border-2 hover:border-primary/50">
                      <CardContent className="p-4 flex items-start gap-4">
                        <div className={`p-3 rounded-lg text-white ${action.color}`}>
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
                )
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Suppliers List */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            ספקים בתקופה זו
          </CardTitle>
          <CardDescription>
            {suppliers.length} ספקים צריכים לשלוח דוחות לתקופה זו
          </CardDescription>
        </CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              אין ספקים עם תדירות {getPeriodTypeLabel(periodInfo.type)}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suppliers.map((supplier) => (
                <Badge key={supplier.id} variant="outline" className="text-sm">
                  {supplier.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
