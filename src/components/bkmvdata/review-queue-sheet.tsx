"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Inbox,
  Building2,
  CalendarRange,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  useBkmvReviewQueue,
  type BkmvReviewQueueItem,
} from "@/queries/bkmv-review-queue";
import { useFranchisees } from "@/queries/franchisees";

interface Franchisee {
  id: string;
  name: string;
  code: string;
}

interface ReviewQueueSheetProps {
  currentFileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALL_FRANCHISEES = "__all__";

function formatDateRange(start: string | null, end: string | null) {
  if (!start || !end) return "ללא תקופה";
  const fmt = (d: string) => new Date(d).toLocaleDateString("he-IL");
  return `${fmt(start)} – ${fmt(end)}`;
}

function MatchStatsBadge({
  stats,
}: {
  stats: BkmvReviewQueueItem["matchStats"];
}) {
  if (!stats) {
    return (
      <Badge variant="outline" className="text-xs">
        ללא נתונים
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Badge variant="secondary" className="text-xs">
        {stats.exactMatches} מדויק
      </Badge>
      {stats.fuzzyMatches > 0 && (
        <Badge variant="outline" className="text-xs">
          {stats.fuzzyMatches} מטושטש
        </Badge>
      )}
      {stats.unmatched > 0 && (
        <Badge variant="destructive" className="text-xs">
          {stats.unmatched} ללא התאמה
        </Badge>
      )}
    </div>
  );
}

function FileRow({
  file,
  isCurrent,
  onPick,
}: {
  file: BkmvReviewQueueItem;
  isCurrent: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !isCurrent && onPick(file.id)}
      disabled={isCurrent}
      className={cn(
        "w-full text-right rounded-md border p-3 transition-colors",
        "hover:bg-muted hover:border-primary/40",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        isCurrent && "bg-muted opacity-60 pointer-events-none"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <p
            className="font-medium text-sm truncate"
            title={file.fileName}
          >
            {file.fileName}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="h-3 w-3 shrink-0" />
            <span>
              {formatDateRange(file.periodStartDate, file.periodEndDate)}
            </span>
          </div>
          <div className="pt-1">
            <MatchStatsBadge stats={file.matchStats} />
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {isCurrent ? (
            <Badge variant="outline" className="text-xs">
              בסקירה כעת
            </Badge>
          ) : (
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>
    </button>
  );
}

function FranchiseeCombobox({
  franchisees,
  value,
  onChange,
  isLoading,
}: {
  franchisees: Franchisee[];
  value: string;
  onChange: (v: string) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const sorted = React.useMemo(
    () => [...franchisees].sort((a, b) => a.name.localeCompare(b.name, "he")),
    [franchisees]
  );

  const selected = franchisees.find((f) => f.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isLoading}
          className="w-full justify-between"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value === ALL_FRANCHISEES
                ? "כל הזכיינים"
                : selected
                  ? `${selected.name} (${selected.code})`
                  : "בחר זכיין..."}
            </span>
          </div>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
        dir="rtl"
      >
        <Command>
          <CommandInput placeholder="חיפוש זכיין..." />
          <CommandList>
            <CommandEmpty>לא נמצאו זכיינים</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="כל הזכיינים"
                onSelect={() => {
                  onChange(ALL_FRANCHISEES);
                  setOpen(false);
                }}
                className="flex items-center gap-2"
              >
                <Check
                  className={cn(
                    "h-4 w-4",
                    value === ALL_FRANCHISEES ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="font-medium">כל הזכיינים</span>
              </CommandItem>
              {sorted.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`${f.name} ${f.code}`}
                  onSelect={() => {
                    onChange(f.id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === f.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span>{f.name}</span>
                  <span className="text-muted-foreground text-xs">
                    ({f.code})
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

function groupByFranchisee(files: BkmvReviewQueueItem[]) {
  const groups = new Map<
    string,
    { name: string; code: string; items: BkmvReviewQueueItem[] }
  >();
  const unknownKey = "__unknown__";

  for (const file of files) {
    const key = file.franchisee?.id ?? unknownKey;
    const name = file.franchisee?.name ?? "ללא זכיין מזוהה";
    const code = file.franchisee?.code ?? "";
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(file);
    } else {
      groups.set(key, { name, code, items: [file] });
    }
  }

  // Sort: groups by item count desc, then name. Items inside: createdAt desc.
  const result = Array.from(groups.entries()).map(([id, g]) => ({
    id,
    name: g.name,
    code: g.code,
    items: [...g.items].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
  }));
  result.sort((a, b) => {
    if (b.items.length !== a.items.length) {
      return b.items.length - a.items.length;
    }
    return a.name.localeCompare(b.name, "he");
  });
  return result;
}

export function ReviewQueueSheet({
  currentFileId,
  open,
  onOpenChange,
}: ReviewQueueSheetProps) {
  const router = useRouter();
  const [selectedFranchisee, setSelectedFranchisee] =
    React.useState<string>(ALL_FRANCHISEES);

  const franchiseeFilter =
    selectedFranchisee === ALL_FRANCHISEES ? undefined : selectedFranchisee;

  const { data: franchiseesData, isLoading: isLoadingFranchisees } =
    useFranchisees();
  const franchisees: Franchisee[] = React.useMemo(
    () => (franchiseesData ?? []) as Franchisee[],
    [franchiseesData]
  );

  const { data, isLoading, isError } = useBkmvReviewQueue(
    franchiseeFilter,
    open
  );

  const files = React.useMemo(() => data?.files ?? [], [data?.files]);
  const total = data?.total ?? 0;

  const handlePick = React.useCallback(
    (id: string) => {
      onOpenChange(false);
      router.push(`/admin/bkmvdata/review/${id}`);
    },
    [router, onOpenChange]
  );

  const grouped = React.useMemo(
    () => groupByFranchisee(files),
    [files]
  );

  const showFlat = selectedFranchisee !== ALL_FRANCHISEES;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        dir="rtl"
        className="w-full sm:max-w-md md:max-w-lg flex flex-col gap-4 overflow-hidden"
      >
        <SheetHeader className="text-right space-y-1">
          <SheetTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            קבצים ממתינים לסקירה
            {!isLoading && (
              <Badge variant="secondary" className="ms-1">
                {total}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            בחר זכיין כדי לסנן, או דפדף בכל הקבצים מקובצים לפי זכיין. לחיצה על
            קובץ פותחת אותו לסקירה.
          </SheetDescription>
        </SheetHeader>

        <div className="px-1">
          <FranchiseeCombobox
            franchisees={franchisees}
            value={selectedFranchisee}
            onChange={setSelectedFranchisee}
            isLoading={isLoadingFranchisees}
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 -my-2 py-2 space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive text-center">
              שגיאה בטעינת תור הסקירה
            </div>
          ) : files.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <Inbox className="h-10 w-10 mx-auto mb-3 opacity-50" />
              {franchiseeFilter
                ? "אין קבצים ממתינים לסקירה עבור הזכיין הזה"
                : "אין קבצים ממתינים לסקירה"}
            </div>
          ) : showFlat ? (
            <div className="space-y-2">
              {[...files]
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime()
                )
                .map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isCurrent={file.id === currentFileId}
                    onPick={handlePick}
                  />
                ))}
            </div>
          ) : (
            <Accordion
              type="multiple"
              defaultValue={grouped[0] ? [grouped[0].id] : []}
              className="space-y-2"
            >
              {grouped.map((group) => (
                <AccordionItem
                  key={group.id}
                  value={group.id}
                  className="border rounded-md px-3"
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0 text-right">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium truncate">{group.name}</span>
                      {group.code && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          ({group.code})
                        </span>
                      )}
                      <Badge variant="secondary" className="ms-auto shrink-0">
                        {group.items.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-1 pb-3">
                    <div className="space-y-2">
                      {group.items.map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          isCurrent={file.id === currentFileId}
                          onPick={handlePick}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
