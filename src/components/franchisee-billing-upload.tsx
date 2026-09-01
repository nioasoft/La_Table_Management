"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  franchiseeBillingUploadResponseSchema,
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

export function FranchiseeBillingUpload({
  onUploaded,
}: FranchiseeBillingUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const upload = async () => {
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
        throw new Error(
          apiErrorMessage(responseBody) ??
            "הקובץ לא נקלט. בדקי אותו ונסי שוב.",
        );
      }
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
      const { period, hasBlockingIssues } = parsed.data.data;
      setSuccess(
        hasBlockingIssues
          ? `הקובץ נקלט כחודש ${formatPeriod(period)}, אך יש בו שורות שממתינות להחלטה. טפלי בחסימות המופיעות מתחת לרשימת הקבצים.`
          : `הקובץ נקלט כחודש ${formatPeriod(period)} ושורות הטיוטה עודכנו. ודאי שזו התקופה הנכונה לפני אישור.`,
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
          onClick={() => void upload()}
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
    </div>
  );
}
