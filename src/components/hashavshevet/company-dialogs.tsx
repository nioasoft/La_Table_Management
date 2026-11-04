"use client";

import { useState } from "react";

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
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { settingsCopy } from "@/lib/hashavshevet/copy";
import { todayLocalYmd } from "@/app/(protected)/admin/hashavshevet/page-state";

interface DialogProps {
  companyName: string;
  onClose: () => void;
}

/** "הפעל שליחה": the date defaults to today (local) and is the first day whose exports are sent. Mount only while open. */
export function ActivateDialog({ companyName, onClose, onConfirm }: DialogProps & { onConfirm: (liveFrom: string) => void }) {
  const [date, setDate] = useState(() => todayLocalYmd());
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{settingsCopy.activateTitle(companyName)}</AlertDialogTitle>
          <AlertDialogDescription>{settingsCopy.activateDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="hashavshevet-live-from">{settingsCopy.activateDateLabel}</Label>
          <DateInput id="hashavshevet-live-from" value={date} onChange={setDate} />
        </div>
        <AlertDialogFooter>
          <AlertDialogAction disabled={!date} onClick={() => onConfirm(date)}>
            {settingsCopy.activateConfirm}
          </AlertDialogAction>
          <AlertDialogCancel>{settingsCopy.cancel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "כבה": liveFrom back to null, behind a confirmation. Mount only while open. */
export function DeactivateDialog({ companyName, onClose, onConfirm }: DialogProps & { onConfirm: () => void }) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{settingsCopy.deactivateTitle(companyName)}</AlertDialogTitle>
          <AlertDialogDescription>{settingsCopy.deactivateDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onConfirm}>{settingsCopy.deactivateConfirm}</AlertDialogAction>
          <AlertDialogCancel>{settingsCopy.cancel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
