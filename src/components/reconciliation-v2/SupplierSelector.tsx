"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReconciliationSuppliersWithFiles } from "@/queries/reconciliation-v2";
import { Loader2 } from "lucide-react";

interface SupplierSelectorProps {
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function SupplierSelector({
  value,
  onValueChange,
  disabled,
}: SupplierSelectorProps) {
  const { data: suppliers, isLoading, error } = useReconciliationSuppliersWithFiles();

  if (error) {
    return (
      <div className="text-sm text-destructive">שגיאה בטעינת ספקים</div>
    );
  }

  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="w-full">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>טוען ספקים...</span>
          </div>
        ) : (
          <SelectValue placeholder="בחר ספק" />
        )}
      </SelectTrigger>
      <SelectContent>
        {suppliers?.map((supplier) => (
          <SelectItem key={supplier.id} value={supplier.id}>
            <div className="flex items-center justify-between w-full gap-4">
              <span>{supplier.name}</span>
              <span className="text-muted-foreground text-xs">
                ({supplier.fileCount} קבצים)
              </span>
            </div>
          </SelectItem>
        ))}
        {suppliers?.length === 0 && (
          <div className="p-2 text-sm text-muted-foreground text-center">
            לא נמצאו ספקים עם קבצים
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
