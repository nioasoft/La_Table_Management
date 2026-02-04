"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import type { ReconciliationHistoryItem } from "@/types/reconciliation-v2";

interface HistoryTableProps {
  items: ReconciliationHistoryItem[];
}

function formatCurrency(amount: string | number): string {
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

export function HistoryTable({ items }: HistoryTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        לא נמצאו רשומות היסטוריה
      </div>
    );
  }

  return (
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
            <TableHead>נבדק ע״י</TableHead>
            <TableHead>הערות</TableHead>
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
              <TableCell className="font-mono">
                {formatCurrency(item.difference)}
              </TableCell>
              <TableCell>
                <StatusBadge status={item.status as "auto_approved" | "manually_approved"} />
              </TableCell>
              <TableCell className="text-sm">
                {item.reviewedByName || "-"}
                {item.reviewedAt && (
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(item.reviewedAt), "dd/MM/yyyy", { locale: he })}
                  </div>
                )}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-sm">
                {item.reviewNotes || "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
