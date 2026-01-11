"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { he } from "@/lib/translations/he";

// Discrepancy adjustment types with Hebrew and English labels
const ADJUSTMENT_TYPES = [
  { value: "credit", labelHe: "זיכוי", labelEn: "Credit", requiresDescription: false },
  { value: "deposit", labelHe: "פיקדון", labelEn: "Deposit", requiresDescription: false },
  { value: "supplier_error", labelHe: "טעות ספק", labelEn: "Supplier Error", requiresDescription: false },
  { value: "timing", labelHe: "הפרשי עיתוי", labelEn: "Timing Difference", requiresDescription: false },
  { value: "other", labelHe: "אחר", labelEn: "Other", requiresDescription: true },
];

interface ManualAdjustmentFormProps {
  settlementId: string;
  onSuccess?: () => void;
}

export function ManualAdjustmentForm({
  settlementId,
  onSuccess,
}: ManualAdjustmentFormProps) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Form state
  const [adjustmentType, setAdjustmentType] = React.useState<string>("");
  const [amount, setAmount] = React.useState<string>("");
  const [reason, setReason] = React.useState<string>("");
  const [description, setDescription] = React.useState<string>("");
  const [referenceNumber, setReferenceNumber] = React.useState<string>("");

  // Check if description is required
  const selectedType = ADJUSTMENT_TYPES.find((t) => t.value === adjustmentType);
  const requiresDescription = selectedType?.requiresDescription ?? false;

  // Validate form
  const isValid = () => {
    if (!adjustmentType) return false;
    if (!amount || isNaN(parseFloat(amount))) return false;
    if (!reason.trim()) return false;
    if (requiresDescription && !description.trim()) return false;
    return true;
  };

  // Reset form
  const resetForm = () => {
    setAdjustmentType("");
    setAmount("");
    setReason("");
    setDescription("");
    setReferenceNumber("");
    setError(null);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/settlements/${settlementId}/adjustments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            adjustmentType,
            amount,
            reason: reason.trim(),
            description: description.trim() || undefined,
            referenceNumber: referenceNumber.trim() || undefined,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || he.components.manualAdjustmentForm.errors.failedToCreate);
      }

      // Success
      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : he.components.manualAdjustmentForm.errors.unexpectedError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) resetForm();
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="add-adjustment-button">
          <Plus className="h-4 w-4 me-2" />
          הוספת התאמה ידנית
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader>
          <DialogTitle>הוספת התאמה ידנית</DialogTitle>
          <DialogDescription>
            הוסף התאמה ידנית לתקופת ההתחשבנות לטיפול בפערים
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {/* Adjustment Type */}
            <div className="grid gap-2">
              <Label htmlFor="adjustmentType">סוג התאמה *</Label>
              <Select
                value={adjustmentType}
                onValueChange={setAdjustmentType}
              >
                <SelectTrigger id="adjustmentType" data-testid="adjustment-type-select">
                  <SelectValue placeholder="בחר סוג התאמה" />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.labelHe} ({type.labelEn})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="grid gap-2">
              <Label htmlFor="amount">סכום *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="הזן סכום"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="adjustment-amount-input"
              />
            </div>

            {/* Reason */}
            <div className="grid gap-2">
              <Label htmlFor="reason">סיבה *</Label>
              <Input
                id="reason"
                placeholder="הזן סיבת ההתאמה"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="adjustment-reason-input"
              />
            </div>

            {/* Description (required for "other" type) */}
            <div className="grid gap-2">
              <Label htmlFor="description">
                תיאור {requiresDescription ? "*" : "(אופציונלי)"}
              </Label>
              <Input
                id="description"
                placeholder="הזן תיאור מפורט"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="adjustment-description-input"
              />
              {requiresDescription && (
                <p className="text-sm text-muted-foreground">
                  תיאור נדרש עבור סוג &quot;אחר&quot;
                </p>
              )}
            </div>

            {/* Reference Number */}
            <div className="grid gap-2">
              <Label htmlFor="referenceNumber">מספר אסמכתא (אופציונלי)</Label>
              <Input
                id="referenceNumber"
                placeholder="הזן מספר אסמכתא"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                data-testid="adjustment-reference-input"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="text-sm text-red-500 bg-red-50 p-2 rounded" data-testid="adjustment-error">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={loading || !isValid()}
              data-testid="submit-adjustment-button"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  שומר...
                </>
              ) : (
                "שמור התאמה"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ManualAdjustmentForm;
