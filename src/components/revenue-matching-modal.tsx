"use client";

import { useState, useEffect } from "react";
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
import { Coins, Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { formatAmount } from "@/lib/bkmvdata-parser";

/**
 * Revenue account info from BKMVDATA parsing
 */
export interface RevenueAccount {
  accountCode: string;
  accountName: string;
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

/**
 * Modal for selecting revenue accounts from BKMVDATA file
 * Supports multi-select with checkbox and option to save to franchisee
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

  // Initialize selected codes when modal opens or saved codes change
  useEffect(() => {
    if (open) {
      // Pre-select accounts that match saved codes
      const savedSet = new Set(savedRevenueCodes);
      const matching = revenueAccounts
        .filter((a) => savedSet.has(a.accountCode))
        .map((a) => a.accountCode);
      setSelectedCodes(new Set(matching));
    }
  }, [open, savedRevenueCodes, revenueAccounts]);

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

  // Handle save
  const handleSave = async () => {
    await onSave(Array.from(selectedCodes), saveToFranchisee);
    onOpenChange(false);
  };

  // Calculate total of selected accounts
  const selectedTotal = revenueAccounts
    .filter((a) => selectedCodes.has(a.accountCode))
    .reduce((sum, a) => sum + a.totalAmount, 0);

  // Check if account is from saved codes
  const isSavedCode = (code: string) => savedRevenueCodes.includes(code);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            התאמות הכנסות
          </DialogTitle>
          <DialogDescription>
            בחר את החשבונות שמייצגים הכנסות מזון/משקאות
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {revenueAccounts.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">
              לא נמצאו חשבונות הכנסות בקובץ
            </p>
          ) : (
            revenueAccounts.map((account) => {
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
                        {isSavedCode(account.accountCode) && (
                          <Badge variant="outline" className="text-blue-600 border-blue-300">
                            שמור
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
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
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
