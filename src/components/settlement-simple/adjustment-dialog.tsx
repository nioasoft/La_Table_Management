"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/translations";
import type { SettlementLineItem } from "@/data-access/settlement-simple";
import type { AdjustmentType } from "@/db/schema";

interface AdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: SettlementLineItem | null;
  onSubmit: (data: {
    commissionId: string;
    adjustmentAmount: number;
    reason: AdjustmentType;
    notes?: string;
  }) => Promise<void>;
  isSubmitting?: boolean;
}

const adjustmentReasons: { value: AdjustmentType; label: string }[] = [
  { value: "timing", label: "הפרשי עיתוי" },
  { value: "deposit", label: "פיקדון" },
  { value: "supplier_error", label: "טעות ספק" },
  { value: "other", label: "אחר" },
];

export function AdjustmentDialog({
  open,
  onOpenChange,
  item,
  onSubmit,
  isSubmitting = false,
}: AdjustmentDialogProps) {
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [reason, setReason] = useState<AdjustmentType>("timing");
  const [notes, setNotes] = useState("");

  // Reset form when dialog opens with new item
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && item) {
      setAdjustmentAmount(item.difference.toString());
      setReason("timing");
      setNotes("");
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = async () => {
    if (!item) return;

    const amount = parseFloat(adjustmentAmount);
    if (isNaN(amount)) return;

    await onSubmit({
      commissionId: item.commissionId,
      adjustmentAmount: amount,
      reason,
      notes: notes || undefined,
    });
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>תיקון הפרש</DialogTitle>
          <DialogDescription className="text-right">
            הוסף תיקון להפרש בין סכום הספק לסכום הזכיין
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Item details */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">ספק</p>
              <p className="font-medium">{item.supplierName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">זכיין</p>
              <p className="font-medium">{item.franchiseeName}</p>
            </div>
          </div>

          {/* Amounts comparison */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">סכום ספק</p>
              <p className="font-bold text-blue-700">
                {formatCurrency(item.supplierAmount)}
              </p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">סכום זכיין</p>
              <p className="font-bold text-green-700">
                {item.franchiseeAmount !== null
                  ? formatCurrency(item.franchiseeAmount)
                  : "-"}
              </p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">הפרש</p>
              <p className="font-bold text-orange-700">
                {formatCurrency(item.difference)}
              </p>
            </div>
          </div>

          {/* Adjustment amount */}
          <div className="space-y-2">
            <Label htmlFor="adjustmentAmount">סכום תיקון</Label>
            <Input
              id="adjustmentAmount"
              type="number"
              step="0.01"
              value={adjustmentAmount}
              onChange={(e) => setAdjustmentAmount(e.target.value)}
              placeholder="הזן סכום"
              className="text-left"
              dir="ltr"
            />
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">סיבה</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentType)}>
              <SelectTrigger id="reason" dir="rtl" className="[&>span]:text-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {adjustmentReasons.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-end">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">הערות (אופציונלי)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="הוסף הערות..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex-row-reverse sm:flex-row-reverse gap-2">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !adjustmentAmount}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            שמור
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
