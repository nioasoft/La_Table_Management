"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface HistoryFiltersProps {
  filters: {
    supplierId?: string;
    franchiseeId?: string;
    periodStartDate?: string;
    periodEndDate?: string;
  };
  onFiltersChange: (filters: {
    supplierId?: string;
    franchiseeId?: string;
    periodStartDate?: string;
    periodEndDate?: string;
  }) => void;
}

export function HistoryFilters({ filters, onFiltersChange }: HistoryFiltersProps) {
  const [localFilters, setLocalFilters] = useState(filters);

  // Fetch suppliers for dropdown
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers?activeOnly=true");
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return res.json();
    },
  });

  // Fetch franchisees for dropdown
  const { data: franchisees } = useQuery({
    queryKey: ["franchisees-list"],
    queryFn: async () => {
      const res = await fetch("/api/franchisees?activeOnly=true");
      if (!res.ok) throw new Error("Failed to fetch franchisees");
      return res.json();
    },
  });

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleApply = () => {
    onFiltersChange(localFilters);
  };

  const handleClear = () => {
    const cleared = {
      supplierId: undefined,
      franchiseeId: undefined,
      periodStartDate: undefined,
      periodEndDate: undefined,
    };
    setLocalFilters(cleared);
    onFiltersChange(cleared);
  };

  const hasFilters = Object.values(localFilters).some((v) => v);

  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Supplier Filter */}
        <div className="space-y-2">
          <Label>ספק</Label>
          <Select
            value={localFilters.supplierId || "all"}
            onValueChange={(value) =>
              setLocalFilters({ ...localFilters, supplierId: value === "all" ? undefined : value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="כל הספקים" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הספקים</SelectItem>
              {suppliers?.suppliers?.map((s: { id: string; name: string }) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Franchisee Filter */}
        <div className="space-y-2">
          <Label>זכיין</Label>
          <Select
            value={localFilters.franchiseeId || "all"}
            onValueChange={(value) =>
              setLocalFilters({ ...localFilters, franchiseeId: value === "all" ? undefined : value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="כל הזכיינים" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הזכיינים</SelectItem>
              {franchisees?.franchisees?.map((f: { id: string; name: string }) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Period Start Date */}
        <div className="space-y-2">
          <Label>מתאריך</Label>
          <Input
            type="date"
            value={localFilters.periodStartDate || ""}
            onChange={(e) =>
              setLocalFilters({ ...localFilters, periodStartDate: e.target.value || undefined })
            }
          />
        </div>

        {/* Period End Date */}
        <div className="space-y-2">
          <Label>עד תאריך</Label>
          <Input
            type="date"
            value={localFilters.periodEndDate || ""}
            onChange={(e) =>
              setLocalFilters({ ...localFilters, periodEndDate: e.target.value || undefined })
            }
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleApply} size="sm">
          <Search className="h-4 w-4 me-2" />
          החל סינון
        </Button>
        {hasFilters && (
          <Button variant="outline" onClick={handleClear} size="sm">
            <X className="h-4 w-4 me-2" />
            נקה סינון
          </Button>
        )}
      </div>
    </div>
  );
}
