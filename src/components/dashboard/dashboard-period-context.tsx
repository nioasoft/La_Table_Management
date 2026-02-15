"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import type { SettlementPeriodType } from "@/db/schema";
import {
  getPeriodsForFrequency,
  getPeriodByKey,
  type SettlementPeriodInfo,
} from "@/lib/settlement-periods";

interface DashboardPeriodContextValue {
  periodType: SettlementPeriodType;
  periodKey: string;
  periodInfo: SettlementPeriodInfo | null;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  year: number;
  setPeriod: (type: SettlementPeriodType, key: string) => void;
}

const DashboardPeriodContext =
  createContext<DashboardPeriodContextValue | null>(null);

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDefaultPeriod(): { type: SettlementPeriodType; key: string } {
  const periods = getPeriodsForFrequency("quarterly", new Date(), 1, 1, true);
  const defaultPeriod = periods[0];
  return {
    type: "quarterly",
    key: defaultPeriod?.key || "",
  };
}

export function DashboardPeriodProvider({
  children,
}: {
  children: ReactNode;
}) {
  const defaults = useMemo(() => getDefaultPeriod(), []);
  const [periodType, setPeriodType] = useState<SettlementPeriodType>(
    defaults.type
  );
  const [periodKey, setPeriodKey] = useState(defaults.key);

  const periodInfo = useMemo(
    () => (periodKey ? getPeriodByKey(periodKey) : null),
    [periodKey]
  );

  const value = useMemo<DashboardPeriodContextValue>(() => {
    const startDate = periodInfo
      ? formatLocalDate(periodInfo.startDate)
      : "";
    const endDate = periodInfo ? formatLocalDate(periodInfo.endDate) : "";
    const year = periodInfo
      ? periodInfo.startDate.getFullYear()
      : new Date().getFullYear();

    return {
      periodType,
      periodKey,
      periodInfo,
      startDate,
      endDate,
      year,
      setPeriod: (type: SettlementPeriodType, key: string) => {
        setPeriodType(type);
        setPeriodKey(key);
      },
    };
  }, [periodType, periodKey, periodInfo]);

  return (
    <DashboardPeriodContext.Provider value={value}>
      {children}
    </DashboardPeriodContext.Provider>
  );
}

export function useDashboardPeriod(): DashboardPeriodContextValue {
  const ctx = useContext(DashboardPeriodContext);
  if (!ctx) {
    throw new Error(
      "useDashboardPeriod must be used within a DashboardPeriodProvider"
    );
  }
  return ctx;
}
