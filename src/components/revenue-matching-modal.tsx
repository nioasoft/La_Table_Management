"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Coins, Check, ChevronDown, ChevronUp, Loader2, EyeOff } from "lucide-react";
import { formatAmount } from "@/lib/bkmvdata-parser";

/**
 * Revenue account info from BKMVDATA parsing
 */
export interface RevenueAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSort: string;
  totalAmount: number;
  transactionCount: number;
  isConfirmed: boolean;
  monthlyBreakdown: Record<string, number>;
}

/**
 * Props for the Revenue Matching Modal
 */
interface RevenueMatchingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revenueAccounts: RevenueAccount[];
  savedRevenueCodes: string[];
  franchiseeName: string | null;
  onSave: (
    selectedCodes: string[],
    saveToFranchisee: boolean
  ) => Promise<void>;
  isSaving?: boolean;
}

/** Color for account type badge */
function getAccountTypeBadgeVariant(accountType: string): "default" | "secondary" | "outline" | "destructive" {
  if (accountType.includes('הכנסות')) return 'default';
  if (accountType.includes('בנק')) return 'secondary';
  if (accountType.includes('קופה')) return 'secondary';
  return 'outline';
}

/**
 * Modal for selecting revenue accounts from BKMVDATA file
 * Shows ALL B110 accounts, filtering out supplier-type and already-saved accounts
 */
export function RevenueMatchingModal({
  open,
  onOpenChange,
  revenueAccounts,
  savedRevenueCodes,
  franchiseeName,
  onSave,
  isSaving = false,
}: RevenueMatchingModalProps) {
  // Track selected account codes
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  // Track whether to save to franchisee
  const [saveToFranchisee, setSaveToFranchisee] = useState(true);
  // Track which accounts have expanded monthly breakdown
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(
    new Set()
  );

  // Filter accounts: hide supplier-type and already-saved
  const { visibleAccounts, hiddenCount, hiddenSupplierCount, hiddenSavedCount } = useMemo(() => {
    const savedSet = new Set(savedRevenueCodes);
    let supplierHidden = 0;
    let savedHidden = 0;

    const visible = revenueAccounts.filter((account) => {
      // Hide supplier-type accounts
      if (account.accountType.includes('ספקים')) {
        supplierHidden++;
        return false;
      }
      // Hide already-saved revenue codes
      if (savedSet.has(account.accountCode)) {
        savedHidden++;
        return false;
      }
      return true;
    });

    return {
      visibleAccounts: visible,
      hiddenCount: supplierHidden + savedHidden,
      hiddenSupplierCount: supplierHidden,
      hiddenSavedCount: savedHidden,
    };
  }, [revenueAccounts, savedRevenueCodes]);

  // Initialize selected codes when modal opens
  useEffect(() => {
    if (open) {
      setSelectedCodes(new Set());
    }
  }, [open]);

  // Toggle account selection
  const toggleAccount = (accountCode: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(accountCode)) {
        next.delete(accountCode);
      } else {
        next.add(accountCode);
      }
      return next;
    });
  };

  // Toggle monthly breakdown expansion
  const toggleExpanded = (accountCode: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountCode)) {
        next.delete(accountCode);
      } else {
        next.add(accountCode);
      }
      return next;
    });
  };

  // Handle save - merge selected with existing saved codes
  const handleSave = async () => {
    // Combine new selections with existing saved codes
    const allCodes = [...new Set([...savedRevenueCodes, ...selectedCodes])];
    await onSave(allCodes, saveToFranchisee);
    onOpenChange(false);
  };

  // Calculate total of selected accounts
  const selectedTotal = visibleAccounts
    .filter((a) => selectedCodes.has(a.accountCode))
    .reduce((sum, a) => sum + a.totalAmount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            התאמות הכנסות
          </DialogTitle>
          <DialogDescription>
            בחר חשבונות הכנסות מכל החשבונות במבנה האחיד
          </DialogDescription>
        </DialogHeader>

        {/* Hidden accounts info */}
        {hiddenCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            <EyeOff className="h-3.5 w-3.5" />
            <span>
              {visibleAccounts.length} חשבונות מוצגים
              ({hiddenCount} מוסתרים
              {hiddenSupplierCount > 0 && ` - ${hiddenSupplierCount} ספקים`}
              {hiddenSavedCount > 0 && ` - ${hiddenSavedCount} שמורים`})
            </span>
          </div>
        )}

        <div className="space-y-3 py-4">
          {visibleAccounts.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">
              {revenueAccounts.length === 0
                ? "לא נמצאו חשבונות בקובץ"
                : "כל החשבונות כבר שמורים או שייכים לספקים"}
            </p>
          ) : (
            visibleAccounts.map((account) => {
              const isSelected = selectedCodes.has(account.accountCode);
              const isExpanded = expandedAccounts.has(account.accountCode);
              const monthlyEntries = Object.entries(
                account.monthlyBreakdown || {}
              ).sort(([a], [b]) => a.localeCompare(b));

              return (
                <div
                  key={account.accountCode}
                  className={`rounded-lg border transition-colors ${
                    isSelected
                      ? "bg-green-50 border-green-200"
                      : "bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <Checkbox
                      id={`revenue-${account.accountCode}`}
                      checked={isSelected}
                      onCheckedChange={() => toggleAccount(account.accountCode)}
                    />
                    <Label
                      htmlFor={`revenue-${account.accountCode}`}
                      className="flex-1 flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-lg font-semibold">
                          {formatAmount(account.totalAmount)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          ({account.transactionCount} עסקאות)
                        </span>
                        {isSelected && (
                          <Badge variant="default" className="gap-1 bg-green-600">
                            <Check className="h-3 w-3" />
                            נבחר
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {account.accountType && (
                          <Badge variant={getAccountTypeBadgeVariant(account.accountType)} className="text-xs">
                            {account.accountType}
                          </Badge>
                        )}
                        <span className="font-medium">{account.accountName}</span>
                        <span className="text-sm text-muted-foreground">
                          (קוד: {account.accountCode})
                        </span>
                      </div>
                    </Label>
                    {monthlyEntries.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleExpanded(account.accountCode);
                        }}
                        className="h-8 w-8 p-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Monthly breakdown - collapsible */}
                  {isExpanded && monthlyEntries.length > 0 && (
                    <div className="border-t px-3 py-2 bg-white/50">
                      <p className="text-xs text-muted-foreground mb-2">
                        פירוט חודשי:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {monthlyEntries.map(([month, amount]) => {
                          const [year, monthNum] = month.split("-");
                          const monthName = new Date(
                            parseInt(year),
                            parseInt(monthNum) - 1
                          ).toLocaleDateString("he-IL", {
                            month: "short",
                            year: "numeric",
                          });
                          return (
                            <div
                              key={month}
                              className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
                            >
                              <span className="text-muted-foreground">
                                {monthName}:
                              </span>
                              <span className="font-mono font-medium">
                                {formatAmount(amount)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Summary of selected accounts */}
        {selectedCodes.size > 0 && (
          <div className="bg-green-50 rounded-lg p-3 border border-green-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-green-800">
                סה״כ הכנסות שנבחרו:
              </span>
              <span className="font-mono text-lg font-bold text-green-700">
                {formatAmount(selectedTotal)}
              </span>
            </div>
            <div className="text-xs text-green-600 mt-1">
              {selectedCodes.size} חשבונות נבחרו
            </div>
          </div>
        )}

        {/* Save to franchisee option */}
        {franchiseeName && (
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="saveToFranchisee"
              checked={saveToFranchisee}
              onCheckedChange={(checked) => setSaveToFranchisee(checked === true)}
            />
            <Label htmlFor="saveToFranchisee" className="text-sm">
              שמור לזכיין <span className="font-medium">{franchiseeName}</span> לזיהוי
              אוטומטי בקבצים הבאים
            </Label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            ביטול
          </Button>
          <Button onClick={handleSave} disabled={isSaving || selectedCodes.size === 0}>
            {isSaving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            שמור ({selectedCodes.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
