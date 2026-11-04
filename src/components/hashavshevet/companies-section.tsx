"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { companyRowView } from "@/app/(protected)/admin/hashavshevet/page-state";
import { settingsCopy } from "@/lib/hashavshevet/copy";
import { usePatchCompany, type CompanyDto, type CompanyPatch } from "@/queries/hashavshevet";
import { ActivateDialog, DeactivateDialog } from "./company-dialogs";

type Editing = { kind: "activate" | "deactivate"; company: CompanyDto } | null;

interface CompanyLineProps {
  company: CompanyDto;
  isSuperUser: boolean;
  saving: boolean;
  onSave: (company: CompanyDto, patch: CompanyPatch) => void;
  onEdit: (editing: NonNullable<Editing>) => void;
}

function CompanyLine({ company, isSuperUser, saving, onSave, onEdit }: CompanyLineProps) {
  const view = companyRowView(company, isSuperUser);
  return (
    <TableRow>
      <TableCell className="font-mono text-xs" dir="ltr">
        {company.fileName}
      </TableCell>
      <TableCell>{company.compId ?? "—"}</TableCell>
      <TableCell className="font-medium">{company.nameHe}</TableCell>
      <TableCell className={view.isLive ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>{view.statusText}</TableCell>
      <TableCell>
        <Switch
          checked={company.requiresApproval}
          disabled={!view.canEditApproval || saving}
          onCheckedChange={(requiresApproval) => onSave(company, { requiresApproval })}
          aria-label={`${settingsCopy.approvalColumn}: ${company.nameHe}`}
        />
      </TableCell>
      {isSuperUser && (
        <TableCell>
          {view.canActivate && (
            <Button size="sm" onClick={() => onEdit({ kind: "activate", company })}>
              {settingsCopy.activate}
            </Button>
          )}
          {view.canDeactivate && (
            <Button size="sm" variant="outline" onClick={() => onEdit({ kind: "deactivate", company })}>
              {settingsCopy.deactivate}
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

interface CompaniesSectionProps {
  companies: CompanyDto[];
  isSuperUser: boolean;
}

/** Spec §9: file, id, name, live state and the requires-approval switch of each company. Edit controls are super-user only. */
export function CompaniesSection({ companies, isSuperUser }: CompaniesSectionProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const patchCompany = usePatchCompany();

  const save = (company: CompanyDto, patch: CompanyPatch) =>
    patchCompany.mutate(
      { id: company.id, patch },
      {
        onSuccess: () => toast.success(settingsCopy.saved),
        onError: (err) => toast.error(err.message || settingsCopy.saveFailed),
      },
    );

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{settingsCopy.fileColumn}</TableHead>
            <TableHead>{settingsCopy.compIdColumn}</TableHead>
            <TableHead>{settingsCopy.nameColumn}</TableHead>
            <TableHead>{settingsCopy.statusColumn}</TableHead>
            <TableHead title={settingsCopy.approvalHint}>{settingsCopy.approvalColumn}</TableHead>
            {isSuperUser && <TableHead>{settingsCopy.actionsColumn}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => (
            <CompanyLine key={company.id} company={company} isSuperUser={isSuperUser} saving={patchCompany.isPending} onSave={save} onEdit={setEditing} />
          ))}
        </TableBody>
      </Table>
      {editing?.kind === "activate" && (
        <ActivateDialog
          companyName={editing.company.nameHe}
          onClose={() => setEditing(null)}
          onConfirm={(liveFrom) => save(editing.company, { liveFrom })}
        />
      )}
      {editing?.kind === "deactivate" && (
        <DeactivateDialog
          companyName={editing.company.nameHe}
          onClose={() => setEditing(null)}
          onConfirm={() => save(editing.company, { liveFrom: null })}
        />
      )}
    </>
  );
}
