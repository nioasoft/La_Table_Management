"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileRejectionDialog } from "./FileRejectionDialog";
import { Check, X } from "lucide-react";
import type { ReconciliationSessionWithDetails } from "@/types/reconciliation-v2";

interface FileApprovalSectionProps {
  session: ReconciliationSessionWithDetails;
  onApprove: () => void;
  onReject: (reason: string, sendEmail: boolean) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  canApprove?: boolean;
}

export function FileApprovalSection({
  session,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
  canApprove = true,
}: FileApprovalSectionProps) {
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);

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

  return (
    <>
      <div className="flex items-center gap-4">
        <Button
          onClick={onApprove}
          disabled={!canApprove || isApproving || isRejecting}
          className="bg-green-600 hover:bg-green-700"
        >
          <Check className="h-4 w-4 me-2" />
          {isApproving ? "מאשר..." : "אשר קובץ"}
        </Button>
        <Button
          variant="destructive"
          onClick={() => setIsRejectDialogOpen(true)}
          disabled={isApproving || isRejecting}
        >
          <X className="h-4 w-4 me-2" />
          {isRejecting ? "דוחה..." : "דחה קובץ"}
        </Button>
      </div>

      <FileRejectionDialog
        open={isRejectDialogOpen}
        onOpenChange={setIsRejectDialogOpen}
        onReject={onReject}
        supplierName={session.supplierName}
        isLoading={isRejecting}
      />
    </>
  );
}
