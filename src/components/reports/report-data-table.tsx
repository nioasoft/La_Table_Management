"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  FileSpreadsheet,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  sortData,
  filterBySearch,
  paginateData,
  type SortConfig,
  type SortDirection,
} from "@/lib/report-utils";

// ============================================================================
// TYPES
// ============================================================================

export interface ColumnDef<T> {
  /** Unique identifier for the column */
  id: string;
  /** Header text */
  header: string;
  /** Accessor key or function to get the cell value */
  accessorKey?: keyof T;
  /** Custom accessor function */
  accessor?: (row: T) => React.ReactNode;
  /** Whether the column is sortable */
  sortable?: boolean;
  /** Whether the column is searchable */
  searchable?: boolean;
  /** Custom cell renderer */
  cell?: (row: T) => React.ReactNode;
  /** Column width class */
  className?: string;
  /** Header alignment */
  headerClassName?: string;
}

export interface ReportDataTableProps<T> {
  /** Data to display */
  data: T[];
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Optional row key accessor */
  rowKey?: keyof T | ((row: T) => string);
  /** Enable search functionality */
  enableSearch?: boolean;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Enable sorting */
  enableSorting?: boolean;
  /** Enable pagination */
  enablePagination?: boolean;
  /** Default page size */
  defaultPageSize?: number;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Loading state */
  isLoading?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Optional className for table container */
  className?: string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Highlight row on hover */
  highlightOnHover?: boolean;
  /** Function to return custom className for a row */
  rowClassName?: (row: T) => string | undefined;
  /** Render function for expanded row content */
  expandedRowRender?: (row: T) => React.ReactNode;
  /** Check if row is expandable */
  isRowExpandable?: (row: T) => boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReportDataTable<T extends object>({
  data,
  columns,
  rowKey,
  enableSearch = true,
  searchPlaceholder = "חיפוש...",
  enableSorting = true,
  enablePagination = true,
  defaultPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  isLoading = false,
  emptyMessage = "אין נתונים להצגה",
  className,
  onRowClick,
  highlightOnHover = true,
  rowClassName,
  expandedRowRender,
  isRowExpandable,
}: ReportDataTableProps<T>) {
  // Search state
  const [searchTerm, setSearchTerm] = useState("");

  // Expanded rows state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Sort state
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Get row key
  const getRowKey = useCallback(
    (row: T, index: number): string => {
      if (!rowKey) {
        // Try "id" as default, fallback to index
        const defaultKey = (row as Record<string, unknown>)["id"];
        return defaultKey != null ? String(defaultKey) : String(index);
      }
      if (typeof rowKey === "function") {
        return rowKey(row);
      }
      const key = (row as Record<string, unknown>)[rowKey as string];
      return key != null ? String(key) : String(index);
    },
    [rowKey]
  );

  // Get searchable columns
  const searchableColumns = useMemo(
    () =>
      columns
        .filter((col) => col.searchable !== false && col.accessorKey)
        .map((col) => col.accessorKey as keyof T),
    [columns]
  );

  // Process data: filter -> sort -> paginate
  const processedData = useMemo(() => {
    let result = [...data];

    // Filter by search term
    if (enableSearch && searchTerm) {
      result = filterBySearch(result, searchTerm, searchableColumns);
    }

    // Sort
    if (enableSorting && sortConfig?.column) {
      result = sortData(result, sortConfig);
    }

    return result;
  }, [data, searchTerm, sortConfig, enableSearch, enableSorting, searchableColumns]);

  // Paginate
  const paginatedData = useMemo(() => {
    if (!enablePagination) return processedData;
    return paginateData(processedData, currentPage, pageSize);
  }, [processedData, currentPage, pageSize, enablePagination]);

  // Pagination info
  const totalItems = processedData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const showingFrom = totalItems > 0 ? startIndex + 1 : 0;
  const showingTo = endIndex;

  // Handle sort click
  const handleSort = useCallback(
    (columnId: string) => {
      if (!enableSorting) return;

      setSortConfig((prev) => {
        if (prev?.column !== columnId) {
          return { column: columnId, direction: "asc" };
        }
        if (prev.direction === "asc") {
          return { column: columnId, direction: "desc" };
        }
        return null;
      });
    },
    [enableSorting]
  );

  // Handle page change
  const handlePageChange = useCallback(
    (page: number) => {
      const newPage = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(newPage);
    },
    [totalPages]
  );

  // Handle page size change
  const handlePageSizeChange = useCallback((newSize: string) => {
    const size = parseInt(newSize, 10);
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  // Handle search change
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to first page on search
  }, []);

  // Toggle row expansion
  const toggleRowExpansion = useCallback((rowKey: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(rowKey)) {
        newSet.delete(rowKey);
      } else {
        newSet.add(rowKey);
      }
      return newSet;
    });
  }, []);

  // Get cell value
  const getCellValue = useCallback(
    (row: T, column: ColumnDef<T>): React.ReactNode => {
      if (column.cell) {
        return column.cell(row);
      }
      if (column.accessor) {
        return column.accessor(row);
      }
      if (column.accessorKey) {
        const value = row[column.accessorKey];
        return value != null ? String(value) : "";
      }
      return "";
    },
    []
  );

  // Render sort icon
  const renderSortIcon = useCallback(
    (columnId: string) => {
      if (sortConfig?.column !== columnId) {
        return <ArrowUpDown className="h-4 w-4 opacity-50" />;
      }
      if (sortConfig.direction === "asc") {
        return <ArrowUp className="h-4 w-4" />;
      }
      return <ArrowDown className="h-4 w-4" />;
    },
    [sortConfig]
  );

  return (
    <div className={cn("space-y-4", className)}>
      {/* Search Bar */}
      {enableSearch && (
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="חיפוש בטבלה"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="ps-10"
            />
          </div>
          {searchTerm && (
            <span className="text-sm text-muted-foreground">
              נמצאו {processedData.length} תוצאות
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="טבלת נתונים">
          <TableHeader>
            <TableRow>
              {expandedRowRender && <TableHead className="w-10" />}
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "text-start",
                    column.sortable !== false && enableSorting && "cursor-pointer select-none",
                    column.headerClassName
                  )}
                  onClick={() =>
                    column.sortable !== false && handleSort(column.accessorKey as string || column.id)
                  }
                >
                  <div className="flex items-center justify-start gap-2">
                    <span>{column.header}</span>
                    {column.sortable !== false && enableSorting && (
                      renderSortIcon(column.accessorKey as string || column.id)
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span>טוען נתונים...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (expandedRowRender ? 1 : 0)}
                  className="h-32 text-center"
                >
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileSpreadsheet className="h-8 w-8" />
                    <span>{emptyMessage}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => {
                const key = getRowKey(row, index);
                const isExpanded = expandedRows.has(key);
                const canExpand = expandedRowRender && (!isRowExpandable || isRowExpandable(row));

                return (
                  <Fragment key={key}>
                    <TableRow
                      className={cn(
                        highlightOnHover && "hover:bg-muted/50",
                        (onRowClick || canExpand) && "cursor-pointer",
                        isExpanded && "bg-muted/30",
                        rowClassName?.(row)
                      )}
                      onClick={() => {
                        if (canExpand) {
                          toggleRowExpansion(key);
                        } else {
                          onRowClick?.(row);
                        }
                      }}
                    >
                      {expandedRowRender && (
                        <TableCell className="w-10 px-2">
                          {canExpand && (
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform duration-200",
                                isExpanded && "rotate-180"
                              )}
                            />
                          )}
                        </TableCell>
                      )}
                      {columns.map((column) => (
                        <TableCell
                          key={column.id}
                          className={cn("text-start", column.className)}
                        >
                          {getCellValue(row, column)}
                        </TableCell>
                      ))}
                    </TableRow>
                    {isExpanded && canExpand && (
                      <TableRow className="bg-muted/20">
                        <TableCell
                          colSpan={columns.length + 1}
                          className="p-0"
                        >
                          <div className="ps-8 py-3 pe-4">
                            {expandedRowRender(row)}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {enablePagination && totalItems > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>מציג</span>
            <span className="font-medium text-foreground">{showingFrom}</span>
            <span>עד</span>
            <span className="font-medium text-foreground">{showingTo}</span>
            <span>מתוך</span>
            <span className="font-medium text-foreground">{totalItems}</span>
            <span>רשומות</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">שורות בעמוד:</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-20 h-8" aria-label="בחר מספר שורות בעמוד">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Page Navigation */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                aria-label="עמוד ראשון"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="עמוד קודם"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <span className="text-sm px-2">
                עמוד {currentPage} מתוך {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                aria-label="עמוד הבא"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage >= totalPages}
                aria-label="עמוד אחרון"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
