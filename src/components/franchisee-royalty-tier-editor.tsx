"use client";

import { useEffect, useState } from "react";
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

const DEFAULT_DISPLAY_VAT_RATE = 0.18;
const numberFormatter = new Intl.NumberFormat("he-IL", {
  maximumFractionDigits: 2,
});

interface InitialRoyaltySettings {
  royaltyTiers: RoyaltyTier[] | null;
  royaltyTierBasis: RoyaltyTierBasis;
  royaltyTiersConfirmed: boolean;
  royaltyIncludeTips: boolean;
  tipsAbsenceAcknowledged?: boolean;
  hashavshevetAccountKey: string | null;
  marketingFeeRate: string | null;
}

interface FranchiseeRoyaltyTierEditorProps {
  franchiseeId: string;
  initialSettings: InitialRoyaltySettings;
  normalizationNotes: string | null;
  onSaved: (settings: FranchiseeRoyaltyPatch) => void;
  vatRate?: number;
}

interface DraftTier {
  upTo: string | null;
  rate: string;
  marginal: boolean;
}

interface RoyaltyDraft {
  tiers: DraftTier[];
  basis: RoyaltyTierBasis;
  confirmed: boolean;
  includeTips: boolean;
  tipsAbsent: boolean;
  accountKey: string;
  marketingRate: string;
}

export function createDraft(settings: InitialRoyaltySettings): RoyaltyDraft {
  const tiers =
    settings.royaltyTiers && settings.royaltyTiers.length > 0
      ? settings.royaltyTiers.map((tier) => ({
          upTo: tier.upTo === null ? null : String(tier.upTo),
          rate: String(tier.rate),
          marginal: tier.marginal === true,
        }))
      : [{ upTo: null, rate: "", marginal: false }];

  return {
    tiers,
    basis: settings.royaltyTierBasis,
    confirmed: settings.royaltyTiersConfirmed,
    includeTips: settings.royaltyIncludeTips,
    tipsAbsent: settings.tipsAbsenceAcknowledged === true,
    accountKey: settings.hashavshevetAccountKey ?? "",
    marketingRate: settings.marketingFeeRate ?? "",
  };
}

function parseNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

export function createFranchiseeRoyaltyPatch(
  draft: RoyaltyDraft,
  confirmed: boolean,
): unknown {
  return {
    royaltyTiers: draft.tiers.map((tier) => ({
      upTo: tier.upTo === null ? null : parseNumber(tier.upTo),
      rate: parseNumber(tier.rate),
      // Emit the key only when set, so legacy flat scales round-trip unchanged.
      ...(tier.marginal ? { marginal: true } : {}),
    })),
    royaltyTierBasis: draft.basis,
    royaltyTiersConfirmed: confirmed,
    royaltyIncludeTips: draft.includeTips,
    tipsAbsenceAcknowledged: draft.tipsAbsent,
    hashavshevetAccountKey:
      draft.accountKey.trim() === "" ? null : draft.accountKey.trim(),
    marketingFeeRate: parseNumber(draft.marketingRate),
  };
}

export function thresholdHint(
  upTo: string,
  basis: RoyaltyTierBasis,
  vatRate: number = DEFAULT_DISPLAY_VAT_RATE,
): string | null {
  const threshold = parseNumber(upTo);
  if (!Number.isFinite(threshold)) return null;

  const converted =
    basis === "net"
      ? threshold * (1 + vatRate)
      : threshold / (1 + vatRate);
  const sourceLabel = basis === "net" ? "ללא מע״מ" : "כולל מע״מ";
  const targetLabel = basis === "net" ? "כולל מע״מ" : "ללא מע״מ";

  return `עד ${numberFormatter.format(threshold)} ${sourceLabel} ≈ ${numberFormatter.format(converted)} ${targetLabel}`;
}

export function responseSaveErrorMessage(status: number): string {
  if (status === 400 || status === 422) {
    return "הנתונים שהוזנו אינם תקינים. בדקי את השדות ונסי שוב.";
  }
  if (status >= 500) {
    return "אירעה תקלה בשרת והשינויים לא נשמרו. נסי שוב בעוד כמה רגעים.";
  }
  return "לא ניתן לשמור את השינויים. רענני את העמוד ונסי שוב.";
}

export function networkSaveErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "השרת לא הגיב בזמן והשינויים לא נשמרו. נסי שוב.";
  }
  return "אירעה שגיאת תקשורת והשינויים לא נשמרו. בדקי את החיבור ונסי שוב.";
}

function readVatRate(value: unknown): number | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("rate" in value) ||
    typeof value.rate !== "number" ||
    !Number.isFinite(value.rate) ||
    value.rate < 0 ||
    value.rate > 1
  ) {
    return null;
  }
  return value.rate;
}

export function FranchiseeRoyaltyTierEditor({
  franchiseeId,
  initialSettings,
  normalizationNotes,
  onSaved,
  vatRate,
}: FranchiseeRoyaltyTierEditorProps) {
  const [draft, setDraft] = useState<RoyaltyDraft>(() =>
    createDraft(initialSettings),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [serverVatRate, setServerVatRate] = useState(
    DEFAULT_DISPLAY_VAT_RATE,
  );
  const displayVatRate = vatRate ?? serverVatRate;
  const isEmpty = !initialSettings.royaltyTiers?.length;

  useEffect(() => {
    if (vatRate !== undefined) return;

    let isCurrent = true;
    const loadVatRate = async () => {
      try {
        const response = await fetchWithTimeout("/api/vat-rates/current");
        if (!response.ok) {
          console.error("Failed to load VAT rate for royalty tier hints:", {
            status: response.status,
          });
          return;
        }
        const responseBody: unknown = await response.json();
        const currentVatRate = readVatRate(responseBody);
        if (isCurrent && currentVatRate !== null) {
          setServerVatRate(currentVatRate);
        }
      } catch (vatRateError: unknown) {
        console.error(
          "Failed to load VAT rate for royalty tier hints:",
          vatRateError,
        );
      }
    };

    void loadVatRate();
    return () => {
      isCurrent = false;
    };
  }, [vatRate]);

  const updateDraft = (updater: (current: RoyaltyDraft) => RoyaltyDraft) => {
    setDraft(updater);
    setSuccessMessage(null);
  };

  const updateTier = (
    index: number,
    field: keyof DraftTier,
    value: string | boolean | null,
  ) => {
    updateDraft((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, [field]: value } : tier,
      ),
    }));
  };

  const addTier = () => {
    updateDraft((current) => {
      const finalTier = current.tiers[current.tiers.length - 1];
      const tiers =
        finalTier?.upTo === null
          ? [
              ...current.tiers.slice(0, -1),
              { upTo: "", rate: "", marginal: false },
              finalTier,
            ]
          : [...current.tiers, { upTo: null, rate: "", marginal: false }];

      return { ...current, tiers };
    });
  };

  const removeTier = (index: number) => {
    updateDraft((current) => ({
      ...current,
      tiers: current.tiers.filter((_, tierIndex) => tierIndex !== index),
    }));
  };

  const save = async (confirmed: boolean) => {
    setError(null);
    setSuccessMessage(null);
    const validation = franchiseeRoyaltyPatchSchema.safeParse(
      createFranchiseeRoyaltyPatch(draft, confirmed),
    );
    if (!validation.success) {
      setError(
        validation.error.issues[0]?.message ??
          "נתוני התמלוגים אינם תקינים.",
      );
      return;
    }

    setIsSaving(true);
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `/api/franchisees/${franchiseeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: serializeFranchiseeRoyaltyPatch(validation.data),
        },
      );
    } catch (saveError: unknown) {
      console.error("Failed to save franchisee royalty settings:", saveError);
      setIsSaving(false);
      setError(networkSaveErrorMessage(saveError));
      return;
    }

    if (!response.ok) {
      const responseBody: unknown = await response.json().catch(() => null);
      console.error("Franchisee royalty save request failed:", {
        status: response.status,
        responseBody,
      });
      setIsSaving(false);
      setError(responseSaveErrorMessage(response.status));
      return;
    }

    setDraft(
      createDraft({
        royaltyTiers: validation.data.royaltyTiers,
        royaltyTierBasis: validation.data.royaltyTierBasis,
        royaltyTiersConfirmed: validation.data.royaltyTiersConfirmed,
        royaltyIncludeTips: validation.data.royaltyIncludeTips,
        tipsAbsenceAcknowledged: validation.data.tipsAbsenceAcknowledged,
        hashavshevetAccountKey: validation.data.hashavshevetAccountKey,
        marketingFeeRate: validation.data.marketingFeeRate.toString(),
      }),
    );
    onSaved(validation.data);
    const message = confirmed
      ? "מדרגות התמלוגים נשמרו ואושרו"
      : "הגדרות התמלוגים נשמרו";
    setSuccessMessage(message);
    setIsSaving(false);
    toast.success(message);
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
              אשר את המדרגות
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isEmpty && (
        <Alert>
          <AlertTitle>עדיין לא הוגדרו מדרגות תמלוגים</AlertTitle>
          <AlertDescription>
            הוסיפי את הרפים והאחוזים. המדרגה האחרונה ללא הגבלה כבר נוספה.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>הגדרות התמלוגים לא נשמרו</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
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
                updateDraft((current) => ({ ...current, basis: value }))
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
                  <TableHead>חישוב</TableHead>
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
                  const isUnlimited = tier.upTo === null;
                  const hint =
                    tier.upTo === null
                      ? null
                      : thresholdHint(
                          tier.upTo,
                          draft.basis,
                          displayVatRate,
                        );

                  return (
                    <TableRow
                      key={`${index}-${isUnlimited ? "infinity" : "tier"}`}
                    >
                      <TableCell className="whitespace-nowrap font-medium">
                        {index === 0 ? (
                          "מ־0"
                        ) : (
                          <>
                            מ־
                            <bdi>
                              {previousUpTo
                                ? numberFormatter.format(
                                    // The previous רף is inclusive, so this
                                    // tier really starts one agora above it.
                                    parseNumber(previousUpTo) + 0.01,
                                  )
                                : "—"}
                            </bdi>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="min-w-44">
                        {isUnlimited ? (
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
                            {isLast && (
                              <div className="space-y-1">
                                <p className="text-xs text-destructive">
                                  המדרגה האחרונה חייבת להיות ללא הגבלה.
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateTier(index, "upTo", null)
                                  }
                                  disabled={isSaving}
                                >
                                  הגדרה ללא הגבלה
                                </Button>
                              </div>
                            )}
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
                      <TableCell className="min-w-56">
                        {index === 0 ? (
                          <span className="text-sm text-muted-foreground">
                            על כל המחזור
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`royalty-tier-marginal-${index}`}
                              checked={tier.marginal}
                              onCheckedChange={(checked) =>
                                updateTier(index, "marginal", checked)
                              }
                              disabled={isSaving}
                            />
                            <Label
                              htmlFor={`royalty-tier-marginal-${index}`}
                              className="text-sm font-normal"
                            >
                              {tier.marginal
                                ? "רק על ההפרש"
                                : "על כל המחזור"}
                            </Label>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-72 text-sm text-muted-foreground">
                        {hint ? (
                          <bdi>{hint}</bdi>
                        ) : tier.marginal ? (
                          "המדרגה חלה רק על ההפרש מהרף הקודם"
                        ) : (
                          "המדרגה חלה על כל מחזור שמעל הרף הקודם"
                        )}
                      </TableCell>
                      <TableCell>
                        {!isLast && !isUnlimited && (
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
                  updateDraft((current) => ({
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
                  updateDraft((current) => ({
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

          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center gap-3">
              <Switch
                id="royalty-include-tips"
                checked={draft.includeTips}
                onCheckedChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    includeTips: checked,
                  }))
                }
                disabled={isSaving}
              />
              <Label htmlFor="royalty-include-tips">מחויב כולל טיפים</Label>
            </div>
            {draft.includeTips && (
              <div className="flex items-center gap-3 border-t pt-3">
                <Switch
                  id="royalty-tips-absent"
                  checked={draft.tipsAbsent}
                  onCheckedChange={(checked) =>
                    updateDraft((current) => ({
                      ...current,
                      tipsAbsent: checked,
                    }))
                  }
                  disabled={isSaving}
                />
                <Label
                  htmlFor="royalty-tips-absent"
                  className="font-normal"
                >
                  אין טיפים בסניף הזה — לא להתריע על טיפים נמוכים
                </Label>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            {/* ponytail: saving IS the approval. The separate confirm gate only
                ever existed to fence values seeded from January's Excel, and the
                warning banner above still covers "approve without editing". */}
            <Button type="button" onClick={() => save(true)} disabled={isSaving}>
              {isSaving && (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              )}
              {draft.confirmed
                ? "שמירת הגדרות תמלוגים"
                : "שמירה ואישור מדרגות"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
