"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowRight,
  Truck,
  Pencil,
  Loader2,
  Building2,
  Users,
  Percent,
  History,
  Calendar,
  User,
  FileText,
  Upload,
  Link as LinkIcon,
  AlertTriangle,
  Mail,
  Phone,
  MapPin,
  Hash,
  Clock,
  FileSpreadsheet,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  Supplier,
  Brand,
  Document,
  SupplierFileMapping,
} from "@/db/schema";
import { DocumentManager } from "@/components/document-manager";
import Link from "next/link";
import { he } from "@/lib/translations/he";

// Extended types
interface DocumentWithUploader extends Document {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
}

interface CommissionHistoryEntry {
  id: string;
  supplierId: string;
  previousRate: string | null;
  newRate: string;
  effectiveDate: string;
  reason: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  createdByUser?: { name: string; email: string } | null;
}

interface UploadLinkWithEntity {
  id: string;
  token: string;
  name: string;
  description: string | null;
  status: "active" | "expired" | "used" | "cancelled";
  entityType: string;
  entityId: string;
  allowedFileTypes: string | null;
  maxFileSize: number | null;
  maxFiles: number | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  usedByEmail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  entityName?: string | null;
  filesUploaded?: number;
}

interface CrossReferenceWithDetails {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  referenceType: string;
  referenceCode: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  supplierInfo?: {
    id: string;
    name: string;
    code: string;
  } | null;
  franchiseeInfo?: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdByUser?: { name: string; email: string } | null;
  comparisonMetadata?: {
    supplierAmount?: string;
    franchiseeAmount?: string;
    difference?: string;
    differencePercentage?: number;
    matchStatus?: "matched" | "discrepancy" | "pending";
    threshold?: number;
    comparisonDate?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    reviewNotes?: string;
    supplierName?: string;
    franchiseeName?: string;
    periodStartDate?: string;
    periodEndDate?: string;
  };
}

type SupplierWithBrands = Supplier & {
  brands: Brand[];
};

// Helper function to format settlement frequency
function formatSettlementFrequency(
  frequency: string | null | undefined
): string {
  if (!frequency) return he.admin.suppliers.detail.settlementFrequencies.notSet;
  const map: Record<string, string> = {
    weekly: he.admin.suppliers.detail.settlementFrequencies.weekly,
    bi_weekly: he.admin.suppliers.detail.settlementFrequencies.bi_weekly,
    monthly: he.admin.suppliers.detail.settlementFrequencies.monthly,
    quarterly: he.admin.suppliers.detail.settlementFrequencies.quarterly,
    semi_annual: he.admin.suppliers.detail.settlementFrequencies.semi_annual,
    annual: he.admin.suppliers.detail.settlementFrequencies.annual,
  };
  return map[frequency] || frequency;
}

// Helper function to get status badge variant
function getStatusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  switch (status) {
    case "active":
      return "success";
    case "expired":
      return "destructive";
    case "used":
      return "secondary";
    case "cancelled":
      return "outline";
    case "matched":
      return "success";
    case "discrepancy":
      return "destructive";
    case "pending":
      return "warning";
    default:
      return "default";
  }
}

// Format file size
function formatFileSize(bytes: number | null): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SupplierCardPage() {
  const router = useRouter();
  const params = useParams();
  const supplierId = params.supplierId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [supplier, setSupplier] = useState<SupplierWithBrands | null>(null);
  const [commissionHistory, setCommissionHistory] = useState<
    CommissionHistoryEntry[]
  >([]);
  const [documents, setDocuments] = useState<DocumentWithUploader[]>([]);
  const [uploadLinks, setUploadLinks] = useState<UploadLinkWithEntity[]>([]);
  const [crossReferences, setCrossReferences] = useState<
    CrossReferenceWithDetails[]
  >([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [loadingStates, setLoadingStates] = useState({
    commissionHistory: false,
    documents: false,
    uploadLinks: false,
    crossReferences: false,
  });
  const [error, setError] = useState<string | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Fetch supplier details
  const fetchSupplier = async () => {
    try {
      const response = await fetch(`/api/suppliers/${supplierId}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError(he.admin.suppliers.detail.supplierNotFound);
          return;
        }
        throw new Error("Failed to fetch supplier");
      }
      const data = await response.json();
      setSupplier(data.supplier);
    } catch (err) {
      console.error("Error fetching supplier:", err);
      setError(he.admin.suppliers.detail.failedToLoad);
    }
  };

  // Fetch commission history
  const fetchCommissionHistory = async () => {
    setLoadingStates((prev) => ({ ...prev, commissionHistory: true }));
    try {
      const response = await fetch(
        `/api/suppliers/${supplierId}/commission-history`
      );
      if (!response.ok) throw new Error("Failed to fetch commission history");
      const data = await response.json();
      setCommissionHistory(data.history || []);
    } catch (err) {
      console.error("Error fetching commission history:", err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, commissionHistory: false }));
    }
  };

  // Fetch documents
  const fetchDocuments = async () => {
    setLoadingStates((prev) => ({ ...prev, documents: true }));
    try {
      const response = await fetch(`/api/documents/supplier/${supplierId}`);
      if (!response.ok) throw new Error("Failed to fetch documents");
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error("Error fetching documents:", err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, documents: false }));
    }
  };

  // Fetch upload links
  const fetchUploadLinks = async () => {
    setLoadingStates((prev) => ({ ...prev, uploadLinks: true }));
    try {
      const response = await fetch(
        `/api/upload-links/entity/supplier/${supplierId}`
      );
      if (!response.ok) throw new Error("Failed to fetch upload links");
      const data = await response.json();
      setUploadLinks(data.uploadLinks || []);
    } catch (err) {
      console.error("Error fetching upload links:", err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, uploadLinks: false }));
    }
  };

  // Fetch cross-references (reconciliation data)
  const fetchCrossReferences = async () => {
    setLoadingStates((prev) => ({ ...prev, crossReferences: true }));
    try {
      const response = await fetch(
        `/api/reconciliation?supplierId=${supplierId}`
      );
      if (!response.ok) throw new Error("Failed to fetch cross-references");
      const data = await response.json();
      // The reconciliation API returns comparisons, which are cross-references
      const comparisons = data.comparisons || [];
      // Transform the data to match our CrossReferenceWithDetails type
      const transformedRefs = comparisons.map((comp: Record<string, unknown>) => ({
        id: comp.id,
        sourceType: comp.sourceType,
        sourceId: comp.sourceId,
        targetType: comp.targetType,
        targetId: comp.targetId,
        referenceType: comp.referenceType,
        referenceCode: comp.referenceCode,
        description: comp.description,
        metadata: comp.metadata,
        isActive: comp.isActive,
        createdAt: comp.createdAt,
        updatedAt: comp.updatedAt,
        createdBy: comp.createdBy,
        comparisonMetadata: comp.metadata as CrossReferenceWithDetails['comparisonMetadata'],
      }));
      setCrossReferences(transformedRefs);
    } catch (err) {
      console.error("Error fetching cross-references:", err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, crossReferences: false }));
    }
  };

  // Initial data loading
  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/suppliers/${supplierId}`);
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

    if (!isPending && session && supplierId) {
      setIsLoading(true);
      Promise.all([
        fetchSupplier(),
        fetchCommissionHistory(),
        fetchDocuments(),
        fetchUploadLinks(),
        fetchCrossReferences(),
      ]).finally(() => {
        setIsLoading(false);
      });
    }
  }, [session, isPending, router, userRole, supplierId]);

  // Handle documents change
  const handleDocumentsChange = (newDocuments: DocumentWithUploader[]) => {
    setDocuments(newDocuments);
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/suppliers">
            <Button variant="ghost" size="sm">
              <ArrowRight className="h-4 w-4 ms-2" />
              {he.admin.suppliers.detail.backToSuppliers}
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">{he.admin.suppliers.detail.error}</h2>
            <p className="text-muted-foreground">{error}</p>
            <Button
              className="mt-4"
              onClick={() => router.push("/admin/suppliers")}
            >
              {he.admin.suppliers.detail.returnToSuppliers}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!supplier) {
    return null;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-6xl">
      {/* Header - Minimal */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/suppliers">
            <Button variant="ghost" size="sm">
              <ArrowRight className="h-4 w-4 ms-2" />
              {he.admin.suppliers.detail.backToSuppliers}
            </Button>
          </Link>
          <div className="h-6 w-px bg-border" />
          <h1 className="text-xl md:text-2xl font-bold">{supplier.name}</h1>
          <Badge variant={supplier.isActive ? "success" : "secondary"}>
            {supplier.isActive ? he.common.active : he.common.inactive}
          </Badge>
        </div>
        <Link href={`/admin/suppliers?edit=${supplier.id}`}>
          <Button>
            <Pencil className="h-4 w-4 me-2" />
            {he.admin.suppliers.detail.editSupplier}
          </Button>
        </Link>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-primary/10">
            <Hash className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">קוד</p>
            <p className="font-mono font-medium">{supplier.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-green-500/10">
            <Percent className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">עמלה</p>
            <p className="font-medium">{supplier.defaultCommissionRate ? `${supplier.defaultCommissionRate}%` : "לא הוגדר"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-blue-500/10">
            <Clock className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">התחשבנות</p>
            <p className="font-medium">{formatSettlementFrequency(supplier.settlementFrequency)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-purple-500/10">
            <Building2 className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">מותגים</p>
            <p className="font-medium">{supplier.brands?.length || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-orange-500/10">
            <Users className="h-4 w-4 text-orange-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">אנשי קשר</p>
            <p className="font-medium">{(supplier.contactName ? 1 : 0) + (supplier.secondaryContactName ? 1 : 0)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6" dir="rtl">
        <TabsList className="flex w-full flex-wrap gap-1">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {he.admin.suppliers.detail.tabs.overview}
          </TabsTrigger>
          <TabsTrigger value="commission" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {he.admin.suppliers.detail.tabs.commissionHistory}
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {he.admin.suppliers.detail.tabs.documents}
          </TabsTrigger>
          <TabsTrigger value="uploads" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {he.admin.suppliers.detail.tabs.uploadHistory}
          </TabsTrigger>
          <TabsTrigger
            value="cross-references"
            className="flex items-center gap-2"
          >
            <LinkIcon className="h-4 w-4" />
            {he.admin.suppliers.detail.tabs.crossReferences}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* מידע כללי */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">מידע כללי</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1">
              {supplier.companyId && (
                <div className="flex justify-between py-2 border-b last:border-0">
                  <span className="text-muted-foreground">מספר חברה</span>
                  <span className="font-medium" dir="ltr">{supplier.companyId}</span>
                </div>
              )}
              {supplier.address && (
                <div className="flex justify-between py-2 border-b last:border-0">
                  <span className="text-muted-foreground">כתובת</span>
                  <span className="font-medium text-end max-w-[60%]">{supplier.address}</span>
                </div>
              )}
              {supplier.description && (
                <div className="flex flex-col gap-1 py-2 border-b last:border-0">
                  <span className="text-muted-foreground">הערות</span>
                  <span className="text-sm">{supplier.description}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b last:border-0">
                <span className="text-muted-foreground">תאריך יצירה</span>
                <span className="font-medium">{new Date(supplier.createdAt).toLocaleDateString("he-IL")}</span>
              </div>
            </CardContent>
          </Card>

          {/* תנאים כספיים */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תנאים כספיים</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1">
              <div className="flex justify-between py-2 border-b last:border-0">
                <span className="text-muted-foreground">שיעור עמלה</span>
                <span className="font-medium">
                  {supplier.defaultCommissionRate ? `${supplier.defaultCommissionRate}%` : "לא הוגדר"}
                  {supplier.commissionType && (
                    <span className="text-muted-foreground text-sm me-1">
                      ({supplier.commissionType === "percentage" ? "אחוזים" : "לפריט"})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b last:border-0">
                <span className="text-muted-foreground">תדירות התחשבנות</span>
                <span className="font-medium">{formatSettlementFrequency(supplier.settlementFrequency)}</span>
              </div>
              <div className="flex justify-between py-2 border-b last:border-0">
                <span className="text-muted-foreground">מע״מ</span>
                <span className="font-medium">{supplier.vatIncluded ? "כלול במחיר" : "לא כלול"}</span>
              </div>
              {supplier.paymentTerms && (
                <div className="flex justify-between py-2 border-b last:border-0">
                  <span className="text-muted-foreground">תנאי תשלום</span>
                  <span className="font-medium">{supplier.paymentTerms}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* אנשי קשר */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">אנשי קשר</CardTitle>
            </CardHeader>
            <CardContent>
              {!supplier.contactName && !supplier.secondaryContactName ? (
                <p className="text-muted-foreground text-sm">לא הוגדרו אנשי קשר</p>
              ) : (
                <div className="space-y-4">
                  {supplier.contactName && (
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{supplier.contactName}</p>
                          <Badge variant="secondary" className="text-xs">ראשי</Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                          {supplier.contactEmail && (
                            <a href={`mailto:${supplier.contactEmail}`} className="hover:text-primary" dir="ltr">
                              {supplier.contactEmail}
                            </a>
                          )}
                          {supplier.contactPhone && (
                            <a href={`tel:${supplier.contactPhone}`} className="hover:text-primary" dir="ltr">
                              {supplier.contactPhone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {supplier.secondaryContactName && (
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{supplier.secondaryContactName}</p>
                          <Badge variant="outline" className="text-xs">משני</Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                          {supplier.secondaryContactEmail && (
                            <a href={`mailto:${supplier.secondaryContactEmail}`} className="hover:text-primary" dir="ltr">
                              {supplier.secondaryContactEmail}
                            </a>
                          )}
                          {supplier.secondaryContactPhone && (
                            <a href={`tel:${supplier.secondaryContactPhone}`} className="hover:text-primary" dir="ltr">
                              {supplier.secondaryContactPhone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* מותגים משויכים */}
          {supplier.brands && supplier.brands.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">מותגים משויכים</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {supplier.brands.map((brand) => (
                    <Badge key={brand.id} variant="secondary" className="py-1.5 px-3">
                      {brand.nameHe}
                      {brand.nameEn && (
                        <span className="text-muted-foreground me-1">({brand.nameEn})</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* מיפוי קבצים - מתקפל */}
          {supplier.fileMapping && (
            <Collapsible>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4" />
                        מיפוי קבצי Excel
                      </CardTitle>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">סוג קובץ</p>
                        <p className="font-medium uppercase">{supplier.fileMapping.fileType}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">שורת כותרת</p>
                        <p className="font-medium">{supplier.fileMapping.headerRow}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">שורת נתונים ראשונה</p>
                        <p className="font-medium">{supplier.fileMapping.dataStartRow}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">שורות לדילוג</p>
                        <p className="font-medium">{supplier.fileMapping.rowsToSkip ?? 0}</p>
                      </div>
                    </div>
                    {supplier.fileMapping.columnMappings && (
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm font-medium mb-3">מיפוי עמודות</p>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="p-2 rounded border bg-background">
                            <span className="text-xs text-muted-foreground">עמודת זכיין:</span>
                            <span className="font-mono font-medium me-1">{supplier.fileMapping.columnMappings.franchiseeColumn}</span>
                          </div>
                          <div className="p-2 rounded border bg-background">
                            <span className="text-xs text-muted-foreground">עמודת סכום:</span>
                            <span className="font-mono font-medium me-1">{supplier.fileMapping.columnMappings.amountColumn}</span>
                          </div>
                          <div className="p-2 rounded border bg-background">
                            <span className="text-xs text-muted-foreground">עמודת תאריך:</span>
                            <span className="font-mono font-medium me-1">{supplier.fileMapping.columnMappings.dateColumn}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </TabsContent>

        {/* Commission History Tab */}
        <TabsContent value="commission" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                {he.admin.suppliers.detail.commissionHistory.title}
              </CardTitle>
              <CardDescription>
                {he.admin.suppliers.detail.commissionHistory.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStates.commissionHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : commissionHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{he.admin.suppliers.detail.commissionHistory.noChanges}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {commissionHistory.map((entry, index) => (
                    <div
                      key={entry.id}
                      className="relative flex gap-4 pb-4 last:pb-0"
                    >
                      {/* Timeline line */}
                      {index < commissionHistory.length - 1 && (
                        <div className="absolute start-[11px] top-8 bottom-0 w-0.5 bg-border" />
                      )}
                      {/* Timeline dot */}
                      <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 border-2 border-primary mt-1">
                        <Percent className="h-3 w-3 text-primary" />
                      </div>
                      {/* Content */}
                      <div className="flex-1 p-4 rounded-lg bg-muted/30 border">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">
                              {entry.previousRate ?? "N/A"}% ← {entry.newRate}%
                            </span>
                            <Badge variant="outline" className="text-xs">
                              <Calendar className="h-3 w-3 ms-1" />
                              {he.admin.suppliers.detail.commissionHistory.effective}{" "}
                              {new Date(
                                entry.effectiveDate
                              ).toLocaleDateString("he-IL")}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground text-start">
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {entry.createdByUser?.name || he.admin.suppliers.detail.commissionHistory.system}
                            </div>
                            <div>
                              {new Date(entry.createdAt).toLocaleString(
                                "he-IL"
                              )}
                            </div>
                          </div>
                        </div>
                        {entry.reason && (
                          <p className="text-sm text-muted-foreground">
                            <strong>{he.admin.suppliers.detail.commissionHistory.reason}</strong> {entry.reason}
                          </p>
                        )}
                        {entry.notes && (
                          <p className="text-sm text-muted-foreground mt-1">
                            <strong>{he.admin.suppliers.detail.commissionHistory.notes}</strong> {entry.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-6">
          {loadingStates.documents ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : (
            <DocumentManager
              entityType="supplier"
              entityId={supplierId}
              entityName={supplier.name}
              documents={documents}
              onDocumentsChange={handleDocumentsChange}
              canUpload={userRole === "super_user" || userRole === "admin"}
              canDelete={userRole === "super_user"}
              canEdit={userRole === "super_user" || userRole === "admin"}
            />
          )}
        </TabsContent>

        {/* Upload History Tab */}
        <TabsContent value="uploads" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                {he.admin.suppliers.detail.uploadHistory.title}
              </CardTitle>
              <CardDescription>
                {he.admin.suppliers.detail.uploadHistory.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStates.uploadLinks ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : uploadLinks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Upload className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{he.admin.suppliers.detail.uploadHistory.noLinks}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {uploadLinks.map((link) => (
                    <div
                      key={link.id}
                      className="p-4 rounded-lg border bg-card"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{link.name}</span>
                            <Badge variant={getStatusBadgeVariant(link.status)}>
                              {he.admin.suppliers.detail.statuses[link.status as keyof typeof he.admin.suppliers.detail.statuses] || link.status}
                            </Badge>
                            {link.filesUploaded !== undefined &&
                              link.filesUploaded > 0 && (
                                <Badge variant="outline">
                                  {link.filesUploaded === 1
                                    ? he.admin.suppliers.detail.uploadHistory.fileUploaded
                                    : he.admin.suppliers.detail.uploadHistory.filesUploaded.replace("{count}", String(link.filesUploaded))}
                                </Badge>
                              )}
                          </div>
                          {link.description && (
                            <p className="text-sm text-muted-foreground">
                              {link.description}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {he.admin.suppliers.detail.uploadHistory.created}{" "}
                              {new Date(link.createdAt).toLocaleDateString(
                                "he-IL"
                              )}
                            </span>
                            {link.expiresAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {he.admin.suppliers.detail.uploadHistory.expires}{" "}
                                {new Date(link.expiresAt).toLocaleDateString(
                                  "he-IL"
                                )}
                              </span>
                            )}
                            {link.usedAt && (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                {he.admin.suppliers.detail.uploadHistory.used}{" "}
                                {new Date(link.usedAt).toLocaleDateString(
                                  "he-IL"
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        {link.status === "active" && (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={`/upload/${link.token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4 ms-1" />
                              {he.admin.suppliers.detail.uploadHistory.openLink}
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cross-References Tab */}
        <TabsContent value="cross-references" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                {he.admin.suppliers.detail.crossReferences.title}
              </CardTitle>
              <CardDescription>
                {he.admin.suppliers.detail.crossReferences.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStates.crossReferences ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : crossReferences.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <LinkIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{he.admin.suppliers.detail.crossReferences.noReferences}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {crossReferences.map((crossRef) => (
                    <div
                      key={crossRef.id}
                      className="p-4 rounded-lg border bg-card"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {crossRef.franchiseeInfo?.name ||
                              crossRef.comparisonMetadata?.franchiseeName ||
                              he.admin.suppliers.detail.crossReferences.unknownFranchisee}
                          </span>
                          {crossRef.comparisonMetadata?.matchStatus && (
                            <Badge
                              variant={getStatusBadgeVariant(
                                crossRef.comparisonMetadata.matchStatus
                              )}
                            >
                              {crossRef.comparisonMetadata.matchStatus ===
                              "matched" ? (
                                <>
                                  <CheckCircle2 className="h-3 w-3 ms-1" />
                                  {he.admin.suppliers.detail.crossReferences.matched}
                                </>
                              ) : crossRef.comparisonMetadata.matchStatus ===
                                "discrepancy" ? (
                                <>
                                  <XCircle className="h-3 w-3 ms-1" />
                                  {he.admin.suppliers.detail.crossReferences.discrepancy}
                                </>
                              ) : (
                                <>
                                  <Clock className="h-3 w-3 ms-1" />
                                  {he.admin.suppliers.detail.crossReferences.pending}
                                </>
                              )}
                            </Badge>
                          )}
                        </div>
                        {crossRef.comparisonMetadata?.periodStartDate &&
                          crossRef.comparisonMetadata?.periodEndDate && (
                            <Badge variant="outline" className="text-xs">
                              <Calendar className="h-3 w-3 ms-1" />
                              {crossRef.comparisonMetadata.periodStartDate} -{" "}
                              {crossRef.comparisonMetadata.periodEndDate}
                            </Badge>
                          )}
                      </div>

                      {crossRef.comparisonMetadata && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">
                              {he.admin.suppliers.detail.crossReferences.supplierAmount}
                            </p>
                            <p className="font-medium">
                              ₪
                              {Number(
                                crossRef.comparisonMetadata.supplierAmount || 0
                              ).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">
                              {he.admin.suppliers.detail.crossReferences.franchiseeAmount}
                            </p>
                            <p className="font-medium">
                              ₪
                              {Number(
                                crossRef.comparisonMetadata.franchiseeAmount ||
                                  0
                              ).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{he.admin.suppliers.detail.crossReferences.difference}</p>
                            <p
                              className={`font-medium ${
                                Number(
                                  crossRef.comparisonMetadata.difference || 0
                                ) !== 0
                                  ? "text-destructive"
                                  : "text-green-600"
                              }`}
                            >
                              ₪
                              {Number(
                                crossRef.comparisonMetadata.difference || 0
                              ).toLocaleString()}
                              {crossRef.comparisonMetadata
                                .differencePercentage !== undefined && (
                                <span className="text-xs me-1">
                                  (
                                  {crossRef.comparisonMetadata.differencePercentage.toFixed(
                                    1
                                  )}
                                  %)
                                </span>
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{he.admin.suppliers.detail.crossReferences.threshold}</p>
                            <p className="font-medium">
                              ₪{crossRef.comparisonMetadata.threshold || 10}
                            </p>
                          </div>
                        </div>
                      )}

                      {crossRef.description && (
                        <p className="text-sm text-muted-foreground mt-3">
                          {crossRef.description}
                        </p>
                      )}

                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {he.admin.suppliers.detail.crossReferences.created}{" "}
                          {new Date(crossRef.createdAt).toLocaleDateString(
                            "he-IL"
                          )}
                        </span>
                        {crossRef.createdByUser && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {he.admin.suppliers.detail.crossReferences.by} {crossRef.createdByUser.name}
                          </span>
                        )}
                        {crossRef.comparisonMetadata?.reviewedBy && (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {he.admin.suppliers.detail.crossReferences.reviewedBy}{" "}
                            {crossRef.comparisonMetadata.reviewedBy}
                          </span>
                        )}
                      </div>

                      {crossRef.comparisonMetadata?.reviewNotes && (
                        <div className="mt-3 p-2 rounded bg-muted/50">
                          <p className="text-sm">
                            <strong>{he.admin.suppliers.detail.crossReferences.reviewNotes}</strong>{" "}
                            {crossRef.comparisonMetadata.reviewNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
