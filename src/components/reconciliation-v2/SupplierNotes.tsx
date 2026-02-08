"use client";

import { useState } from "react";
import { Info, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reconciliationV2Keys } from "@/queries/reconciliation-v2";

interface SupplierNotesProps {
  supplierId: string;
  notes: string | null;
}

async function updateSupplierNotes(
  supplierId: string,
  notes: string
): Promise<void> {
  const res = await fetch(`/api/suppliers/${supplierId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: notes }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "שגיאה בעדכון הערה");
  }
}

export function SupplierNotes({ supplierId, notes }: SupplierNotesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editedNotes, setEditedNotes] = useState(notes || "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => updateSupplierNotes(supplierId, editedNotes),
    onSuccess: () => {
      toast.success("ההערה עודכנה בהצלחה");
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.suppliers(),
      });
      setIsOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "שגיאה בעדכון הערה");
    },
  });

  const handleSave = () => {
    mutation.mutate();
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setEditedNotes(notes || "");
    }
  };

  // Don't render anything if there are no notes
  if (!notes) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-amber-800 dark:text-amber-200">
      <Info className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm whitespace-pre-wrap break-words">{notes}</p>
      </div>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/30"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="sr-only">ערוך הערה</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>עריכת הערת ספק</DialogTitle>
            <DialogDescription>
              ערוך את ההערה הגלובלית לספק זה. הערה זו תוצג בכל מקום שבו עובדים עם
              הספק.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="notes">הערה</Label>
              <Textarea
                id="notes"
                value={editedNotes}
                onChange={(e) => setEditedNotes(e.target.value)}
                placeholder="הזן הערה לספק..."
                rows={4}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={mutation.isPending}
            >
              ביטול
            </Button>
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  שומר...
                </>
              ) : (
                "שמור"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
