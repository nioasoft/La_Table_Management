"use client";

import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { companyIdFromSelect, NO_COMPANY, selectValueOf } from "@/app/(protected)/admin/hashavshevet/page-state";
import { settingsCopy } from "@/lib/hashavshevet/copy";
import { usePatchMapping, type CompanyDto, type MappingPatch, type MappingsDto } from "@/queries/hashavshevet";
import { EmptyBlock } from "./query-boundary";

interface CompanySelectProps {
  value: string | null;
  companies: CompanyDto[];
  disabled: boolean;
  label: string;
  onChange: (companyId: string | null) => void;
}

function CompanySelect({ value, companies, disabled, label, onChange }: CompanySelectProps) {
  return (
    <Select dir="rtl" value={selectValueOf(value)} disabled={disabled} onValueChange={(v) => onChange(companyIdFromSelect(v))}>
      <SelectTrigger dir="rtl" className="w-56 [&>span]:text-end" aria-label={label}>
        <SelectValue placeholder={settingsCopy.pickCompany} />
      </SelectTrigger>
      <SelectContent dir="rtl">
        <SelectItem value={NO_COMPANY}>{settingsCopy.noCompany}</SelectItem>
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nameHe}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface TableProps {
  companies: CompanyDto[];
  disabled: boolean;
  onAssign: (patch: MappingPatch) => void;
}

function BrandsTable({ brands, companies, disabled, onAssign }: TableProps & { brands: MappingsDto["brands"] }) {
  if (brands.length === 0) return <EmptyBlock title={settingsCopy.brandsEmpty} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{settingsCopy.brandColumn}</TableHead>
          <TableHead>{settingsCopy.companyColumn}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {brands.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-medium">{b.nameHe}</TableCell>
            <TableCell>
              <CompanySelect
                value={b.companyId}
                companies={companies}
                disabled={disabled}
                label={`${settingsCopy.companyColumn}: ${b.nameHe}`}
                onChange={(companyId) => onAssign({ kind: "brand", id: b.id, companyId })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FranchiseesTable({ franchisees, companies, disabled, onAssign }: TableProps & { franchisees: MappingsDto["franchisees"] }) {
  if (franchisees.length === 0) return <EmptyBlock title={settingsCopy.franchiseesEmpty} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{settingsCopy.franchiseeColumn}</TableHead>
          <TableHead>{settingsCopy.brandColumn}</TableHead>
          <TableHead>{settingsCopy.companyColumn}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {franchisees.map((f) => (
          <TableRow key={f.id}>
            <TableCell className="font-medium">{f.name}</TableCell>
            <TableCell className="text-muted-foreground">{f.brandCode}</TableCell>
            <TableCell>
              <CompanySelect
                value={f.companyId}
                companies={companies}
                disabled={disabled}
                label={`${settingsCopy.companyColumn}: ${f.name}`}
                onChange={(companyId) => onAssign({ kind: "franchisee", id: f.id, companyId })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface MappingsSectionProps {
  mappings: MappingsDto;
  companies: CompanyDto[];
  isSuperUser: boolean;
}

/** Spec §7: which Hashavshevet company each brand and each active franchisee sends to. Admins see it read-only. */
export function MappingsSection({ mappings, companies, isSuperUser }: MappingsSectionProps) {
  const patchMapping = usePatchMapping();
  const assign = (patch: MappingPatch) =>
    patchMapping.mutate(patch, {
      onSuccess: () => toast.success(settingsCopy.saved),
      onError: (err) => toast.error(err.message || settingsCopy.saveFailed),
    });
  const shared = { companies, disabled: !isSuperUser || patchMapping.isPending, onAssign: assign };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-medium">{settingsCopy.brandsTitle}</h3>
        <BrandsTable brands={mappings.brands} {...shared} />
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">{settingsCopy.franchiseesTitle}</h3>
        <FranchiseesTable franchisees={mappings.franchisees} {...shared} />
      </div>
    </div>
  );
}
