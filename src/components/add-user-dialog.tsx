"use client";

import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { he } from "@/lib/translations/he";

const t = he.admin.users.addUser;

/**
 * Users join by self-registering and waiting for approval, so "adding" one
 * means handing them the sign-up link.
 */
// ponytail: invite link, not admin-created accounts — add a create-user API if links stop being enough
export function AddUserDialog() {
  const [open, setOpen] = useState(false);
  const signUpUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/sign-up`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(signUpUrl);
      toast.success(t.copied);
    } catch (error) {
      console.error("Failed to copy sign-up link:", error);
      toast.error(t.copyFailed);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="me-2 h-4 w-4" />
        {t.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={signUpUrl} dir="ltr" onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={handleCopy}>
              <Copy className="me-2 h-4 w-4" />
              {t.copy}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
