"use client";

/**
 * Typeable franchisee picker (cmdk Command inside a Popover).
 *
 * Replaces the mouse-only Radix <Select> on screens that pick a franchisee, so
 * the user can free-text filter by name instead of scrolling/clicking (Reut,
 * 2026-06-04). Extracted from the commission-invoices page so both that screen
 * and the customer-reconciliation screen share one implementation.
 *
 * Modes:
 *  - Filter (commission invoices): pass `allLabel` to render a "clear/all" item;
 *    `selectedId = null` means "all".
 *  - Required single-select (reconciliation): omit `allLabel`; map empty string
 *    state to `null` on the way in and back out.
 */

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface FranchiseeComboboxProps {
  franchisees: Array<{ id: string; name: string }>;
  selectedId: string | null;
  onChange: (id: string | null) => void;
  /** Trigger text shown when nothing is selected. */
  placeholder?: string;
  /** Placeholder inside the search input. */
  searchPlaceholder?: string;
  /** When set, renders a clear/"all" item with this label (filter mode). */
  allLabel?: string;
  triggerClassName?: string;
}

export function FranchiseeCombobox({
  franchisees,
  selectedId,
  onChange,
  placeholder = "כל הזכיינים",
  searchPlaceholder = "חפש זכיין...",
  allLabel,
  triggerClassName,
}: FranchiseeComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedId
    ? franchisees.find((f) => f.id === selectedId)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "min-w-[200px] justify-between font-normal",
            triggerClassName
          )}
          dir="rtl"
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected?.name ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" dir="rtl">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>לא נמצאו זכיינים</CommandEmpty>
            <CommandGroup>
              {allLabel && (
                <CommandItem
                  value="__all__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "me-2 h-4 w-4",
                      !selectedId ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {franchisees
                .filter((f) => f.id)
                .map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`${f.name} ${f.id}`}
                    onSelect={() => {
                      onChange(f.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "me-2 h-4 w-4",
                        selectedId === f.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {f.name}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
