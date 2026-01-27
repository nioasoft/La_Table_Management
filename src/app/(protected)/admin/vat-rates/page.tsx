"use client";

import { useState } from "react";
import { formatDateAsLocal } from "@/lib/date-utils";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LogOut,
  Pencil,
  ChevronRight,
  Check,
  Loader2,
  Plus,
  Trash2,
  Percent,
  Calendar,
} from "lucide-react";
import type { VatRate } from "@/db/schema";
import Link from "next/link";

interface VatRateFormData {
  rate: string;
  effectiveFrom: string;
  description: string;
  notes: string;
}

const initialFormData: VatRateFormData = {
  rate: "",
  effectiveFrom: "",
  description: "",
  notes: "",
};

export default function AdminVatRatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRate, setEditingRate] = useState<VatRate | null>(null);
  const [formData, setFormData] = useState<VatRateFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [rateToDelete, setRateToDelete] = useState<VatRate | null>(null);
  const { data: session, isPending } = authClient.useSession();

  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/vat-rates");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch VAT rates
  const { data: ratesData, isLoading } = useQuery({
    queryKey: ["vat-rates", "list"],
    queryFn: async () => {
      const response = await fetch("/api/vat-rates?stats=true");
      if (!response.ok) {
        throw new Error("Failed to fetch VAT rates");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const vatRates: VatRate[] = ratesData?.vatRates || [];
  const stats = ratesData?.stats;

  // Create mutation
  const createRate = useMutation({
    mutationFn: async (data: VatRateFormData) => {
      const response = await fetch("/api/vat-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate: parseFloat(data.rate) / 100, // Convert percentage to decimal
          effectiveFrom: data.effectiveFrom,
          description: data.description || null,
          notes: data.notes || null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create VAT rate");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vat-rates"] });
      setShowForm(false);
      setEditingRate(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Update mutation
  const updateRate = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: VatRateFormData }) => {
      const response = await fetch(`/api/vat-rates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate: parseFloat(data.rate) / 100, // Convert percentage to decimal
          effectiveFrom: data.effectiveFrom,
          description: data.description || null,
          notes: data.notes || null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update VAT rate");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vat-rates"] });
      setShowForm(false);
      setEditingRate(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Delete mutation
  const deleteRate = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/vat-rates/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete VAT rate");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vat-rates"] });
      setRateToDelete(null);
    },
    onError: (error: Error) => {
      alert(error.message);
      setRateToDelete(null);
    },
  });

  const isSubmitting = createRate.isPending || updateRate.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.rate || !formData.effectiveFrom) {
      setFormError("יש להזין שיעור מע״מ ותאריך תחולה");
      return;
    }

    const rateNum = parseFloat(formData.rate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
      setFormError("שיעור מע״מ חייב להיות בין 0 ל-100");
      return;
    }

    if (editingRate) {
      updateRate.mutate({ id: editingRate.id, data: formData });
    } else {
      createRate.mutate(formData);
    }
  };

  const handleEdit = (rate: VatRate) => {
    setEditingRate(rate);
    setFormData({
      rate: (parseFloat(rate.rate) * 100).toString(), // Convert decimal to percentage
      effectiveFrom: rate.effectiveFrom,
      description: rate.description || "",
      notes: rate.notes || "",
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleDelete = () => {
    if (rateToDelete) {
      deleteRate.mutate(rateToDelete.id);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingRate(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("he-IL", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const isCurrentRate = (rate: VatRate) => {
    const today = formatDateAsLocal(new Date());
    // Find the most recent rate effective on or before today
    const currentRate = vatRates.find((r) => r.effectiveFrom <= today);
    return currentRate?.id === rate.id;
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 me-1" />
              לוח בקרה
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">ניהול שיעורי מע״מ</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { setShowForm(true); setEditingRate(null); setFormData(initialFormData); }}>
            <Plus className="me-2 h-4 w-4" />
            הוסף שיעור
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="me-2 h-4 w-4" />
            יציאה
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Percent className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">שיעור נוכחי</p>
                  <p className="text-2xl font-bold">{(stats.currentRate * 100).toFixed(0)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">סה״כ שיעורים</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {stats.newestRate && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <Check className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">שיעור אחרון</p>
                    <p className="text-2xl font-bold">
                      {formatDate(stats.newestRate.effectiveFrom)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              {editingRate ? "עריכת שיעור מע״מ" : "הוספת שיעור מע״מ חדש"}
            </CardTitle>
            <CardDescription>
              {editingRate
                ? "עדכן את פרטי שיעור המע״מ"
                : "הגדר שיעור מע״מ חדש עם תאריך תחולה"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{formError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rate">שיעור מע״מ (%) *</Label>
                  <Input
                    id="rate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.rate}
                    onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                    placeholder="לדוגמה: 18"
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="effectiveFrom">תאריך תחולה *</Label>
                  <Input
                    id="effectiveFrom"
                    type="date"
                    value={formData.effectiveFrom}
                    onChange={(e) => setFormData({ ...formData, effectiveFrom: e.target.value })}
                    disabled={isSubmitting}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">תיאור</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="לדוגמה: שיעור מע״מ סטנדרטי"
                  disabled={isSubmitting}
                  dir="rtl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">הערות</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="הערות נוספות..."
                  disabled={isSubmitting}
                  dir="rtl"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={cancelForm} disabled={isSubmitting}>
                  ביטול
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      שומר...
                    </>
                  ) : (
                    <>
                      <Check className="me-2 h-4 w-4" />
                      {editingRate ? "עדכן" : "צור"}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>היסטוריית שיעורי מע״מ</CardTitle>
          <CardDescription>
            כל שיעורי המע״מ לפי תאריך תחולה (מהחדש לישן)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vatRates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              לא הוגדרו שיעורי מע״מ. לחץ על &quot;הוסף שיעור&quot; להתחלה.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">שיעור</TableHead>
                  <TableHead className="text-right">תאריך תחולה</TableHead>
                  <TableHead className="text-right">תיאור</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right w-[100px]">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vatRates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">
                      {(parseFloat(rate.rate) * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell>{formatDate(rate.effectiveFrom)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {rate.description || "-"}
                    </TableCell>
                    <TableCell>
                      {isCurrentRate(rate) ? (
                        <Badge variant="default" className="bg-green-500">פעיל</Badge>
                      ) : new Date(rate.effectiveFrom) > new Date() ? (
                        <Badge variant="secondary">עתידי</Badge>
                      ) : (
                        <Badge variant="outline">היסטורי</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(rate)}
                          title="ערוך"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRateToDelete(rate)}
                          className="text-destructive hover:text-destructive"
                          title="מחק"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!rateToDelete} onOpenChange={() => setRateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת שיעור מע״מ</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את שיעור המע״מ של{" "}
              {rateToDelete && (parseFloat(rateToDelete.rate) * 100).toFixed(2)}%
              מתאריך {rateToDelete && formatDate(rateToDelete.effectiveFrom)}?
              {isCurrentRate(rateToDelete!) && (
                <span className="block mt-2 text-destructive font-medium">
                  שים לב: זהו השיעור הפעיל הנוכחי!
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
