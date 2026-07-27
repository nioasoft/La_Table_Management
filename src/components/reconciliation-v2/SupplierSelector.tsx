"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useReconciliationSuppliersWithFiles } from "@/queries/reconciliation-v2";

interface SupplierSelectorProps {
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Type-to-filter supplier picker. There are ~30 suppliers and scrolling a plain
 * <Select> to reach one was the slow part of starting a reconciliation — typing
 * a letter or two now narrows the list, by Hebrew name or by code.
 */
export function SupplierSelector({
  value,
  onValueChange,
  disabled,
}: SupplierSelectorProps) {
  const { data: suppliers, isLoading, error } = useReconciliationSuppliersWithFiles();
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () => [...(suppliers ?? [])].sort((a, b) => a.name.localeCompare(b.name, "he")),
    [suppliers]
  );

  const selected = suppliers?.find((s) => s.id === value);

  if (error) {
    return <div className="text-sm text-destructive">שגיאה בטעינת ספקים</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className="w-full justify-between font-normal"
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען ספקים...
            </span>
          ) : selected ? (
            <span className="flex items-center gap-2">
              <span>{selected.name}</span>
              <span className="text-muted-foreground text-xs">
                ({selected.fileCount} קבצים)
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">בחר ספק</span>
          )}
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
        dir="rtl"
      >
        <Command
          // Match on the supplier's name or code, so both "מיט" and "MIT" work.
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="הקלד שם ספק..." />
          <CommandList>
            <CommandEmpty>לא נמצאו ספקים</CommandEmpty>
            <CommandGroup>
              {sorted.map((supplier) => (
                <CommandItem
                  key={supplier.id}
                  value={`${supplier.name} ${supplier.code}`}
                  onSelect={() => {
                    onValueChange(supplier.id);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between gap-3"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === supplier.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="flex-1 truncate">{supplier.name}</span>
                  <span className="text-muted-foreground text-xs shrink-0">
                    {supplier.fileCount} קבצים
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
