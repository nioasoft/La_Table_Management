import { useQuery } from "@tanstack/react-query";
import type { FranchiseeBkmvYear } from "@/db/schema";

export const bkmvYearKeys = {
  all: ["bkmv-years"] as const,
  lists: () => [...bkmvYearKeys.all, "list"] as const,
  list: (franchiseeId: string) =>
    [...bkmvYearKeys.lists(), franchiseeId] as const,
  details: () => [...bkmvYearKeys.all, "detail"] as const,
  detail: (franchiseeId: string, year: number) =>
    [...bkmvYearKeys.details(), franchiseeId, year] as const,
};

interface BkmvYearSummary {
  id: string;
  year: number;
  monthCount: number;
  monthsCovered: number[] | null;
  isComplete: boolean;
  updatedAt: string;
}

async function fetchBkmvYears(
  franchiseeId: string
): Promise<BkmvYearSummary[]> {
  const res = await fetch(
    `/api/bkmvdata/years?franchiseeId=${encodeURIComponent(franchiseeId)}`
  );
  if (!res.ok) throw new Error("Failed to fetch BKMV years");
  const data = await res.json();
  return data.years;
}

async function fetchBkmvYearData(
  franchiseeId: string,
  year: number
): Promise<FranchiseeBkmvYear> {
  const res = await fetch(
    `/api/bkmvdata/years?franchiseeId=${encodeURIComponent(franchiseeId)}&year=${year}`
  );
  if (!res.ok) throw new Error("Failed to fetch BKMV year data");
  const data = await res.json();
  return data.year;
}

export function useBkmvYears(franchiseeId: string | null) {
  return useQuery({
    queryKey: bkmvYearKeys.list(franchiseeId ?? ""),
    queryFn: () => fetchBkmvYears(franchiseeId!),
    enabled: !!franchiseeId,
  });
}

export function useBkmvYearData(
  franchiseeId: string | null,
  year: number | null
) {
  return useQuery({
    queryKey: bkmvYearKeys.detail(franchiseeId ?? "", year ?? 0),
    queryFn: () => fetchBkmvYearData(franchiseeId!, year!),
    enabled: !!franchiseeId && !!year,
  });
}
