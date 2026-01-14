"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LogOut,
  ChevronRight,
  Calendar,
  FileText,
  Send,
  Bell,
  RefreshCw,
  AlertTriangle,
  Calculator,
  CheckCircle2,
  FileCheck,
  Play,
  ArrowRight,
  Clock,
  Users,
  Loader2,
  Upload,
  Link as LinkIcon,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, SettlementPeriodType } from "@/db/schema";
import { cn } from "@/lib/utils";

// Step status type
type StepStatus = "completed" | "current" | "pending" | "error";

// Step definition interface
interface WorkflowStep {
  id: number;
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: StepStatus;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
  stats?: {
    completed?: number;
    pending?: number;
    total?: number;
  };
}

// Period type labels
const periodTypeLabels: Record<SettlementPeriodType, string> = {
  monthly: "חודשי",
  quarterly: "רבעוני",
  semi_annual: "חצי שנתי",
  annual: "שנתי",
};

// Get month name in Hebrew
const getHebrewMonth = (monthIndex: number): string => {
  const months = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
  ];
  return months[monthIndex];
};

// Generate period options for selection
const generatePeriodOptions = () => {
  const options: { value: string; label: string; startDate: Date; endDate: Date }[] = [];
  const now = new Date();

  // Generate last 6 months
  for (let i = 0; i < 6; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = `${getHebrewMonth(date.getMonth())} ${date.getFullYear()}`;
    options.push({ value, label, startDate: date, endDate });
  }

  return options;
};

export default function SettlementWorkflowPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [currentStep, setCurrentStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;
  const isSuperUser = userRole === "super_user";

  // Period options
  const periodOptions = generatePeriodOptions();

  // Set default period to current month
  useEffect(() => {
    if (periodOptions.length > 0 && !selectedPeriod) {
      setSelectedPeriod(periodOptions[0].value);
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/settlement-workflow");
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

    if (!isPending && session) {
      setIsLoading(false);
    }
  }, [session, isPending, router, userRole]);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  // Simulate step action
  const handleStepAction = async (stepId: number, actionKey: string) => {
    setIsProcessing(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));

      toast.success(`הפעולה "${actionKey}" בוצעה בהצלחה`);

      // Move to next step if action successful
      if (stepId === currentStep && currentStep < 9) {
        setCurrentStep(currentStep + 1);
      }
    } catch (error) {
      toast.error("שגיאה בביצוע הפעולה");
    } finally {
      setIsProcessing(false);
    }
  };

  // Define the 9 workflow steps
  const getWorkflowSteps = (): WorkflowStep[] => [
    {
      id: 1,
      key: "period_selection",
      title: "בחירת תקופה",
      description: "בחר את תקופת ההתחשבנות לעיבוד",
      icon: <Calendar className="h-5 w-5" />,
      status: selectedPeriod ? (currentStep > 1 ? "completed" : "current") : "current",
      actionLabel: "בחר תקופה",
      actionIcon: <Calendar className="h-4 w-4" />,
      stats: { completed: selectedPeriod ? 1 : 0, total: 1 },
    },
    {
      id: 2,
      key: "file_status",
      title: "סטטוס קבצים",
      description: "בדוק סטטוס העלאת קבצי ספקים וזכיינים",
      icon: <Upload className="h-5 w-5" />,
      status: currentStep > 2 ? "completed" : currentStep === 2 ? "current" : "pending",
      actionLabel: "צפה בסטטוס",
      actionIcon: <FileText className="h-4 w-4" />,
      stats: { completed: 8, pending: 4, total: 12 },
    },
    {
      id: 3,
      key: "send_requests",
      title: "שליחת בקשות דוחות",
      description: "שלח בקשות לספקים ולזכיינים להעלאת קבצים",
      icon: <Send className="h-5 w-5" />,
      status: currentStep > 3 ? "completed" : currentStep === 3 ? "current" : "pending",
      actionLabel: "שלח בקשות",
      actionIcon: <Send className="h-4 w-4" />,
      stats: { completed: 0, pending: 4, total: 4 },
    },
    {
      id: 4,
      key: "send_reminders",
      title: "שליחת תזכורות",
      description: "שלח תזכורות לישויות שטרם העלו קבצים",
      icon: <Bell className="h-5 w-5" />,
      status: currentStep > 4 ? "completed" : currentStep === 4 ? "current" : "pending",
      actionLabel: "שלח תזכורות",
      actionIcon: <Bell className="h-4 w-4" />,
      stats: { pending: 3, total: 3 },
    },
    {
      id: 5,
      key: "file_processing",
      title: "עיבוד והצלבת קבצים",
      description: "עבד את הקבצים שהתקבלו וצלב נתונים",
      icon: <RefreshCw className="h-5 w-5" />,
      status: currentStep > 5 ? "completed" : currentStep === 5 ? "current" : "pending",
      actionLabel: "הפעל עיבוד",
      actionIcon: <Play className="h-4 w-4" />,
      stats: { completed: 6, pending: 2, total: 8 },
    },
    {
      id: 6,
      key: "gap_handling",
      title: "טיפול בפערים",
      description: "בדוק ותקן פערים והתאמות בנתונים",
      icon: <AlertTriangle className="h-5 w-5" />,
      status: currentStep > 6 ? "completed" : currentStep === 6 ? "current" : "pending",
      actionLabel: "טפל בפערים",
      actionIcon: <LinkIcon className="h-4 w-4" />,
      stats: { completed: 2, pending: 3, total: 5 },
    },
    {
      id: 7,
      key: "commission_calculation",
      title: "חישוב עמלות",
      description: "חשב עמלות לכל ספק וזכיין",
      icon: <Calculator className="h-5 w-5" />,
      status: currentStep > 7 ? "completed" : currentStep === 7 ? "current" : "pending",
      actionLabel: "חשב עמלות",
      actionIcon: <Calculator className="h-4 w-4" />,
      stats: { completed: 0, total: 12 },
    },
    {
      id: 8,
      key: "final_approval",
      title: "אישור סופי",
      description: "אשר את כל הנתונים לפני הפקת חשבוניות",
      icon: <CheckCircle2 className="h-5 w-5" />,
      status: currentStep > 8 ? "completed" : currentStep === 8 ? "current" : "pending",
      actionLabel: isSuperUser ? "אשר התחשבנות" : "שלח לאישור",
      actionIcon: <CheckCircle2 className="h-4 w-4" />,
    },
    {
      id: 9,
      key: "invoice_generation",
      title: "הפקת דוחות וחשבוניות",
      description: "הפק דוחות סיכום וחשבוניות",
      icon: <FileCheck className="h-5 w-5" />,
      status: currentStep === 9 ? "current" : "pending",
      actionLabel: "הפק חשבוניות",
      actionIcon: <FileCheck className="h-4 w-4" />,
    },
  ];

  const workflowSteps = getWorkflowSteps();

  // Calculate overall progress
  const completedSteps = workflowSteps.filter(s => s.status === "completed").length;
  const progressPercentage = Math.round((completedSteps / 9) * 100);

  // Get status badge style
  const getStatusBadge = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />הושלם</Badge>;
      case "current":
        return <Badge variant="info" className="gap-1"><Clock className="h-3 w-3" />פעיל</Badge>;
      case "error":
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />שגיאה</Badge>;
      default:
        return <Badge variant="outline" className="gap-1">ממתין</Badge>;
    }
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const selectedPeriodOption = periodOptions.find(p => p.value === selectedPeriod);

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1 rtl-flip" />
              לוח בקרה
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">תהליך התחשבנות</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="me-2 h-4 w-4" />
          התנתקות
        </Button>
      </div>

      {/* Period Selection & Progress Overview */}
      <div className="grid gap-6 md:grid-cols-3 mb-8">
        {/* Period Selection Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              תקופת התחשבנות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-full" data-testid="period-select">
                <SelectValue placeholder="בחר תקופה" />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPeriodOption && (
              <div className="mt-3 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>מתאריך:</span>
                  <span>{selectedPeriodOption.startDate.toLocaleDateString("he-IL")}</span>
                </div>
                <div className="flex justify-between">
                  <span>עד תאריך:</span>
                  <span>{selectedPeriodOption.endDate.toLocaleDateString("he-IL")}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Progress Overview Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              התקדמות כללית
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-2xl font-bold">{progressPercentage}%</span>
                <span className="text-sm text-muted-foreground">{completedSteps}/9 שלבים</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-3">
                <div
                  className="bg-primary rounded-full h-3 transition-all duration-500"
                  style={{ width: `${progressPercentage}%` }}
                  data-testid="progress-bar"
                />
              </div>
              <div className="flex gap-2">
                <Badge variant="success" className="text-xs">{completedSteps} הושלמו</Badge>
                <Badge variant="info" className="text-xs">1 פעיל</Badge>
                <Badge variant="outline" className="text-xs">{8 - completedSteps} ממתינים</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              סטטיסטיקות מהירות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">12</div>
                <div className="text-xs text-muted-foreground">ספקים פעילים</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">8</div>
                <div className="text-xs text-muted-foreground">זכיינים</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600">5</div>
                <div className="text-xs text-muted-foreground">פערים ממתינים</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">₪24.5K</div>
                <div className="text-xs text-muted-foreground">עמלות צפויות</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Visual Progress Stepper */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            שלבי התהליך
          </CardTitle>
          <CardDescription>
            9 שלבים לסיום תהליך ההתחשבנות החודשי
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Horizontal Progress Stepper */}
          <div className="relative mb-8">
            {/* Progress Line */}
            <div className="absolute top-5 left-0 right-0 h-1 bg-secondary rounded-full">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${(completedSteps / 8) * 100}%` }}
              />
            </div>

            {/* Step Indicators */}
            <div className="relative flex justify-between">
              {workflowSteps.map((step, index) => (
                <div
                  key={step.id}
                  className="flex flex-col items-center"
                  style={{ width: index === 0 || index === 8 ? "auto" : "11.11%" }}
                >
                  <button
                    onClick={() => setCurrentStep(step.id)}
                    className={cn(
                      "relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300",
                      step.status === "completed" && "bg-green-500 border-green-500 text-white",
                      step.status === "current" && "bg-primary border-primary text-white ring-4 ring-primary/20",
                      step.status === "pending" && "bg-background border-muted-foreground/30 text-muted-foreground",
                      step.status === "error" && "bg-destructive border-destructive text-white"
                    )}
                    data-testid={`step-indicator-${step.id}`}
                  >
                    {step.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <span className="text-sm font-bold">{step.id}</span>
                    )}
                  </button>
                  <span className={cn(
                    "mt-2 text-xs text-center max-w-[80px] hidden md:block",
                    step.status === "current" && "font-bold text-primary",
                    step.status === "completed" && "text-green-600",
                    step.status === "pending" && "text-muted-foreground"
                  )}>
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Steps Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {workflowSteps.map((step) => (
          <Card
            key={step.id}
            className={cn(
              "transition-all duration-300",
              step.status === "current" && "ring-2 ring-primary shadow-lg",
              step.status === "completed" && "bg-green-50 dark:bg-green-950/10 border-green-200",
              step.status === "pending" && "opacity-75"
            )}
            data-testid={`step-card-${step.id}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    step.status === "completed" && "bg-green-100 text-green-600",
                    step.status === "current" && "bg-primary/10 text-primary",
                    step.status === "pending" && "bg-muted text-muted-foreground",
                    step.status === "error" && "bg-destructive/10 text-destructive"
                  )}>
                    {step.icon}
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">#{step.id}</span>
                      {step.title}
                    </CardTitle>
                  </div>
                </div>
                {getStatusBadge(step.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <CardDescription className="text-sm">
                {step.description}
              </CardDescription>

              {/* Step Stats */}
              {step.stats && (
                <div className="flex gap-3 text-xs">
                  {step.stats.completed !== undefined && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span>{step.stats.completed} הושלם</span>
                    </div>
                  )}
                  {step.stats.pending !== undefined && step.stats.pending > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{step.stats.pending} ממתין</span>
                    </div>
                  )}
                  {step.stats.total !== undefined && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span>מתוך {step.stats.total}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Button */}
              {step.actionLabel && (
                <Button
                  className="w-full"
                  variant={step.status === "current" ? "default" : "outline"}
                  disabled={step.status === "pending" || isProcessing}
                  onClick={() => handleStepAction(step.id, step.actionLabel!)}
                  data-testid={`step-action-${step.id}`}
                >
                  {isProcessing && step.status === "current" ? (
                    <Loader2 className="h-4 w-4 animate-spin me-2" />
                  ) : (
                    step.actionIcon && <span className="me-2">{step.actionIcon}</span>
                  )}
                  {step.actionLabel}
                  {step.status === "current" && <ArrowRight className="h-4 w-4 ms-2 rtl-flip" />}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions Bar */}
      <Card className="mt-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">פעולות מהירות</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => router.push("/admin/settlements")}>
              <FileText className="h-4 w-4 me-2" />
              ניהול תקופות
            </Button>
            <Button variant="outline" onClick={() => router.push("/admin/reconciliation")}>
              <RefreshCw className="h-4 w-4 me-2" />
              הצלבת נתונים
            </Button>
            <Button variant="outline" onClick={() => router.push("/admin/commissions")}>
              <Calculator className="h-4 w-4 me-2" />
              עמלות
            </Button>
            <Button variant="outline" onClick={() => router.push("/admin/franchisee-reminders")}>
              <Bell className="h-4 w-4 me-2" />
              תזכורות
            </Button>
            <Button variant="outline" onClick={() => router.push("/admin/suppliers")}>
              <Users className="h-4 w-4 me-2" />
              ספקים
            </Button>
            <Button variant="outline" onClick={() => router.push("/admin/franchisees")}>
              <Users className="h-4 w-4 me-2" />
              זכיינים
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
