"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Truck } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import type { Supplier, SupplierFileMapping } from "@/db/schema";

interface SupplierWithMapping extends Supplier {
  fileMapping: SupplierFileMapping | null;
}

interface SupplierComboboxProps {
  suppliers: SupplierWithMapping[];
  selectedSupplierId: string;
  onSelect: (supplierId: string) => void;
  disabled?: boolean;
}

export function SupplierCombobox({
  suppliers,
  selectedSupplierId,
  onSelect,
  disabled = false,
}: SupplierComboboxProps) {
  const [open, setOpen] = React.useState(false);

  // Sort suppliers alphabetically by Hebrew name
  const sortedSuppliers = React.useMemo(
    () => [...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'he')),
    [suppliers]
  );

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between h-auto min-h-10 py-2"
          >
            {selectedSupplier ? (
              <div className="flex items-center gap-2">
                <span className="font-medium">{selectedSupplier.name}</span>
                <span className="text-muted-foreground text-sm">
                  ({selectedSupplier.code})
                </span>
                <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            ) : (
              <span className="text-muted-foreground">בחר ספק...</span>
            )}
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="חיפוש ספק..." />
            <CommandList>
              <CommandEmpty>לא נמצאו ספקים</CommandEmpty>
              <CommandGroup>
                {sortedSuppliers.map((supplier) => (
                  <CommandItem
                    key={supplier.id}
                    value={`${supplier.name} ${supplier.code}`}
                    onSelect={() => {
                      onSelect(supplier.id);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Check
                        className={cn(
                          "h-4 w-4",
                          selectedSupplierId === supplier.id
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <Badge variant="outline" className="text-xs">
                        {supplier.fileMapping?.fileType.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{supplier.name}</span>
                      <span className="text-muted-foreground text-sm">
                        ({supplier.code})
                      </span>
                      <Truck className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected Supplier Info - Inline */}
      {selectedSupplier && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
          <div className="flex items-center gap-1.5">
            <span>סוג קובץ:</span>
            <Badge variant="outline" className="text-xs">
              {selectedSupplier.fileMapping?.fileType.toUpperCase()}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span>מע&quot;מ:</span>
            <span>{selectedSupplier.vatIncluded ? "כלול" : "לא כלול"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
