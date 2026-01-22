"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  Calendar,
  Bell,
  Loader2,
  ChevronDown,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import type { FranchiseeImportantDate, ImportantDateType, DurationUnit } from "@/db/schema";
import {
  DATE_TYPE_LABELS,
  DURATION_UNIT_LABELS,
  getReminderUrgency,
  calculateEndDate,
  calculateReminderDate,
} from "@/lib/important-dates-utils";

interface ImportantDatesManagerProps {
  franchiseeId: string;
  disabled?: boolean;
}

interface ImportantDateFormData {
  dateType: ImportantDateType;
  customTypeName: string;
  startDate: string;
  durationValue: number;
  displayUnit: DurationUnit;
  reminderMonthsBefore: number;
  description: string;
  notes: string;
}

const defaultFormData: ImportantDateFormData = {
  dateType: "franchise_agreement",
  customTypeName: "",
  startDate: "",
  durationValue: 12,
  displayUnit: "months",
  reminderMonthsBefore: 3,
  description: "",
  notes: "",
};

export function ImportantDatesManager({
  franchiseeId,
  disabled = false,
}: ImportantDatesManagerProps) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<FranchiseeImportantDate | null>(null);
  const [formData, setFormData] = useState<ImportantDateFormData>(defaultFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Fetch important dates for this franchisee
  const { data: importantDates = [], isLoading } = useQuery({
    queryKey: ["franchisee-important-dates", franchiseeId],
    queryFn: async () => {
      const response = await fetch(`/api/franchisees/${franchiseeId}/important-dates`);
      if (!response.ok) throw new Error("Failed to fetch important dates");
      const data = await response.json();
      return data.importantDates as FranchiseeImportantDate[];
    },
    enabled: !!franchiseeId,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: ImportantDateFormData) => {
      const durationMonths = data.displayUnit === "years"
        ? data.durationValue * 12
        : data.durationValue;

      const response = await fetch(`/api/franchisees/${franchiseeId}/important-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateType: data.dateType,
          customTypeName: data.dateType === "custom" ? data.customTypeName : undefined,
          startDate: data.startDate,
          durationMonths,
          displayUnit: data.displayUnit,
          reminderMonthsBefore: data.reminderMonthsBefore,
          description: data.description || undefined,
          notes: data.notes || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create important date");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-important-dates", franchiseeId] });
      queryClient.invalidateQueries({ queryKey: ["reminder-counts"] });
      setIsDialogOpen(false);
      setFormData(defaultFormData);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ImportantDateFormData }) => {
      const durationMonths = data.displayUnit === "years"
        ? data.durationValue * 12
        : data.durationValue;

      const response = await fetch(`/api/franchisees/${franchiseeId}/important-dates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateType: data.dateType,
          customTypeName: data.dateType === "custom" ? data.customTypeName : undefined,
          startDate: data.startDate,
          durationMonths,
          displayUnit: data.displayUnit,
          reminderMonthsBefore: data.reminderMonthsBefore,
          description: data.description || undefined,
          notes: data.notes || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update important date");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-important-dates", franchiseeId] });
      queryClient.invalidateQueries({ queryKey: ["reminder-counts"] });
      setIsDialogOpen(false);
      setEditingDate(null);
      setFormData(defaultFormData);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/franchisees/${franchiseeId}/important-dates/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete important date");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-important-dates", franchiseeId] });
      queryClient.invalidateQueries({ queryKey: ["reminder-counts"] });
      setDeleteConfirm(null);
    },
  });

  // Copy mutation
  const copyMutation = useMutation({
    mutationFn: async ({ sourceId, targetType, customTypeName }: { sourceId: string; targetType: ImportantDateType; customTypeName?: string }) => {
      const response = await fetch(`/api/franchisees/${franchiseeId}/important-dates/${sourceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, customTypeName }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to copy important date");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-important-dates", franchiseeId] });
      queryClient.invalidateQueries({ queryKey: ["reminder-counts"] });
    },
  });

  const handleAdd = () => {
    setEditingDate(null);
    setFormData(defaultFormData);
    setIsDialogOpen(true);
  };

  const handleEdit = (date: FranchiseeImportantDate) => {
    setEditingDate(date);

    // Convert durationMonths back to display value based on unit
    const durationValue = date.displayUnit === "years"
      ? date.durationMonths / 12
      : date.durationMonths;

    setFormData({
      dateType: date.dateType,
      customTypeName: date.customTypeName || "",
      startDate: date.startDate,
      durationValue,
      displayUnit: date.displayUnit,
      reminderMonthsBefore: date.reminderMonthsBefore,
      description: date.description || "",
      notes: date.notes || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (editingDate) {
      await updateMutation.mutateAsync({ id: editingDate.id, data: formData });
    } else {
      await createMutation.mutateAsync(formData);
    }
  };

  const handleCopy = (sourceId: string, targetType: ImportantDateType) => {
    if (targetType === "custom") {
      const customName = prompt("הזן שם לסוג המותאם אישית:");
      if (!customName) return;
      copyMutation.mutate({ sourceId, targetType, customTypeName: customName });
    } else {
      copyMutation.mutate({ sourceId, targetType });
    }
  };

  // Calculate preview dates
  const previewEndDate = formData.startDate && formData.durationValue > 0
    ? calculateEndDate(
        formData.startDate,
        formData.displayUnit === "years" ? formData.durationValue * 12 : formData.durationValue
      )
    : null;

  const previewReminderDate = previewEndDate
    ? calculateReminderDate(previewEndDate, formData.reminderMonthsBefore)
    : null;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("he-IL");
  };

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case "expired":
        return <Badge variant="destructive" className="mr-2"><AlertCircle className="h-3 w-3 ml-1" />פג תוקף</Badge>;
      case "urgent":
        return <Badge variant="destructive" className="mr-2"><AlertTriangle className="h-3 w-3 ml-1" />דורש טיפול</Badge>;
      case "warning":
        return <Badge variant="outline" className="mr-2 border-amber-500 text-amber-600"><Bell className="h-3 w-3 ml-1" />מתקרב</Badge>;
      default:
        return null;
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="h-4 w-4" />
          <span>תאריכים חשובים</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={disabled || !franchiseeId}
        >
          <Plus className="h-4 w-4 ml-1" />
          הוסף תאריך
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : importantDates.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
          לא נמצאו תאריכים חשובים
        </div>
      ) : (
        <div className="space-y-3">
          {importantDates.map((date) => {
            const urgency = getReminderUrgency(date.endDate, date.reminderDate);
            const displayDuration = date.displayUnit === "years"
              ? `${date.durationMonths / 12} ${DURATION_UNIT_LABELS.years}`
              : `${date.durationMonths} ${DURATION_UNIT_LABELS.months}`;

            return (
              <div
                key={date.id}
                className="border rounded-lg p-3 space-y-2 bg-card"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {date.dateType === "custom" && date.customTypeName
                        ? date.customTypeName
                        : DATE_TYPE_LABELS[date.dateType]}
                    </span>
                    {getUrgencyBadge(urgency)}
                  </div>
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" disabled={disabled}>
                          <Copy className="h-4 w-4" />
                          <ChevronDown className="h-3 w-3 mr-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {(Object.keys(DATE_TYPE_LABELS) as ImportantDateType[])
                          .filter(type => type !== date.dateType)
                          .map(type => (
                            <DropdownMenuItem
                              key={type}
                              onClick={() => handleCopy(date.id, type)}
                            >
                              העתק ל{DATE_TYPE_LABELS[type]}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(date)}
                      disabled={disabled}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirm(date.id)}
                      disabled={disabled}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
                  <div>
                    <span className="text-xs">התחלה:</span>{" "}
                    <span className="text-foreground">{formatDate(date.startDate)}</span>
                  </div>
                  <div>
                    <span className="text-xs">משך:</span>{" "}
                    <span className="text-foreground">{displayDuration}</span>
                  </div>
                  <div>
                    <span className="text-xs">סיום:</span>{" "}
                    <span className="text-foreground">{formatDate(date.endDate)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Bell className="h-3 w-3" />
                  <span>
                    תזכורת {date.reminderMonthsBefore} חודשים לפני ({formatDate(date.reminderDate)})
                  </span>
                </div>
                {date.description && (
                  <div className="text-sm text-muted-foreground">
                    {date.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingDate ? "עריכת תאריך חשוב" : "הוספת תאריך חשוב"}
            </DialogTitle>
            <DialogDescription>
              הזן את פרטי התאריך החשוב. תאריך הסיום והתזכורת יחושבו אוטומטית.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Date Type */}
            <div className="space-y-2">
              <Label>סוג תאריך</Label>
              <Select
                value={formData.dateType}
                onValueChange={(value) => setFormData({ ...formData, dateType: value as ImportantDateType })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="בחר סוג תאריך" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DATE_TYPE_LABELS) as ImportantDateType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {DATE_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom Type Name (only for custom) */}
            {formData.dateType === "custom" && (
              <div className="space-y-2">
                <Label>שם הסוג המותאם</Label>
                <Input
                  value={formData.customTypeName}
                  onChange={(e) => setFormData({ ...formData, customTypeName: e.target.value })}
                  placeholder="הזן שם לסוג המותאם"
                  dir="rtl"
                />
              </div>
            )}

            {/* Start Date */}
            <div className="space-y-2">
              <Label>תאריך התחלה</Label>
              <Input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              />
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <Label>משך</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  value={formData.durationValue}
                  onChange={(e) => setFormData({ ...formData, durationValue: parseInt(e.target.value) || 1 })}
                  className="flex-1"
                />
                <Select
                  value={formData.displayUnit}
                  onValueChange={(value) => setFormData({ ...formData, displayUnit: value as DurationUnit })}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="months">{DURATION_UNIT_LABELS.months}</SelectItem>
                    <SelectItem value="years">{DURATION_UNIT_LABELS.years}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Calculated End Date */}
            {previewEndDate && (
              <div className="text-sm bg-muted/50 p-2 rounded">
                <span className="text-muted-foreground">תאריך סיום מחושב: </span>
                <span className="font-medium">{formatDate(previewEndDate)}</span>
              </div>
            )}

            {/* Reminder */}
            <div className="space-y-2">
              <Label>תזכורת לפני (חודשים)</Label>
              <Input
                type="number"
                min="1"
                max="24"
                value={formData.reminderMonthsBefore}
                onChange={(e) => setFormData({ ...formData, reminderMonthsBefore: parseInt(e.target.value) || 3 })}
              />
            </div>

            {/* Calculated Reminder Date */}
            {previewReminderDate && (
              <div className="text-sm bg-muted/50 p-2 rounded">
                <span className="text-muted-foreground">תאריך תזכורת: </span>
                <span className="font-medium">{formatDate(previewReminderDate)}</span>
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label>הערות</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="הערות נוספות (אופציונלי)"
                dir="rtl"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !formData.startDate || formData.durationValue < 1 || (formData.dateType === "custom" && !formData.customTypeName)}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  שומר...
                </>
              ) : editingDate ? (
                "עדכן"
              ) : (
                "הוסף"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>מחיקת תאריך חשוב</DialogTitle>
            <DialogDescription>
              האם אתה בטוח שברצונך למחוק תאריך חשוב זה? פעולה זו לא ניתנת לביטול.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleteMutation.isPending}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  מוחק...
                </>
              ) : (
                "מחק"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
