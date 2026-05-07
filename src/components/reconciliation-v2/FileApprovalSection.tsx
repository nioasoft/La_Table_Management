"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileRejectionDialog } from "./FileRejectionDialog";
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
import { Check, X, RefreshCcw, Loader2 } from "lucide-react";
import type { ReconciliationSessionWithDetails } from "@/types/reconciliation-v2";

interface FileApprovalSectionProps {
  session: ReconciliationSessionWithDetails;
  onApprove: () => void;
  onReject: (reason: string, sendEmail: boolean) => void;
  onBackToProcessing?: () => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isReprocessing?: boolean;
  canApprove?: boolean;
}

export function FileApprovalSection({
  session,
  onApprove,
  onReject,
  onBackToProcessing,
  isApproving,
  isRejecting,
  isReprocessing,
  canApprove = true,
}: FileApprovalSectionProps) {
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isBackDialogOpen, setIsBackDialogOpen] = useState(false);

  const isTerminal =
    session.status === "file_approved" || session.status === "file_rejected";

  if (isTerminal) {
    return (
      <div className="flex items-center gap-2 text-sm">
        {session.status === "file_approved" && (
          <span className="text-green-600 flex items-center gap-1">
            <Check className="h-4 w-4" />
            קובץ אושר
          </span>
        )}
        {session.status === "file_rejected" && (
          <span className="text-red-600 flex items-center gap-1">
            <X className="h-4 w-4" />
            קובץ נדחה: {session.fileRejectionReason}
          </span>
        )}
      </div>
    );
  }

  const showBackToProcessing = !!onBackToProcessing && !session.archivedAt;
  const anyActionInFlight = isApproving || isRejecting || isReprocessing;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onApprove}
          disabled={!canApprove || anyActionInFlight}
          className="bg-green-600 hover:bg-green-700"
        >
          <Check className="h-4 w-4 me-2" />
          {isApproving ? "מאשר..." : "אשר קובץ"}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setIsRejectDialogOpen(true)}
          disabled={anyActionInFlight}
        >
          <X className="h-4 w-4 me-2" />
          {isRejecting ? "דוחה..." : "דחה קובץ"}
        </Button>
        {showBackToProcessing && (
          <Button
            variant="outline"
            onClick={() => setIsBackDialogOpen(true)}
            disabled={anyActionInFlight}
          >
            {isReprocessing ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4 me-2" />
            )}
            {isReprocessing ? "מעבד..." : "חזור לעיבוד"}
          </Button>
        )}
      </div>

      <FileRejectionDialog
        open={isRejectDialogOpen}
        onOpenChange={setIsRejectDialogOpen}
        onReject={onReject}
        supplierName={session.supplierName}
        isLoading={isRejecting}
      />

      <AlertDialog
        open={isBackDialogOpen}
        onOpenChange={setIsBackDialogOpen}
      >
        <AlertDialogContent className="max-w-md" dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-right">
              <RefreshCcw className="h-5 w-5 text-primary" />
              חזרה לעיבוד הקובץ
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right">
                <p>
                  פעולה זו תארכב את ההשוואה הנוכחית ותריץ עיבוד מחדש של הקובץ של{" "}
                  {session.supplierName}.
                </p>
                <p>
                  ההתאמות הידניות של זכיינים ואישורי האנומליות שכבר אישרת יישמרו.
                </p>
                <p className="text-muted-foreground text-sm">
                  לאחר העיבוד תועבר/י למסך הקובץ לבדיקה. השוואה זו תוצג כהיסטוריה בלבד.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <AlertDialogAction
              onClick={() => {
                setIsBackDialogOpen(false);
                onBackToProcessing?.();
              }}
              className="bg-primary"
            >
              חזור לעיבוד
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
