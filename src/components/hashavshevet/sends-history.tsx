"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ALL,
  companyOptions,
  EMPTY_FILTER,
  filterHistory,
  formatSentAt,
  HISTORY_STATUSES,
  periodLabel,
  statusBadgeVariant,
  type HistoryFilter,
} from "@/app/(protected)/admin/hashavshevet/page-state";
import { exportLabels, formatShekel, sendsCopy, sendStatusLabels } from "@/lib/hashavshevet/copy";
import { EXPORT_TYPES } from "@/lib/hashavshevet/types";
import type { SendDto } from "@/queries/hashavshevet";
import { EmptyBlock } from "./query-boundary";

interface FilterSelectProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select dir="rtl" value={value} onValueChange={onChange}>
        <SelectTrigger dir="rtl" className="w-48 [&>span]:text-end" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value={ALL}>{sendsCopy.allOption}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function HistoryRow({ send, onOpen }: { send: SendDto; onOpen: (id: string) => void }) {
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpen(send.id)}>
      <TableCell>
        <div>{formatSentAt(send.sentAt)}</div>
        {send.sentBy && <div className="text-xs text-muted-foreground">{send.sentBy}</div>}
      </TableCell>
      <TableCell className="font-medium">{send.companyName}</TableCell>
      <TableCell>{exportLabels[send.exportType]}</TableCell>
      <TableCell>{periodLabel(send.exportType, send.params)}</TableCell>
      <TableCell>{send.rowCount}</TableCell>
      <TableCell>{formatShekel(send.total)}</TableCell>
      <TableCell>
        <Badge variant={statusBadgeVariant(send.status)}>{sendStatusLabels[send.status]}</Badge>
        {send.resolutionNote && <div className="mt-1 max-w-56 text-xs text-muted-foreground">{send.resolutionNote}</div>}
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(send.id);
          }}
        >
          {sendsCopy.details}
        </Button>
      </TableCell>
    </TableRow>
  );
}

interface FiltersProps {
  sends: SendDto[];
  filter: HistoryFilter;
  onChange: (key: keyof HistoryFilter) => (value: string) => void;
}

function HistoryFilters({ sends, filter, onChange }: FiltersProps) {
  return (
    <div className="flex flex-wrap gap-4">
      <FilterSelect
        label={sendsCopy.statusFilter}
        value={filter.status}
        options={HISTORY_STATUSES.map((s) => ({ value: s, label: sendStatusLabels[s] }))}
        onChange={onChange("status")}
      />
      <FilterSelect
        label={sendsCopy.companyFilter}
        value={filter.companyId}
        options={companyOptions(sends).map((c) => ({ value: c.id, label: c.name }))}
        onChange={onChange("companyId")}
      />
      <FilterSelect
        label={sendsCopy.exportFilter}
        value={filter.exportType}
        options={EXPORT_TYPES.map((t) => ({ value: t, label: exportLabels[t] }))}
        onChange={onChange("exportType")}
      />
    </div>
  );
}

function HistoryTable({ sends, onOpen }: { sends: SendDto[]; onOpen: (id: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{sendsCopy.sentOn}</TableHead>
          <TableHead>{sendsCopy.companyColumn}</TableHead>
          <TableHead>{sendsCopy.exportColumn}</TableHead>
          <TableHead>{sendsCopy.periodColumn}</TableHead>
          <TableHead>{sendsCopy.rowsColumn}</TableHead>
          <TableHead>{sendsCopy.totalColumn}</TableHead>
          <TableHead>{sendsCopy.statusColumn}</TableHead>
          <TableHead>
            <span className="sr-only">{sendsCopy.details}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sends.map((send) => (
          <HistoryRow key={send.id} send={send} onOpen={onOpen} />
        ))}
      </TableBody>
    </Table>
  );
}

interface SendsHistoryProps {
  sends: SendDto[];
  onOpen: (id: string) => void;
}

/** Settled and in-flight sends below the queue, filterable by status, company and export type. */
export function SendsHistory({ sends, onOpen }: SendsHistoryProps) {
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_FILTER);
  const shown = filterHistory(sends, filter);
  const onChange = (key: keyof HistoryFilter) => (value: string) => setFilter((f) => ({ ...f, [key]: value }));

  return (
    <section className="space-y-3" aria-labelledby="hashavshevet-history-title">
      <h2 id="hashavshevet-history-title" className="text-lg font-semibold">
        {sendsCopy.historyTitle}
      </h2>
      {sends.length === 0 && <EmptyBlock title={sendsCopy.historyEmpty} />}
      {sends.length > 0 && <HistoryFilters sends={sends} filter={filter} onChange={onChange} />}
      {sends.length > 0 && shown.length === 0 && <EmptyBlock title={sendsCopy.historyFilteredEmpty} />}
      {shown.length > 0 && <HistoryTable sends={shown} onOpen={onOpen} />}
    </section>
  );
}
