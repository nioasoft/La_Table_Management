"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  EyeOff,
  Eye,
  Link2,
  Loader2,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  useOccasionalClients,
  useUpdateOccasionalClient,
  useLinkOccasionalClient,
  useDeleteOccasionalClient,
} from "@/queries/occasional-clients";
import { useClients } from "@/queries/clients";
import type { OccasionalClient } from "@/db/schema";

interface ClientLite {
  id: string;
  name: string;
  code: string | null;
}

const MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

function formatFirstSeen(row: OccasionalClient): string {
  if (!row.firstSeenPeriodMonth || !row.firstSeenPeriodYear) return "—";
  return `${MONTHS[row.firstSeenPeriodMonth - 1] ?? row.firstSeenPeriodMonth} ${row.firstSeenPeriodYear}`;
}

interface EditableRowProps {
  row: OccasionalClient;
  onSave: (
    id: string,
    patch: { hashavshevetName?: string | null }
  ) => Promise<void>;
  onToggleIgnore: (row: OccasionalClient) => Promise<void>;
  onLink: (row: OccasionalClient) => void;
  onDelete: (row: OccasionalClient) => void;
  isToggling: boolean;
}

function EditableRow({
  row,
  onSave,
  onToggleIgnore,
  onLink,
  onDelete,
  isToggling,
}: EditableRowProps) {
  const [name, setName] = useState(row.hashavshevetName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(row.hashavshevetName ?? "");
  }, [row.hashavshevetName]);

  const dirty = name.trim() !== (row.hashavshevetName ?? "").trim();

  const handleBlurName = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave(row.id, { hashavshevetName: name.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableRow className={row.ignored ? "opacity-60" : ""}>
      <TableCell className="font-medium text-sm">
        <span dir="auto">{row.tabitColumnName}</span>
      </TableCell>
      <TableCell>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleBlurName}
          placeholder="—"
          className="h-8 text-sm max-w-[260px]"
          disabled={row.ignored}
        />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
        {formatFirstSeen(row)}
      </TableCell>
      <TableCell className="text-center">
        {saving && dirty ? (
          <Loader2 className="inline h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </TableCell>
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          {!row.ignored && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onLink(row)}
              className="h-8"
              title="קשר ללקוח קיים"
            >
              <Link2 className="me-1 h-4 w-4" />
              קשר
            </Button>
          )}
          <Button
            variant={row.ignored ? "outline" : "ghost"}
            size="sm"
            onClick={() => onToggleIgnore(row)}
            disabled={isToggling}
            className="h-8"
          >
            {row.ignored ? (
              <>
                <Eye className="me-1 h-4 w-4" />
                החזר
              </>
            ) : (
              <>
                <EyeOff className="me-1 h-4 w-4" />
                התעלם
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(row)}
            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="מחק לצמיתות"
            aria-label="מחק לצמיתות"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

interface DeleteConfirmDialogProps {
  occasional: OccasionalClient;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isPending: boolean;
}

function DeleteConfirmDialog({
  occasional,
  onClose,
  onConfirm,
  isPending,
}: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  const expected = occasional.tabitColumnName.trim();
  const matches = typed.trim() === expected && expected.length > 0;

  const handleAction = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!matches || isPending) return;
    await onConfirm();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <AlertDialogContent dir="rtl" className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            מחיקת לקוח מזדמן
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-right">
              <p>
                אתה עומד למחוק לצמיתות את{" "}
                <span className="font-semibold" dir="auto">
                  &quot;{occasional.tabitColumnName}&quot;
                </span>
                . כל הסכומים המשויכים אליו (פר זכיין ותקופה) יימחקו גם הם.
              </p>
              <p className="text-destructive text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>הפעולה בלתי הפיכה. לא ניתן לשחזר לאחר מכן.</span>
              </p>
              <div className="space-y-2">
                <Label htmlFor="delete-confirm-typed" className="text-sm">
                  כדי לאשר, הקלד את השם:{" "}
                  <span className="font-semibold" dir="auto">
                    {expected}
                  </span>
                </Label>
                <Input
                  id="delete-confirm-typed"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={expected}
                  dir="auto"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <AlertDialogAction
            onClick={handleAction}
            disabled={!matches || isPending}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
          >
            {isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
            מחק לצמיתות
          </AlertDialogAction>
          <AlertDialogCancel disabled={isPending}>ביטול</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occasional: OccasionalClient | null;
  clients: ClientLite[];
  onConfirm: (clientId: string, addAlias: boolean) => Promise<void>;
  isPending: boolean;
}

function LinkDialog({
  open,
  onOpenChange,
  occasional,
  clients,
  onConfirm,
  isPending,
}: LinkDialogProps) {
  const [clientId, setClientId] = useState<string>("");
  const [addAlias, setAddAlias] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setClientId("");
      setAddAlias(true);
      setSearch("");
    }
  }, [open]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  const handleConfirm = async () => {
    if (!clientId) return;
    await onConfirm(clientId, addAlias);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>קשר ללקוח קיים</DialogTitle>
          <DialogDescription>
            השם <span className="font-semibold">{occasional?.tabitColumnName}</span>{" "}
            יקושר ללקוח שתבחר. כל המסמכים שנמצאים תחת הלקוח המזדמן יועברו ללקוח הקיים.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>בחר לקוח</Label>
            <Input
              type="search"
              placeholder="חיפוש לפי שם או קוד..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="בחר לקוח..." />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {filteredClients.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    לא נמצאו לקוחות
                  </div>
                ) : (
                  filteredClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.code ? ` (${c.code})` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="add-alias"
              checked={addAlias}
              onCheckedChange={(checked) => setAddAlias(checked === true)}
            />
            <Label htmlFor="add-alias" className="cursor-pointer text-sm">
              הוסף את &quot;{occasional?.tabitColumnName}&quot; ל&quot;שמות חלופיים&quot; של הלקוח
              <span className="block text-xs text-muted-foreground mt-1">
                (כך עליות Tabit עתידיות יזוהו אוטומטית)
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter className="flex-row-reverse sm:flex-row-reverse gap-2">
          <Button
            onClick={handleConfirm}
            disabled={!clientId || isPending}
          >
            {isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
            קשר
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OccasionalClientsTab() {
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [filter, setFilter] = useState("");

  const { data, isLoading } = useOccasionalClients({ includeIgnored });
  const updateMutation = useUpdateOccasionalClient();
  const linkMutation = useLinkOccasionalClient();
  const deleteMutation = useDeleteOccasionalClient();
  const { data: clientsData } = useClients();
  const [linkTarget, setLinkTarget] = useState<OccasionalClient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OccasionalClient | null>(
    null
  );

  const clientsLite: ClientLite[] = useMemo(() => {
    if (!Array.isArray(clientsData)) return [];
    return (clientsData as Array<{ id: string; name: string; code: string | null; isActive: boolean }>)
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name, code: c.code }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [clientsData]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) =>
        r.tabitColumnName.toLowerCase().includes(q) ||
        (r.hashavshevetName ?? "").toLowerCase().includes(q)
    );
  }, [data, filter]);

  const handleSave = async (
    id: string,
    patch: {
      hashavshevetName?: string | null;
    }
  ) => {
    try {
      await updateMutation.mutateAsync({ id, patch });
      toast.success("נשמר");
    } catch (err) {
      toast.error((err as Error).message || "שגיאה בשמירה");
    }
  };

  const handleToggleIgnore = async (row: OccasionalClient) => {
    try {
      await updateMutation.mutateAsync({
        id: row.id,
        patch: { ignored: !row.ignored },
      });
      toast.success(row.ignored ? "הוחזר לרשימה" : "הותעלם");
    } catch (err) {
      toast.error((err as Error).message || "שגיאה");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const { id, tabitColumnName } = deleteTarget;
    try {
      const result = await deleteMutation.mutateAsync(id);
      toast.success(
        result.documentsDeleted > 0
          ? `"${tabitColumnName}" נמחק (${result.documentsDeleted} סכומים)`
          : `"${tabitColumnName}" נמחק`
      );
      setDeleteTarget(null);
    } catch (err) {
      toast.error((err as Error).message || "שגיאה במחיקה");
    }
  };

  const handleLinkConfirm = async (clientId: string, addAlias: boolean) => {
    if (!linkTarget) return;
    try {
      const result = await linkMutation.mutateAsync({
        id: linkTarget.id,
        clientId,
        addAlias,
      });
      const total = result.documentsCreated + result.documentsUpdated;
      toast.success(
        total > 0
          ? `קושר ללקוח (${total} מסמכים הועברו)`
          : "קושר ללקוח"
      );
      setLinkTarget(null);
    } catch (err) {
      toast.error((err as Error).message || "שגיאה בקישור");
    }
  };

  const visibleCount = filteredRows.length;

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">לקוחות מזדמנים</h2>
              {visibleCount > 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {visibleCount}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              עמודות שזוהו בקבצי טאביט ואינן ממופות ללקוח רשום. הזן שם בחשבשבת
              כדי שייכלל בייצוא חשבוניות לקוחות לזכיין.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="include-ignored"
              checked={includeIgnored}
              onCheckedChange={setIncludeIgnored}
            />
            <Label
              htmlFor="include-ignored"
              className="text-sm cursor-pointer"
            >
              הצג מתעלמים
            </Label>
          </div>
          <Input
            type="search"
            placeholder="חיפוש..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-[180px]"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">
                {data && data.length > 0
                  ? "לא נמצאו לקוחות שתואמים את החיפוש"
                  : "עדיין לא זוהו לקוחות מזדמנים"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-md">
                כאשר תועלה העלאת טאביט חדשה, עמודות שאינן ממופות ללקוח רשום
                יופיעו כאן אוטומטית.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">שם בטאביט</TableHead>
                    <TableHead className="text-right">שם בחשבשבת</TableHead>
                    <TableHead className="text-right">
                      הופיע לראשונה
                    </TableHead>
                    <TableHead className="text-center w-8"></TableHead>
                    <TableHead className="text-center w-44">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <EditableRow
                      key={row.id}
                      row={row}
                      onSave={handleSave}
                      onToggleIgnore={handleToggleIgnore}
                      onLink={(r) => setLinkTarget(r)}
                      onDelete={(r) => setDeleteTarget(r)}
                      isToggling={updateMutation.isPending}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LinkDialog
        open={linkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null);
        }}
        occasional={linkTarget}
        clients={clientsLite}
        onConfirm={handleLinkConfirm}
        isPending={linkMutation.isPending}
      />

      {deleteTarget && (
        <DeleteConfirmDialog
          key={deleteTarget.id}
          occasional={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
