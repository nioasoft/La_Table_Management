"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { RoyaltyTier, RoyaltyTierBasis } from "@/lib/royalty";
import {
  franchiseeRoyaltyPatchSchema,
  serializeFranchiseeRoyaltyPatch,
  type FranchiseeRoyaltyPatch,
} from "@/schemas/franchisee-royalty";

const DISPLAY_VAT_RATE = 0.18;
const numberFormatter = new Intl.NumberFormat("he-IL", {
  maximumFractionDigits: 2,
});

interface InitialRoyaltySettings {
  royaltyTiers: RoyaltyTier[] | null;
  royaltyTierBasis: RoyaltyTierBasis;
  royaltyTiersConfirmed: boolean;
  royaltyIncludeTips: boolean;
  hashavshevetAccountKey: string | null;
  marketingFeeRate: string | null;
}

interface FranchiseeRoyaltyTierEditorProps {
  franchiseeId: string;
  initialSettings: InitialRoyaltySettings;
  normalizationNotes: string | null;
  onSaved: (settings: FranchiseeRoyaltyPatch) => void;
}

interface DraftTier {
  upTo: string | null;
  rate: string;
}

interface RoyaltyDraft {
  tiers: DraftTier[];
  basis: RoyaltyTierBasis;
  confirmed: boolean;
  includeTips: boolean;
  accountKey: string;
  marketingRate: string;
}

function createDraft(settings: InitialRoyaltySettings): RoyaltyDraft {
  const tiers =
    settings.royaltyTiers && settings.royaltyTiers.length > 0
      ? settings.royaltyTiers.map((tier) => ({
          upTo: tier.upTo === null ? null : String(tier.upTo),
          rate: String(tier.rate),
        }))
      : [{ upTo: null, rate: "" }];

  return {
    tiers,
    basis: settings.royaltyTierBasis,
    confirmed: settings.royaltyTiersConfirmed,
    includeTips: settings.royaltyIncludeTips,
    accountKey: settings.hashavshevetAccountKey ?? "",
    marketingRate: settings.marketingFeeRate ?? "",
  };
}

function parseNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function toPatch(draft: RoyaltyDraft, confirmed: boolean): unknown {
  return {
    royaltyTiers: draft.tiers.map((tier) => ({
      upTo: tier.upTo === null ? null : parseNumber(tier.upTo),
      rate: parseNumber(tier.rate),
    })),
    royaltyTierBasis: draft.basis,
    royaltyTiersConfirmed: confirmed,
    royaltyIncludeTips: draft.includeTips,
    hashavshevetAccountKey:
      draft.accountKey.trim() === "" ? null : draft.accountKey.trim(),
    marketingFeeRate: parseNumber(draft.marketingRate),
  };
}

function thresholdHint(upTo: string, basis: RoyaltyTierBasis): string | null {
  const threshold = parseNumber(upTo);
  if (!Number.isFinite(threshold)) return null;

  const converted =
    basis === "net"
      ? threshold * (1 + DISPLAY_VAT_RATE)
      : threshold / (1 + DISPLAY_VAT_RATE);
  const sourceLabel = basis === "net" ? "ללא מע״מ" : "כולל מע״מ";
  const targetLabel = basis === "net" ? "כולל מע״מ" : "ללא מע״מ";

  return `עד ${numberFormatter.format(threshold)} ${sourceLabel} ≈ ${numberFormatter.format(converted)} ${targetLabel}`;
}

function apiErrorMessage(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return "השמירה נכשלה. יש לנסות שוב.";
}

export function FranchiseeRoyaltyTierEditor({
  franchiseeId,
  initialSettings,
  normalizationNotes,
  onSaved,
}: FranchiseeRoyaltyTierEditorProps) {
  const [draft, setDraft] = useState<RoyaltyDraft>(() =>
    createDraft(initialSettings),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const isEmpty = !initialSettings.royaltyTiers?.length;

  const updateTier = (
    index: number,
    field: keyof DraftTier,
    value: string | null,
  ) => {
    setDraft((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, [field]: value } : tier,
      ),
    }));
    setSuccessMessage(null);
  };

  const addTier = () => {
    setDraft((current) => ({
      ...current,
      tiers: [
        ...current.tiers.slice(0, -1),
        { upTo: "", rate: "" },
        current.tiers[current.tiers.length - 1],
      ],
    }));
    setSuccessMessage(null);
  };

  const removeTier = (index: number) => {
    setDraft((current) => ({
      ...current,
      tiers: current.tiers.filter((_, tierIndex) => tierIndex !== index),
    }));
    setSuccessMessage(null);
  };

  const save = async (confirmed: boolean) => {
    setError(null);
    setSuccessMessage(null);
    const validation = franchiseeRoyaltyPatchSchema.safeParse(
      toPatch(draft, confirmed),
    );
    if (!validation.success) {
      setError(
        validation.error.issues[0]?.message ??
          "נתוני התמלוגים אינם תקינים.",
      );
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetchWithTimeout(
        `/api/franchisees/${franchiseeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: serializeFranchiseeRoyaltyPatch(validation.data),
        },
      );
      const responseBody: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(responseBody));

      setDraft(
        createDraft({
          royaltyTiers: validation.data.royaltyTiers,
          royaltyTierBasis: validation.data.royaltyTierBasis,
          royaltyTiersConfirmed: validation.data.royaltyTiersConfirmed,
          royaltyIncludeTips: validation.data.royaltyIncludeTips,
          hashavshevetAccountKey:
            validation.data.hashavshevetAccountKey,
          marketingFeeRate:
            validation.data.marketingFeeRate.toString(),
        }),
      );
      onSaved(validation.data);
      const message = confirmed
        ? "סולם התמלוגים נשמר ואושר"
        : "הגדרות התמלוגים נשמרו";
      setSuccessMessage(message);
      toast.success(message);
    } catch (saveError: unknown) {
      console.error("Failed to save franchisee royalty settings:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "השמירה נכשלה. יש לנסות שוב.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-4">
      {!draft.confirmed && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>מדרגות טרם אושרו, חולצו מהאקסל של ינואר</AlertTitle>
          <AlertDescription className="space-y-3">
            {normalizationNotes && (
              <p className="whitespace-pre-wrap">
                <span className="font-medium">תיעוד הנרמול: </span>
                {normalizationNotes}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => save(true)}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="me-2 h-4 w-4" />
              )}
              אשר את הסולם
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isEmpty && (
        <Alert>
          <AlertTitle>עדיין לא הוגדר סולם תמלוגים</AlertTitle>
          <AlertDescription>
            הוסיפי את הרפים והאחוזים. המדרגה האחרונה ללא הגבלה כבר נוספה.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>הגדרות התמלוגים לא נשמרו</AlertTitle>
          <AlertDescription>{error} תקני את הנתונים ונסי שוב.</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{successMessage}</AlertTitle>
          <AlertDescription>
            הערכים המוצגים כעת הם הערכים שנשמרו לזכיין.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>מדרגות תמלוגים</CardTitle>
          <CardDescription>
            מזינים רק רף עליון ואחוז. תחילת כל מדרגה מחושבת אוטומטית,
            והמדרגה האחרונה תמיד ללא הגבלה.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="max-w-md space-y-2">
            <Label htmlFor="royalty-tier-basis">
              הרפים שהזנתי הם
            </Label>
            <Select
              dir="rtl"
              value={draft.basis}
              onValueChange={(value: RoyaltyTierBasis) =>
                setDraft((current) => ({ ...current, basis: value }))
              }
              disabled={isSaving}
            >
              <SelectTrigger id="royalty-tier-basis" dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="gross">כולל מע״מ</SelectItem>
                <SelectItem value="net">לפני מע״מ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>מ־</TableHead>
                  <TableHead>עד</TableHead>
                  <TableHead>אחוז</TableHead>
                  <TableHead>חיווי בבסיס השני</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">פעולות</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.tiers.map((tier, index) => {
                  const previousUpTo = draft.tiers[index - 1]?.upTo;
                  const isLast = index === draft.tiers.length - 1;
                  const hint =
                    tier.upTo === null
                      ? null
                      : thresholdHint(tier.upTo, draft.basis);

                  return (
                    <TableRow key={`${index}-${isLast ? "infinity" : "tier"}`}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {index === 0 ? (
                          "מ־0"
                        ) : (
                          <>
                            מעל{" "}
                            <bdi>
                              {previousUpTo
                                ? numberFormatter.format(
                                    parseNumber(previousUpTo),
                                  )
                                : "—"}
                            </bdi>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="min-w-44">
                        {isLast ? (
                          <span className="font-medium">עד ∞</span>
                        ) : (
                          <div className="space-y-1">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              dir="ltr"
                              inputMode="decimal"
                              aria-label={`רף עליון למדרגה ${index + 1}, כולל`}
                              value={tier.upTo ?? ""}
                              onChange={(event) =>
                                updateTier(index, "upTo", event.target.value)
                              }
                              disabled={isSaving}
                            />
                            <span className="text-xs text-muted-foreground">
                              (כולל)
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-32">
                        <div className="relative">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            dir="ltr"
                            inputMode="decimal"
                            aria-label={`אחוז תמלוגים למדרגה ${index + 1}`}
                            value={tier.rate}
                            onChange={(event) =>
                              updateTier(index, "rate", event.target.value)
                            }
                            disabled={isSaving}
                            className="pe-8"
                          />
                          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            %
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-72 text-sm text-muted-foreground">
                        {hint ? (
                          <bdi>{hint}</bdi>
                        ) : (
                          "המדרגה חלה על כל מחזור שמעל הרף הקודם"
                        )}
                      </TableCell>
                      <TableCell>
                        {!isLast && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`מחק מדרגה ${index + 1}`}
                            onClick={() => removeTier(index)}
                            disabled={isSaving}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={addTier}
            disabled={isSaving}
          >
            <Plus className="me-2 h-4 w-4" />
            הוספת מדרגה
          </Button>

          <div className="grid gap-5 border-t pt-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hashavshevet-account-key">
                מפתח חשבון בחשבשבת
              </Label>
              <Input
                id="hashavshevet-account-key"
                value={draft.accountKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    accountKey: event.target.value,
                  }))
                }
                disabled={isSaving}
                dir="auto"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="marketing-fee-rate">אחוז שיווק</Label>
              <Input
                id="marketing-fee-rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={draft.marketingRate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    marketingRate: event.target.value,
                  }))
                }
                disabled={isSaving}
                dir="ltr"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border p-4">
            <Switch
              id="royalty-include-tips"
              checked={draft.includeTips}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  includeTips: checked,
                }))
              }
              disabled={isSaving}
            />
            <Label htmlFor="royalty-include-tips">מחויב כולל טיפים</Label>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => save(draft.confirmed)}
              disabled={isSaving}
            >
              {isSaving && (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              )}
              שמירת הגדרות תמלוגים
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
