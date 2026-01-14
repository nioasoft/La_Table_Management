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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LogOut,
  ChevronRight,
  RefreshCw,
  Loader2,
  Calendar,
  Users,
  Play,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Building2,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, SettlementPeriodType } from "@/db/schema";

// Period info from API
interface SettlementPeriodInfo {
  type: SettlementPeriodType;
  name: string;
  nameHe: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  key: string;
}

// Supplier info
interface SupplierInfo {
  id: string;
  name: string;
  code: string;
}

// Period with suppliers
interface PeriodWithSuppliers {
  period: SettlementPeriodInfo;
  suppliers: SupplierInfo[];
  supplierCount: number;
}

// API response
interface PeriodsResponse {
  periods: Record<string, PeriodWithSuppliers[]>;
  suppliersByFrequency: Record<string, SupplierInfo[]>;
  summary: {
    totalSuppliers: number;
    byFrequency: Record<string, number>;
    currentDate: string;
  };
}

// Frequency tabs config
const frequencyTabs: { value: SettlementPeriodType; label: string; icon: React.ReactNode }[] = [
  { value: "monthly", label: "חודשי", icon: <Calendar className="h-4 w-4" /> },
  { value: "quarterly", label: "רבעוני", icon: <Calendar className="h-4 w-4" /> },
  { value: "semi_annual", label: "חצי שנתי", icon: <Calendar className="h-4 w-4" /> },
  { value: "annual", label: "שנתי", icon: <Calendar className="h-4 w-4" /> },
];

// Create settlement dialog state
interface CreateSettlementDialog {
  isOpen: boolean;
  period: PeriodWithSuppliers | null;
  isSubmitting: boolean;
}

export default function SettlementsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [periodsData, setPeriodsData] = useState<PeriodsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<SettlementPeriodType>("quarterly");
  const [createDialog, setCreateDialog] = useState<CreateSettlementDialog>({
    isOpen: false,
    period: null,
    isSubmitting: false,
  });

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/settlements");
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
      fetchPeriods();
    }
  }, [session, isPending, router, userRole]);

  const fetchPeriods = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/settlements/periods");
      if (!response.ok) {
        throw new Error("Failed to fetch periods");
      }
      const data = await response.json();
      setPeriodsData(data);
    } catch (error) {
      console.error("Error fetching periods:", error);
      toast.error("שגיאה בטעינת התקופות");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartSettlement = async (period: PeriodWithSuppliers) => {
    setCreateDialog({
      isOpen: true,
      period,
      isSubmitting: false,
    });
  };

  const handleConfirmCreate = async () => {
    if (!createDialog.period) return;

    setCreateDialog((prev) => ({ ...prev, isSubmitting: true }));

    try {
      // Navigate to period workflow page using the period key as ID
      // The period key is like "2025-Q4", "2025-01", "2025-H2", "2025"
      const periodKey = createDialog.period.period.key;
      toast.success(`פותח תקופת התחשבנות: ${createDialog.period.period.nameHe}`);

      // Navigate to period workflow page
      router.push(`/admin/settlement-workflow/${encodeURIComponent(periodKey)}`);
    } catch (error) {
      console.error("Error opening settlement:", error);
      toast.error(
        error instanceof Error ? error.message : "שגיאה בפתיחת תקופה"
      );
      setCreateDialog((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateRange = (startDate: string, endDate: string) => {
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const getPeriodStatus = (period: SettlementPeriodInfo) => {
    const now = new Date();
    const dueDate = new Date(period.dueDate);
    const endDate = new Date(period.endDate);

    if (now < endDate) {
      return { label: "תקופה פעילה", variant: "default" as const, icon: <Clock className="h-3 w-3" /> };
    }
    if (now <= dueDate) {
      return { label: "ממתין לדיווח", variant: "secondary" as const, icon: <AlertTriangle className="h-3 w-3" /> };
    }
    return { label: "באיחור", variant: "destructive" as const, icon: <AlertTriangle className="h-3 w-3" /> };
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1" />
              לוח בקרה
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">תקופות התחשבנות</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ml-2 h-4 w-4" />
          התנתקות
        </Button>
      </div>

      {/* Summary Cards */}
      {periodsData && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">סה״כ ספקים</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{periodsData.summary.totalSuppliers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">חודשי</CardTitle>
              <Users className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {periodsData.summary.byFrequency.monthly}
              </div>
              <p className="text-xs text-muted-foreground">ספקים</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">רבעוני</CardTitle>
              <Users className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {periodsData.summary.byFrequency.quarterly}
              </div>
              <p className="text-xs text-muted-foreground">ספקים</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">חצי שנתי</CardTitle>
              <Users className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {periodsData.summary.byFrequency.semi_annual}
              </div>
              <p className="text-xs text-muted-foreground">ספקים</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">שנתי</CardTitle>
              <Users className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {periodsData.summary.byFrequency.annual}
              </div>
              <p className="text-xs text-muted-foreground">ספקים</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Periods Tabs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                תקופות פתוחות להתחשבנות
              </CardTitle>
              <CardDescription>
                בחר תקופה להתחיל תהליך התחשבנות עם הספקים הרלוונטיים
              </CardDescription>
            </div>
            <Button variant="outline" onClick={fetchPeriods}>
              <RefreshCw className="ml-2 h-4 w-4" />
              רענון
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SettlementPeriodType)}>
            <TabsList className="grid w-full grid-cols-4 mb-6">
              {frequencyTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-2">
                  {tab.icon}
                  {tab.label}
                  {periodsData && (
                    <Badge variant="secondary" className="mr-1">
                      {periodsData.summary.byFrequency[tab.value]}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {frequencyTabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value}>
                {periodsData?.periods[tab.value]?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    אין ספקים עם תדירות {tab.label}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {periodsData?.periods[tab.value]?.map((periodData) => {
                      const status = getPeriodStatus(periodData.period);
                      return (
                        <Card key={periodData.period.key} className="border-2">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="bg-primary/10 p-2 rounded-lg">
                                  <Calendar className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <CardTitle className="text-lg">
                                    {periodData.period.nameHe}
                                  </CardTitle>
                                  <CardDescription>
                                    {formatDateRange(periodData.period.startDate, periodData.period.endDate)}
                                  </CardDescription>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant={status.variant} className="flex items-center gap-1">
                                  {status.icon}
                                  {status.label}
                                </Badge>
                                <Button
                                  onClick={() => handleStartSettlement(periodData)}
                                  disabled={periodData.supplierCount === 0}
                                >
                                  <Play className="ml-2 h-4 w-4" />
                                  התחל התחשבנות
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                              <Users className="h-4 w-4" />
                              <span>{periodData.supplierCount} ספקים</span>
                              <span className="mx-2">•</span>
                              <Clock className="h-4 w-4" />
                              <span>תאריך יעד: {formatDate(periodData.period.dueDate)}</span>
                            </div>

                            {periodData.suppliers.length > 0 && (
                              <div className="bg-muted/50 rounded-lg p-3">
                                <div className="text-sm font-medium mb-2">ספקים:</div>
                                <div className="flex flex-wrap gap-2">
                                  {periodData.suppliers.map((supplier) => (
                                    <Badge key={supplier.id} variant="outline">
                                      {supplier.name}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Create Settlement Dialog */}
      <Dialog
        open={createDialog.isOpen}
        onOpenChange={(open) => {
          if (!open && !createDialog.isSubmitting) {
            setCreateDialog({
              isOpen: false,
              period: null,
              isSubmitting: false,
            });
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              התחלת תקופת התחשבנות
            </DialogTitle>
            <DialogDescription>
              אתה עומד להתחיל תהליך התחשבנות לתקופה זו.
              המערכת תשלח בקשות לקבלת קבצים מכל הספקים הרלוונטיים.
            </DialogDescription>
          </DialogHeader>

          {createDialog.period && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">תקופה:</span>
                  <span className="font-medium">{createDialog.period.period.nameHe}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">תאריכים:</span>
                  <span>
                    {formatDateRange(
                      createDialog.period.period.startDate,
                      createDialog.period.period.endDate
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">תאריך יעד:</span>
                  <span>{formatDate(createDialog.period.period.dueDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">מספר ספקים:</span>
                  <span className="font-bold">{createDialog.period.supplierCount}</span>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>מה יקרה:</strong>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>תיווצר תקופת התחשבנות חדשה</li>
                      <li>יישלחו בקשות לקבלת קבצים לכל הספקים</li>
                      <li>תוכל לעקוב אחר קבלת הקבצים ולבצע הצלבה</li>
                    </ul>
                  </div>
                </div>
              </div>

              {createDialog.period.suppliers.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">ספקים שייכללו:</div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {createDialog.period.suppliers.map((supplier) => (
                      <Badge key={supplier.id} variant="outline" className="text-xs">
                        {supplier.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setCreateDialog({
                  isOpen: false,
                  period: null,
                  isSubmitting: false,
                })
              }
              disabled={createDialog.isSubmitting}
            >
              ביטול
            </Button>
            <Button
              onClick={handleConfirmCreate}
              disabled={createDialog.isSubmitting}
            >
              {createDialog.isSubmitting ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  יוצר תקופה...
                </>
              ) : (
                <>
                  <Play className="ml-2 h-4 w-4" />
                  התחל התחשבנות
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
