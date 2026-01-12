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
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  LogOut,
  ChevronLeft,
  Check,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  DollarSign,
  FileUp,
  Send,
  FileText,
  History,
  Building2,
  Store,
} from "lucide-react";
import Link from "next/link";
import { he, formatCurrency } from "@/lib/translations";
import { useCrossReference, useResolveCrossReference } from "@/queries/reconciliation";

// Types for cross-reference metadata
interface CrossReferenceMetadata {
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
  commissionIds?: string[];
  adjustmentIds?: string[];
  autoMatched?: boolean;
  manualReview?: boolean;
  supplierName?: string;
  franchiseeName?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  // Resolution fields
  resolutionType?: string;
  resolutionAmount?: string;
  resolutionExplanation?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  fileRequestId?: string;
}

interface CrossReference {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  referenceType: string;
  referenceCode?: string;
  description?: string;
  metadata: CrossReferenceMetadata;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

// Get translations
const t = he.admin.reconciliation.discrepancy;
const tCommon = he.common;
const tStatuses = he.admin.reconciliation.statuses;

// Adjustment types - using translations
const ADJUSTMENT_TYPES = [
  { value: "credit", label: t.adjustmentTypes.credit },
  { value: "deposit", label: t.adjustmentTypes.deposit },
  { value: "supplier_error", label: t.adjustmentTypes.supplier_error },
  { value: "timing", label: t.adjustmentTypes.timing },
  { value: "other", label: t.adjustmentTypes.other },
];

// Resolution types for approval workflow - using translations
const RESOLUTION_TYPES = [
  { value: "accept_supplier", label: t.resolutionTypes.accept_supplier },
  { value: "accept_franchisee", label: t.resolutionTypes.accept_franchisee },
  { value: "adjustment", label: t.resolutionTypes.adjustment },
  { value: "request_correction", label: t.resolutionTypes.request_correction },
];

// Get match status badge
const getStatusBadge = (status: string) => {
  switch (status) {
    case "matched":
      return (
        <Badge variant="success" className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {tStatuses.matched}
        </Badge>
      );
    case "discrepancy":
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {tStatuses.discrepancy}
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {tStatuses.pending}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function DiscrepancyResolutionPage() {
  const router = useRouter();
  const params = useParams();
  const crossRefId = params.crossRefId as string;

  // Use TanStack Query hooks
  const { data: crossRefData, isLoading, error: queryError, refetch } = useCrossReference(crossRefId);
  const resolveMutation = useResolveCrossReference();

  const crossRef = crossRefData?.crossReference || null;
  const error = queryError ? (queryError as Error).message : null;

  // Resolution form state
  const [resolutionType, setResolutionType] = useState<string>("");
  const [adjustmentType, setAdjustmentType] = useState<string>("");
  const [adjustmentAmount, setAdjustmentAmount] = useState<string>("");
  const [explanation, setExplanation] = useState<string>("");

  // File request dialog state
  const [showFileRequestDialog, setShowFileRequestDialog] = useState(false);
  const [fileRequestEntity, setFileRequestEntity] = useState<"supplier" | "franchisee">("supplier");
  const [fileRequestEmail, setFileRequestEmail] = useState("");
  const [fileRequestMessage, setFileRequestMessage] = useState("");
  const [isRequestingFile, setIsRequestingFile] = useState(false);

  // Approval dialog state
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/reconciliation/discrepancy/${crossRefId}`);
      return;
    }

    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }
  }, [session, isPending, router, userRole, crossRefId]);

  // Handle resolution submission
  const handleSubmitResolution = async () => {
    if (!crossRef) return;
    if (!resolutionType) {
      alert(t.messages.selectResolutionType);
      return;
    }
    if (!explanation.trim()) {
      alert(t.messages.provideExplanation);
      return;
    }
    if (resolutionType === "adjustment" && (!adjustmentType || !adjustmentAmount)) {
      alert(t.messages.fillAdjustmentDetails);
      return;
    }

    try {
      // Determine the new match status based on resolution type
      let newMatchStatus: "matched" | "discrepancy" = "matched";
      let resolvedAmount: string | undefined;

      if (resolutionType === "accept_supplier") {
        resolvedAmount = crossRef.metadata.supplierAmount;
      } else if (resolutionType === "accept_franchisee") {
        resolvedAmount = crossRef.metadata.franchiseeAmount;
      } else if (resolutionType === "adjustment") {
        resolvedAmount = adjustmentAmount;
      } else if (resolutionType === "request_correction") {
        // For file request, keep as discrepancy until resolved
        newMatchStatus = "discrepancy";
      }

      await resolveMutation.mutateAsync({
        id: crossRefId,
        data: {
          resolutionType,
          adjustmentType: resolutionType === "adjustment" ? adjustmentType : undefined,
          adjustmentAmount: resolutionType === "adjustment" ? parseFloat(adjustmentAmount) : undefined,
          explanation: explanation.trim(),
          newMatchStatus,
          resolvedAmount,
        },
      });

      // Reset form
      setResolutionType("");
      setAdjustmentType("");
      setAdjustmentAmount("");
      setExplanation("");

      alert(t.messages.resolutionSuccess);
    } catch (err) {
      alert(err instanceof Error ? err.message : t.messages.failedToSubmit);
    }
  };

  // Handle file request submission
  const handleRequestFile = async () => {
    if (!fileRequestEmail.trim()) {
      alert(t.messages.enterEmail);
      return;
    }

    try {
      setIsRequestingFile(true);

      const response = await fetch("/api/file-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: fileRequestEntity,
          entityId: fileRequestEntity === "supplier" ? crossRef?.sourceId : crossRef?.targetId,
          documentType: "corrected_report",
          description: fileRequestMessage || `Correction request for discrepancy ${crossRef?.id}`,
          recipientEmail: fileRequestEmail,
          sendImmediately: true,
          metadata: {
            crossReferenceId: crossRef?.id,
            discrepancyAmount: crossRef?.metadata.difference,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send file request");
      }

      const data = await response.json();

      // Update cross-reference with file request ID
      await fetch(`/api/reconciliation/${crossRefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewNotes: `File correction requested from ${fileRequestEntity}. Request ID: ${data.fileRequest.id}`,
        }),
      });

      setShowFileRequestDialog(false);
      setFileRequestEmail("");
      setFileRequestMessage("");

      alert(t.messages.fileRequestSuccess);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t.messages.failedToSendRequest);
    } finally {
      setIsRequestingFile(false);
    }
  };

  // Handle approval/rejection
  const handleApproval = async () => {
    if (!crossRef) return;

    try {
      const newStatus = approvalAction === "approve" ? "matched" : "discrepancy";
      const defaultNote = approvalAction === "approve" ? t.approvalDialog.approve : t.approvalDialog.reject;

      const response = await fetch(`/api/reconciliation/${crossRefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchStatus: newStatus,
          reviewNotes: explanation || defaultNote,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || (approvalAction === "approve" ? t.messages.failedToApprove : t.messages.failedToReject));
      }

      setShowApprovalDialog(false);
      setExplanation("");

      alert(approvalAction === "approve" ? t.messages.approvalSuccess : t.messages.rejectionSuccess);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : (approvalAction === "approve" ? t.messages.failedToApprove : t.messages.failedToReject));
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  if (isPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t.error}</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Link href="/admin/reconciliation">
            <Button variant="outline">
              <ChevronLeft className="h-4 w-4 ml-2" />
              {t.backToReconciliation}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!crossRef) {
    return null;
  }

  const metadata = crossRef.metadata;
  const supplierAmount = parseFloat(metadata.supplierAmount || "0");
  const franchiseeAmount = parseFloat(metadata.franchiseeAmount || "0");
  const difference = parseFloat(metadata.difference || "0");
  const isResolved = metadata.matchStatus === "matched";

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/admin/reconciliation">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 ml-1" />
              {tCommon.back}
            </Button>
          </Link>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-8 w-8" />
            {t.pageTitle}
          </h1>
          {getStatusBadge(metadata.matchStatus || "pending")}
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ml-2 h-4 w-4" />
          {tCommon.signOut}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left Side: Side-by-Side Comparison */}
        <div className="space-y-6">
          {/* Comparison Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t.amountComparison.title}
              </CardTitle>
              <CardDescription>
                {t.amountComparison.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {/* Supplier Column */}
                <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                    <Building2 className="h-5 w-5" />
                    <span className="font-semibold">{t.amountComparison.supplier}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {metadata.supplierName || t.amountComparison.unknownSupplier}
                  </div>
                  <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                    {formatCurrency(supplierAmount)}
                  </div>
                </div>

                {/* Franchisee Column */}
                <div className="space-y-4 p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                    <Store className="h-5 w-5" />
                    <span className="font-semibold">{t.amountComparison.franchisee}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {metadata.franchiseeName || t.amountComparison.unknownFranchisee}
                  </div>
                  <div className="text-3xl font-bold text-green-700 dark:text-green-300">
                    {formatCurrency(franchiseeAmount)}
                  </div>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Difference Display */}
              <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <span className="font-semibold text-amber-700 dark:text-amber-300">{t.amountComparison.difference}</span>
                  </div>
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                    {formatCurrency(Math.abs(difference))}
                  </div>
                </div>
                {metadata.differencePercentage !== undefined && (
                  <div className="text-sm text-muted-foreground mt-1">
                    {metadata.differencePercentage.toFixed(2)}% {t.amountComparison.differencePercent}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {t.details.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">{t.details.period}</div>
                <div>
                  {metadata.periodStartDate} - {metadata.periodEndDate}
                </div>
                <div className="text-muted-foreground">{t.details.threshold}</div>
                <div>{formatCurrency(metadata.threshold || 10)}</div>
                <div className="text-muted-foreground">{t.details.created}</div>
                <div>{new Date(crossRef.createdAt).toLocaleString("he-IL")}</div>
                {metadata.reviewedAt && (
                  <>
                    <div className="text-muted-foreground">{t.details.lastReviewed}</div>
                    <div>{new Date(metadata.reviewedAt).toLocaleString("he-IL")}</div>
                  </>
                )}
              </div>
              {metadata.reviewNotes && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <div className="text-sm font-medium mb-1">{t.details.reviewNotes}</div>
                  <div className="text-sm text-muted-foreground">{metadata.reviewNotes}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* History Card */}
          {(metadata.resolvedAt || metadata.fileRequestId) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  {t.history.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {metadata.resolvedAt && (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span>{t.history.resolvedOn} {new Date(metadata.resolvedAt).toLocaleString("he-IL")}</span>
                  </div>
                )}
                {metadata.resolutionType && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{t.history.resolutionType} </span>
                    {RESOLUTION_TYPES.find(rt => rt.value === metadata.resolutionType)?.label || metadata.resolutionType}
                  </div>
                )}
                {metadata.resolutionExplanation && (
                  <div className="p-3 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground">{metadata.resolutionExplanation}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Side: Actions */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t.quickActions.title}</CardTitle>
              <CardDescription>
                {t.quickActions.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="default"
                  onClick={() => {
                    setApprovalAction("approve");
                    setShowApprovalDialog(true);
                  }}
                  disabled={isResolved}
                >
                  <Check className="h-4 w-4 ml-2" />
                  {t.quickActions.approve}
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  onClick={() => {
                    setApprovalAction("reject");
                    setShowApprovalDialog(true);
                  }}
                  disabled={isResolved}
                >
                  <X className="h-4 w-4 ml-2" />
                  {t.quickActions.reject}
                </Button>
              </div>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setShowFileRequestDialog(true)}
                disabled={isResolved}
              >
                <FileUp className="h-4 w-4 ml-2" />
                {t.quickActions.requestFile}
              </Button>
            </CardContent>
          </Card>

          {/* Adjustment Form */}
          {!isResolved && (
            <Card>
              <CardHeader>
                <CardTitle>{t.resolutionForm.title}</CardTitle>
                <CardDescription>
                  {t.resolutionForm.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="resolutionType">{t.resolutionForm.resolutionType}</Label>
                  <Select value={resolutionType} onValueChange={setResolutionType}>
                    <SelectTrigger id="resolutionType" data-testid="resolution-type-select">
                      <SelectValue placeholder={t.resolutionForm.resolutionTypePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {resolutionType === "adjustment" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="adjustmentType">{t.resolutionForm.adjustmentType}</Label>
                      <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                        <SelectTrigger id="adjustmentType" data-testid="adjustment-type-select">
                          <SelectValue placeholder={t.resolutionForm.adjustmentTypePlaceholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {ADJUSTMENT_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="adjustmentAmount">{t.resolutionForm.adjustmentAmount}</Label>
                      <Input
                        id="adjustmentAmount"
                        type="number"
                        step="0.01"
                        value={adjustmentAmount}
                        onChange={(e) => setAdjustmentAmount(e.target.value)}
                        placeholder={t.resolutionForm.adjustmentAmountPlaceholder}
                        data-testid="adjustment-amount-input"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label htmlFor="explanation">{t.resolutionForm.explanation}</Label>
                  <Textarea
                    id="explanation"
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                    placeholder={t.resolutionForm.explanationPlaceholder}
                    rows={4}
                    data-testid="explanation-textarea"
                  />
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={handleSubmitResolution}
                  disabled={resolveMutation.isPending || !resolutionType || !explanation.trim()}
                  data-testid="submit-resolution-button"
                >
                  {resolveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                      {t.resolutionForm.submitting}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 ml-2" />
                      {t.resolutionForm.submit}
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* Resolved Status Card */}
          {isResolved && (
            <Card className="border-green-200 bg-green-50 dark:bg-green-950">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-5 w-5" />
                  {t.resolved.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t.resolved.message}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* File Request Dialog */}
      <Dialog open={showFileRequestDialog} onOpenChange={setShowFileRequestDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t.fileRequestDialog.title}</DialogTitle>
            <DialogDescription>
              {t.fileRequestDialog.description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fileRequestEntity">{t.fileRequestDialog.requestFrom}</Label>
              <Select
                value={fileRequestEntity}
                onValueChange={(v) => setFileRequestEntity(v as "supplier" | "franchisee")}
              >
                <SelectTrigger id="fileRequestEntity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier">
                    {t.fileRequestDialog.supplierOption.replace("{name}", metadata.supplierName || t.fileRequestDialog.unknown)}
                  </SelectItem>
                  <SelectItem value="franchisee">
                    {t.fileRequestDialog.franchiseeOption.replace("{name}", metadata.franchiseeName || t.fileRequestDialog.unknown)}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fileRequestEmail">{t.fileRequestDialog.recipientEmail}</Label>
              <Input
                id="fileRequestEmail"
                type="email"
                value={fileRequestEmail}
                onChange={(e) => setFileRequestEmail(e.target.value)}
                placeholder={t.fileRequestDialog.recipientEmailPlaceholder}
                data-testid="file-request-email-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fileRequestMessage">{t.fileRequestDialog.message}</Label>
              <Textarea
                id="fileRequestMessage"
                value={fileRequestMessage}
                onChange={(e) => setFileRequestMessage(e.target.value)}
                placeholder={t.fileRequestDialog.messagePlaceholder}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFileRequestDialog(false)}>
              {t.fileRequestDialog.cancel}
            </Button>
            <Button onClick={handleRequestFile} disabled={isRequestingFile || !fileRequestEmail.trim()}>
              {isRequestingFile ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  {t.fileRequestDialog.sending}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 ml-2" />
                  {t.fileRequestDialog.send}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Dialog */}
      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalAction === "approve" ? t.approvalDialog.approveTitle : t.approvalDialog.rejectTitle}
            </DialogTitle>
            <DialogDescription>
              {approvalAction === "approve"
                ? t.approvalDialog.approveDescription
                : t.approvalDialog.rejectDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="approvalExplanation">{t.approvalDialog.explanation}</Label>
              <Textarea
                id="approvalExplanation"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder={approvalAction === "approve" ? t.approvalDialog.approvalReasonPlaceholder : t.approvalDialog.rejectionReasonPlaceholder}
                rows={3}
                data-testid="approval-explanation-textarea"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApprovalDialog(false)}>
              {t.approvalDialog.cancel}
            </Button>
            <Button
              variant={approvalAction === "approve" ? "default" : "destructive"}
              onClick={handleApproval}
              disabled={resolveMutation.isPending}
              data-testid="confirm-approval-button"
            >
              {resolveMutation.isPending ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : approvalAction === "approve" ? (
                <Check className="h-4 w-4 ml-2" />
              ) : (
                <X className="h-4 w-4 ml-2" />
              )}
              {approvalAction === "approve" ? t.approvalDialog.approve : t.approvalDialog.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
