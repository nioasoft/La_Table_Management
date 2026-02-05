"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Save, Package } from "lucide-react";
import { format } from "date-fns";
import { he as dateFnsHe } from "date-fns/locale";

interface SupplierProduct {
  id: string;
  supplierId: string;
  name: string;
  normalizedName: string;
  vatApplicable: boolean;
  lastSeenAt: string;
  createdAt: string;
}

interface ProductStats {
  total: number;
  vatCount: number;
  exemptCount: number;
}

interface SupplierProductsTabProps {
  supplierId: string;
}

export function SupplierProductsTab({ supplierId }: SupplierProductsTabProps) {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [stats, setStats] = useState<ProductStats>({ total: 0, vatCount: 0, exemptCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/products`);
      if (!res.ok) throw new Error("Failed to load products");
      const data = await res.json();
      setProducts(data.products);
      setStats(data.stats);
    } catch (err) {
      setError("שגיאה בטעינת הפריטים");
      console.error("Failed to load products:", err);
    } finally {
      setIsLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleToggle = (productId: string, currentValue: boolean) => {
    const original = products.find((p) => p.id === productId);
    if (!original) return;

    const newValue = !currentValue;

    setChanges((prev) => {
      const next = new Map(prev);
      // If toggling back to original, remove the change
      if (original.vatApplicable === newValue) {
        next.delete(productId);
      } else {
        next.set(productId, newValue);
      }
      return next;
    });
  };

  const getEffectiveValue = (product: SupplierProduct): boolean => {
    return changes.has(product.id) ? changes.get(product.id)! : product.vatApplicable;
  };

  const handleSelectAll = (value: boolean) => {
    const filteredProducts = getFilteredProducts();
    setChanges((prev) => {
      const next = new Map(prev);
      for (const product of filteredProducts) {
        if (product.vatApplicable === value) {
          next.delete(product.id);
        } else {
          next.set(product.id, value);
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (changes.size === 0) return;

    setIsSaving(true);
    setSaveMessage(null);
    try {
      const updates = Array.from(changes.entries()).map(([id, vatApplicable]) => ({
        id,
        vatApplicable,
      }));

      const res = await fetch(`/api/suppliers/${supplierId}/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      if (!res.ok) throw new Error("Failed to save");

      setChanges(new Map());
      setSaveMessage("סטטוס מע״מ עודכן בהצלחה");
      setTimeout(() => setSaveMessage(null), 3000);
      await fetchProducts();
    } catch (err) {
      setError("שגיאה בשמירת השינויים");
      console.error("Failed to save:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const getFilteredProducts = () => {
    if (!search) return products;
    const normalizedSearch = search.toLowerCase().trim();
    return products.filter((p) => p.normalizedName.includes(normalizedSearch));
  };

  const filteredProducts = getFilteredProducts();

  // Count effective VAT stats including pending changes
  const effectiveVatCount = products.filter((p) => getEffectiveValue(p)).length;
  const effectiveExemptCount = products.length - effectiveVatCount;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="me-2 text-muted-foreground">טוען פריטים...</span>
        </CardContent>
      </Card>
    );
  }

  if (error && products.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (products.length === 0 && !search) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>לא נמצאו פריטים.</p>
          <p className="text-sm mt-1">העלו קובץ של הספק כדי לטעון את רשימת הפריטים.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" />
          ניהול פריטים ומע״מ
        </CardTitle>
        <CardDescription>
          סמנו פריטים שכוללים מע״מ. פריטים חדשים מתווספים אוטומטית בעת העלאת קובץ.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats bar */}
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="outline">{stats.total} פריטים</Badge>
          <Badge variant="default" className="bg-blue-600">
            {changes.size > 0 ? effectiveVatCount : stats.vatCount} חייבים במע״מ
          </Badge>
          <Badge variant="secondary">
            {changes.size > 0 ? effectiveExemptCount : stats.exemptCount} פטורים
          </Badge>
          {changes.size > 0 && (
            <Badge variant="destructive">{changes.size} שינויים</Badge>
          )}
        </div>

        {/* Search and actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש פריט..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSelectAll(true)}
          >
            סמן הכל
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSelectAll(false)}
          >
            בטל הכל
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={changes.size === 0 || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin me-1" />
            ) : (
              <Save className="h-4 w-4 me-1" />
            )}
            שמירה
          </Button>
        </div>

        {/* Success/error messages */}
        {saveMessage && (
          <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">
            {saveMessage}
          </div>
        )}
        {error && products.length > 0 && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Products table */}
        <div className="border rounded-md max-h-[600px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px] text-center">מע״מ</TableHead>
                <TableHead>שם פריט</TableHead>
                <TableHead className="w-[150px]">נצפה לאחרונה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => {
                const isChanged = changes.has(product.id);
                const effectiveValue = getEffectiveValue(product);

                return (
                  <TableRow
                    key={product.id}
                    className={isChanged ? "bg-yellow-50" : undefined}
                  >
                    <TableCell className="text-center">
                      <Checkbox
                        checked={effectiveValue}
                        onCheckedChange={() => handleToggle(product.id, effectiveValue)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {product.name}
                      {effectiveValue && (
                        <Badge variant="outline" className="ms-2 text-xs">
                          חייב במע״מ
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(product.lastSeenAt), "d MMM yyyy", {
                        locale: dateFnsHe,
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    {search ? "לא נמצאו פריטים תואמים" : "אין פריטים"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
