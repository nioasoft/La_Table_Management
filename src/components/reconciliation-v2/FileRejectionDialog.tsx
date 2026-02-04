"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface FileRejectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (reason: string, sendEmail: boolean) => void;
  supplierName: string;
  isLoading?: boolean;
}

export function FileRejectionDialog({
  open,
  onOpenChange,
  onReject,
  supplierName,
  isLoading,
}: FileRejectionDialogProps) {
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(false);

  const handleSubmit = () => {
    if (reason.trim()) {
      onReject(reason.trim(), sendEmail);
      setReason("");
      setSendEmail(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>דחיית קובץ ספק</DialogTitle>
          <DialogDescription>
            האם אתה בטוח שברצונך לדחות את קובץ הספק {supplierName}?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reason">סיבת דחייה</Label>
            <Textarea
              id="reason"
              placeholder="הזן את סיבת הדחייה..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          <div className="flex items-center space-x-2 space-x-reverse">
            <Checkbox
              id="sendEmail"
              checked={sendEmail}
              onCheckedChange={(checked) => setSendEmail(checked === true)}
            />
            <Label htmlFor="sendEmail" className="cursor-pointer">
              שלח קישור העלאה חדש לספק
            </Label>
          </div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2">
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!reason.trim() || isLoading}
          >
            {isLoading ? "דוחה..." : "דחה קובץ"}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
