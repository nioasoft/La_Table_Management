"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "./StatusBadge";
import { Check } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import type { ReconciliationReviewQueueItem } from "@/types/reconciliation-v2";

interface ReviewQueueTableProps {
  items: ReconciliationReviewQueueItem[];
  onResolve: (queueItemId: string, notes?: string) => void;
  isResolving?: boolean;
}

function formatCurrency(amount: string | number | null): string {
  if (amount === null) return "₪0";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatPeriod(startDate: string, endDate: string): string {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return `${format(start, "MMM", { locale: he })} - ${format(end, "MMM yyyy", { locale: he })}`;
  } catch {
    return `${startDate} - ${endDate}`;
  }
}

export function ReviewQueueTable({
  items,
  onResolve,
  isResolving,
}: ReviewQueueTableProps) {
  const [selectedItem, setSelectedItem] = useState<ReconciliationReviewQueueItem | null>(null);
  const [notes, setNotes] = useState("");

  const handleResolve = () => {
    if (selectedItem) {
      onResolve(selectedItem.id, notes || undefined);
      setSelectedItem(null);
      setNotes("");
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
        <p>אין פריטים בתור בדיקה!</p>
        <p className="text-sm">כל הפערים נפתרו</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ספק</TableHead>
              <TableHead>זכיין</TableHead>
              <TableHead>תקופה</TableHead>
              <TableHead>סכום ספק</TableHead>
              <TableHead>סכום זכיין</TableHead>
              <TableHead>הפרש</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.supplierName}</TableCell>
                <TableCell>{item.franchiseeName}</TableCell>
                <TableCell className="text-sm">
                  {formatPeriod(item.periodStartDate, item.periodEndDate)}
                </TableCell>
                <TableCell className="font-mono">
                  {formatCurrency(item.supplierAmount)}
                </TableCell>
                <TableCell className="font-mono">
                  {formatCurrency(item.franchiseeAmount)}
                </TableCell>
                <TableCell className="font-mono text-red-600">
                  {formatCurrency(item.difference)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    onClick={() => setSelectedItem(item)}
                    disabled={isResolving}
                  >
                    פתור
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>פתרון פער</DialogTitle>
            <DialogDescription>
              {selectedItem && (
                <>
                  ספק: {selectedItem.supplierName} | זכיין: {selectedItem.franchiseeName}
                  <br />
                  הפרש: {formatCurrency(selectedItem.difference)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="notes">הערות (אופציונלי)</Label>
              <Textarea
                id="notes"
                placeholder="הזן הערות על פתרון הפער..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>

          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleResolve} disabled={isResolving}>
              {isResolving ? "פותר..." : "אשר ופתור"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setSelectedItem(null)}
              disabled={isResolving}
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
