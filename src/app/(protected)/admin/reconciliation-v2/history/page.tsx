"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, History } from "lucide-react";
import { HistoryFilters, HistoryTable } from "@/components/reconciliation-v2";
import { useReconciliationHistory } from "@/queries/reconciliation-v2";

const PAGE_SIZE = 50;

export default function ReconciliationHistoryPage() {
  const [filters, setFilters] = useState<{
    supplierId?: string;
    franchiseeId?: string;
    periodStartDate?: string;
    periodEndDate?: string;
  }>({});
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useReconciliationHistory({
    ...filters,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/reconciliation-v2">
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6 text-primary" />
            היסטוריית התאמות
          </h1>
          <p className="text-muted-foreground">
            צפייה בכל ההתאמות שבוצעו לאורך זמן
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryFilters
            filters={filters}
            onFiltersChange={(newFilters) => {
              setFilters(newFilters);
              setPage(0);
            }}
          />
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle>תוצאות</CardTitle>
          <CardDescription>
            {data ? `${data.total} רשומות נמצאו` : "טוען..."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">טוען היסטוריה...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">
              שגיאה בטעינת היסטוריה
            </div>
          ) : (
            <>
              <HistoryTable items={data?.items || []} />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    הקודם
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    עמוד {page + 1} מתוך {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    הבא
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
