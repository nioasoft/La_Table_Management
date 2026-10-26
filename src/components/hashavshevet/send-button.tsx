"use client";

import { Send } from "lucide-react";
import { useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { previewCopy } from "@/lib/hashavshevet/copy";
import type { ExportRequest } from "@/queries/hashavshevet";
import { PreviewDialog } from "./preview-dialog";
import { useSendFlow } from "./use-send-flow";

type SendButtonProps = ExportRequest & {
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /** Mirror the Excel button's own disabled state (nothing to export yet). */
  disabled?: boolean;
  className?: string;
};

/** Sits next to an Excel export button. `exportType` + `params` are what the Excel button sends. */
export function HashavshevetSendButton({
  label = previewCopy.sendButton,
  size,
  variant = "outline",
  disabled,
  className,
  ...request
}: SendButtonProps) {
  const [open, setOpen] = useState(false);
  const flow = useSendFlow(request);

  const handleClick = () => {
    setOpen(true);
    flow.refresh();
  };

  return (
    <>
      <Button type="button" size={size} variant={variant} className={className} disabled={disabled} onClick={handleClick}>
        <Send aria-hidden="true" />
        {label}
      </Button>
      <PreviewDialog open={open} onOpenChange={setOpen} exportType={request.exportType} flow={flow} />
    </>
  );
}
