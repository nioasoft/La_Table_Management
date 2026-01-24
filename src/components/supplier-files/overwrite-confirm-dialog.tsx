"use client";

import * as React from "react";
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
import { Badge } from "@/components/ui/badge";
import { FileText, Calendar, Check, Clock, AlertTriangle } from "lucide-react";
import type { PeriodWithStatus } from "./period-selector";

interface OverwriteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: PeriodWithStatus | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Helper to get status label in Hebrew
function getStatusLabel(status: string): string {
  switch (status) {
    case "approved":
    case "auto_approved":
      return "אושר";
    case "needs_review":
      return "ממתין לבדיקה";
    case "rejected":
      return "נדחה";
    default:
      return status;
  }
}

// Helper to format date
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OverwriteConfirmDialog({
  open,
  onOpenChange,
  period,
  onConfirm,
  onCancel,
}: OverwriteConfirmDialogProps) {
  if (!period?.existingFile) return null;

  const existingFile = period.existingFile;
  const isApproved = existingFile.status === "approved" || existingFile.status === "auto_approved";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            קיים קובץ לתקופה זו
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-right">
              <p>
                כבר קיים קובץ עבור {period.nameHe}. האם ברצונך להחליף אותו?
              </p>

              {/* Existing File Info Card */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{existingFile.fileName}</span>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>הועלה: {formatDate(existingFile.uploadedAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">סטטוס:</span>
                  {isApproved ? (
                    <Badge variant="success" className="gap-1">
                      <Check className="h-3 w-3" />
                      {getStatusLabel(existingFile.status)}
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1">
                      <Clock className="h-3 w-3" />
                      {getStatusLabel(existingFile.status)}
                    </Badge>
                  )}
                </div>
              </div>

              {isApproved && (
                <p className="text-amber-600 dark:text-amber-500 text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>שים לב: הקובץ הקיים כבר אושר. החלפתו תבטל את האישור.</span>
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <AlertDialogAction onClick={onConfirm} className="bg-primary">
            החלף קובץ
          </AlertDialogAction>
          <AlertDialogCancel onClick={onCancel}>
            ביטול
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
