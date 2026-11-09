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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface NoteDialogProps {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Whether the written text is enough to confirm (the button stays disabled until it is). */
  isValid: (text: string) => boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

/** A confirmation that needs a written reason: rejecting a send, or opening a locked row. Mount it only while open. */
export function NoteDialog({ title, description, label, placeholder, confirmLabel, cancelLabel, isValid, onConfirm, onClose }: NoteDialogProps) {
  const [text, setText] = useState("");
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="hashavshevet-note">{label}</Label>
          <Textarea id="hashavshevet-note" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={3} />
        </div>
        <AlertDialogFooter>
          <AlertDialogAction disabled={!isValid(text)} onClick={() => onConfirm(text.trim())}>
            {confirmLabel}
          </AlertDialogAction>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
