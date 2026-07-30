"use client";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const numberFormatter = new Intl.NumberFormat("he-IL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

const percentFormatter = new Intl.NumberFormat("he-IL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

interface BillingNumberProps {
  readonly value: string | number;
  readonly kind?: "currency" | "number" | "percent";
  readonly className?: string;
}

export function formatBillingNumber(
  value: string | number,
  kind: BillingNumberProps["kind"] = "number",
): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "לא זמין";
  if (kind === "currency") return currencyFormatter.format(numericValue);
  if (kind === "percent") {
    return `${percentFormatter.format(numericValue)}%`;
  }
  return numberFormatter.format(numericValue);
}

export function BillingNumber({
  value,
  kind = "number",
  className = "",
}: BillingNumberProps) {
  return (
    <span
      dir="ltr"
      className={`inline-block whitespace-nowrap [font-variant-numeric:tabular-nums] ${className}`}
    >
      <bdi>{formatBillingNumber(value, kind)}</bdi>
    </span>
  );
}
