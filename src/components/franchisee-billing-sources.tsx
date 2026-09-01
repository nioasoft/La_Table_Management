"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type SourceFile = FranchiseeBillingScreenPayload["sourceFiles"][number];

interface FranchiseeBillingSourcesProps {
  readonly sourceFiles: readonly SourceFile[];
  readonly onChanged: () => Promise<unknown>;
}

function apiErrorMessage(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return null;
}

/**
 * Replays a workbook already stored, so a scale approved after the upload is
 * picked up without asking Tabit for the file again.
 */
async function reprocessSourceFile(sourceFileId: string): Promise<void> {
  const response = await fetchWithTimeout(
    "/api/franchisee-billing/reprocess",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceFileId }),
      timeout: 60_000,
    },
  );
  const responseBody: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(responseBody) ?? "עיבוד הקובץ מחדש נכשל. נסי שוב.",
    );
  }
}

/** Cancels one upload: its draft rows go and it stops blocking the month. */
async function discardSourceFile(sourceFileId: string): Promise<void> {
  const response = await fetchWithTimeout("/api/franchisee-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "discard_source", sourceFileId }),
  });
  const responseBody: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(responseBody) ?? "ביטול הקובץ נכשל. נסי שוב.",
    );
  }
}

/**
 * The month's source files, each with the two ways out of a bad upload: replay
 * it against the current settings, or cancel it and upload a corrected one.
 */
export function FranchiseeBillingSources({
  sourceFiles,
  onChanged,
}: FranchiseeBillingSourcesProps) {
  const [pendingDiscard, setPendingDiscard] = useState<SourceFile | null>(null);
  const reprocess = useMutation({
    mutationFn: reprocessSourceFile,
    onSuccess: () => onChanged(),
  });
  const discard = useMutation({
    mutationFn: discardSourceFile,
    onSuccess: async () => {
      setPendingDiscard(null);
      await onChanged();
    },
  });
  const busy = reprocess.isPending || discard.isPending;
  const error = reprocess.error ?? discard.error;

  return (
    <>
      <p className="text-muted-foreground">
        {sourceFiles.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-1 gap-y-2">
            קבצי מקור לחודש:
            {sourceFiles.map((source) => (
              <span
                key={source.id}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
              >
                <bdi>{source.fileName}</bdi>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  title="מריץ את הקובץ השמור מחדש מול ההגדרות העדכניות"
                  disabled={busy}
                  onClick={() => reprocess.mutate(source.id)}
                >
                  {reprocess.isPending && reprocess.variables === source.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  )}
                  עבדי מחדש
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs text-destructive hover:text-destructive"
                  title="מבטל את הקובץ ואת שורות הטיוטה שנוצרו ממנו, כדי להעלות קובץ מתוקן"
                  disabled={busy}
                  onClick={() => setPendingDiscard(source)}
                >
                  {discard.isPending && discard.variables === source.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  )}
                  בטלי קובץ
                </Button>
              </span>
            ))}
          </span>
        ) : (
          "אין קובץ מקור לחודש שנבחר"
        )}
      </p>

      {error && (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : "הפעולה נכשלה. נסי שוב."}
        </p>
      )}

      <AlertDialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscard(null);
        }}
      >
        <AlertDialogContent dir="rtl" className="max-w-md text-right">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">
              לבטל את הקובץ?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              <bdi>{pendingDiscard?.fileName}</bdi> יסומן כמבוטל, ושורות הטיוטה
              שנוצרו ממנו יימחקו — כדי שתוכלי להעלות קובץ מתוקן במקומו. שורות
              שכבר אושרו לא ייפגעו, ואם קיימות כאלה הביטול ייחסם.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discard.isPending}>
              חזרה
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={discard.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDiscard) discard.mutate(pendingDiscard.id);
              }}
            >
              {discard.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              בטלי קובץ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
