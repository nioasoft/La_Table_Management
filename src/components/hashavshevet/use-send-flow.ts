"use client";

import { usePreviewMutation, useSendMutation, type ExportRequest } from "@/queries/hashavshevet";
import { buildExpected } from "./preview-state";

/** One export's preview + send, driven by the dialog. `refresh` also forgets any previous send result. */
export function useSendFlow(request: ExportRequest) {
  const preview = usePreviewMutation();
  const send = useSendMutation();

  const refresh = () => {
    send.reset();
    preview.mutate(request);
  };

  /** Sends exactly what the preview showed as new; the server answers 409 if the data moved since. */
  const sendNow = () => {
    if (!preview.data) return;
    send.mutate({ ...request, expected: buildExpected(preview.data) });
  };

  return { preview, send, refresh, sendNow };
}

export type SendFlow = ReturnType<typeof useSendFlow>;
