"use client";

import { useState } from "react";
import {
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  franchiseeBillingOverwriteConflictSchema,
  franchiseeBillingUploadResponseSchema,
  type FranchiseeBillingOverwriteConflict,
  type FranchiseeBillingPeriod,
} from "@/schemas/franchisee-billing-screen";

interface FranchiseeBillingUploadProps {
  readonly onUploaded: (period: FranchiseeBillingPeriod) => Promise<void>;
}

/** "יולי 2026" — so the month the file was read as is visible before approval. */
function formatPeriod({ year, month }: FranchiseeBillingPeriod): string {
  return new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
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
 * The 409 body of an upload the server refused until the overwrite is decided.
 * Anything else is an ordinary failure and keeps its own message.
 */
function overwriteConflict(
  value: unknown,
): FranchiseeBillingOverwriteConflict | null {
  if (typeof value !== "object" || value === null || !("conflict" in value)) {
    return null;
  }
  const parsed = franchiseeBillingOverwriteConflictSchema.safeParse(
    value.conflict,
  );
  return parsed.success ? parsed.data : null;
}

function conflictQuestion(
  conflict: FranchiseeBillingOverwriteConflict,
): string {
  const { franchiseeNames, approvedNames } = conflict;
  const approved = approvedNames.length
    ? `, מתוכם ${approvedNames.length} מאושרים`
    : "";
  return `כבר קיימות שורות חיוב עבור ${franchiseeNames.length} זכיינים בחודש הזה${approved}. להחליף אותן בנתוני הקובץ החדש?`;
}

export function FranchiseeBillingUpload({
  onUploaded,
}: FranchiseeBillingUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflict, setConflict] =
    useState<FranchiseeBillingOverwriteConflict | null>(null);

  const upload = async (confirmOverwrite: boolean) => {
    if (!file) {
      setError("בחרי קובץ Excel להעלאה");
      return;
    }
    setIsUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      if (confirmOverwrite) formData.set("confirmOverwrite", "true");
      const response = await fetchWithTimeout(
        "/api/franchisee-billing/upload",
        {
          method: "POST",
          body: formData,
          timeout: 120_000,
        },
      );
      const responseBody: unknown = await response.json();
      if (!response.ok) {
        const pending = overwriteConflict(responseBody);
        if (pending) {
          setConflict(pending);
          return;
        }
        throw new Error(
          apiErrorMessage(responseBody) ??
            "הקובץ לא נקלט. בדקי אותו ונסי שוב.",
        );
      }
      setConflict(null);
      const parsed = franchiseeBillingUploadResponseSchema.safeParse(
        responseBody,
      );
      if (!parsed.success) {
        console.error("Invalid franchisee billing upload response:", {
          issues: parsed.error.issues,
        });
        throw new Error("הקובץ נקלט אך תשובת השרת אינה תקינה. רענני את העמוד.");
      }
      await onUploaded(parsed.data.data.period);
      setFile(null);
      setInputKey((current) => current + 1);
      const { period, hasBlockingIssues, draftsWritten } = parsed.data.data;
      const month = formatPeriod(period);
      setSuccess(
        hasBlockingIssues
          ? `הקובץ נקלט כחודש ${month}, אך יש בו שורות שממתינות להחלטה. טפלי בחסימות המופיעות מתחת לרשימת הקבצים.`
          // A file that wrote nothing used to report success all the same.
          : draftsWritten === 0
            ? `הקובץ נקלט כחודש ${month}, אך לא עודכנה אף שורת חיוב. בדקי שזהו החודש הנכון ושהסניפים שבקובץ מזוהים.`
            : `הקובץ נקלט כחודש ${month} ו-${draftsWritten} שורות עודכנו. ודאי שזו התקופה הנכונה לפני אישור.`,
      );
    } catch (uploadError: unknown) {
      console.error("Failed to upload franchisee billing file:", uploadError);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "אירעה שגיאת תקשורת בהעלאת הקובץ. נסי שוב.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="franchisee-billing-file">
            קובץ מחזור חודשי מטאבית
          </Label>
          <Input
            key={inputKey}
            id="franchisee-billing-file"
            type="file"
            accept=".xlsx,.xls"
            disabled={isUploading}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
              setSuccess(null);
            }}
            className="cursor-pointer file:me-3"
          />
        </div>
        <Button
          type="button"
          onClick={() => void upload(false)}
          disabled={!file || isUploading}
          className="xl:min-w-40"
        >
          {isUploading ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {isUploading ? "מעלה ומעבדת…" : "העלי ועבדי"}
        </Button>
      </div>
      {isUploading && (
        <div
          role="progressbar"
          aria-label="העלאת קובץ ועיבוד שורות החיוב"
          aria-valuetext="הקובץ עולה ומעובד"
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
      )}
      {file && !isUploading && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          <bdi>{file.name}</bdi>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="mt-3 text-sm font-medium text-emerald-700"
        >
          {success}
        </p>
      )}

      <AlertDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <AlertDialogContent dir="rtl" className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-amber-500"
                aria-hidden="true"
              />
              קיימות כבר שורות חיוב לחודש הזה
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{conflict ? conflictQuestion(conflict) : ""}</p>
                {conflict && conflict.franchiseeNames.length > 0 && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm">
                    {conflict.franchiseeNames.map((name) => (
                      <li key={name}>
                        <bdi>{name}</bdi>
                        {conflict.approvedNames.includes(name) && (
                          <span className="text-amber-600"> — מאושר</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {conflict && conflict.approvedNames.length > 0 && (
                  <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                    <AlertTriangle
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      החלפה תבטל את האישור של השורות המאושרות ותחזיר אותן
                      לטיוטה.
                    </span>
                  </p>
                )}
                {conflict && conflict.exportedNames.length > 0 && (
                  <p className="text-sm text-destructive">
                    שורות שכבר יוצאו לחשבשבת לא יוחלפו:{" "}
                    <bdi>{conflict.exportedNames.join(", ")}</bdi>
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <AlertDialogAction
              onClick={() => {
                setConflict(null);
                void upload(true);
              }}
            >
              החליפי את השורות
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
