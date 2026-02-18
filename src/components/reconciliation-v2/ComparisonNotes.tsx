"use client";

import { useState } from "react";
import { Pencil, StickyNote, Loader2 } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useUpdateComparisonNotes } from "@/queries/reconciliation-v2";

interface ComparisonNotesProps {
  comparisonId: string;
  sessionId: string;
  notes: string | null;
}

export function ComparisonNotes({
  comparisonId,
  sessionId,
  notes,
}: ComparisonNotesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editedNotes, setEditedNotes] = useState(notes || "");
  const mutation = useUpdateComparisonNotes();

  const handleSave = () => {
    const trimmed = editedNotes.trim();
    mutation.mutate(
      {
        comparisonId,
        sessionId,
        notes: trimmed || null,
      },
      {
        onSuccess: () => {
          toast.success("ההערה עודכנה בהצלחה");
          setIsOpen(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : "שגיאה בעדכון הערה"
          );
        },
      }
    );
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setEditedNotes(notes || "");
    }
  };

  const hasNotes = !!notes;

  const triggerButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      {hasNotes ? (
        <StickyNote className="h-3.5 w-3.5 text-amber-500" />
      ) : (
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="sr-only">הערה</span>
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {hasNotes ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>{triggerButton}</DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm whitespace-pre-wrap">{notes}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>{triggerButton}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>הערה לשורת התאמה</DialogTitle>
          <DialogDescription>
            הוסף או ערוך הערה חופשית לשורת ההתאמה הזו.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="comparison-notes">הערה</Label>
            <Textarea
              id="comparison-notes"
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              placeholder="הזן הערה..."
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
  );
}
