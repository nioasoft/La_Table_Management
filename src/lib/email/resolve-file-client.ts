/**
 * Per-FILE client resolution for ezcount "[העתק]" copy invoices.
 *
 * The channel-level client comes from the to-address/sender, but every
 * franchisee runs ONE ezcount sequence serving several platforms, and all the
 * copy emails arrive at mishlocha@inbound regardless of who the invoice was
 * issued to. Only the PDF's "לכבוד" line knows the real recipient.
 *
 * So for `client_report` files arriving on the MISHLOCHA channel we sniff the
 * recipient and re-route the file. Detection failure (image-only PDF etc.)
 * keeps the channel client — the processor's overwrite guard is the backstop.
 *
 * Two incidents came from this path: May 2026, חורב's Haat-bound invoice 10051
 * overwrote its Mishloha report slot (which is why the sniff was added); and
 * July 2026, four 10bis-bound invoices did the same after 10bis went
 * self-billed, because the detector had no TENBIS tokens.
 *
 * Shared deliberately: the live webhook and the replay route had each grown
 * their own copy of the surrounding logic, and the replay copy never had this
 * step at all — so replaying a misrouted email faithfully recreated the
 * misroute. Both import this now; do not re-fork it.
 */
import { and, eq } from "drizzle-orm";
import { database } from "@/db";
import { client } from "@/db/schema";
import { detectRecipientClientCodeFromPdf } from "@/lib/email/detect-invoice-recipient";

/** Minimal client-identity shape shared by the channel client and per-file overrides. */
export interface FileClientIdentity {
  clientId: string;
  clientCode: string;
  parserCode: string;
}

export async function resolveFileClient(
  channelClient: FileClientIdentity,
  buffer: Buffer,
  documentType: "client_report" | "commission_invoice",
  fileName: string,
  /** Optional sink for a human-readable note (webhook writes it to the sync log). */
  errorDetails?: string[],
): Promise<FileClientIdentity> {
  if (channelClient.clientCode.toUpperCase() !== "MISHLOCHA") {
    return channelClient;
  }
  // Commission invoices on this channel are issued BY Mishloha to the
  // franchisee — recipient is the franchisee, nothing to re-route.
  if (documentType !== "client_report") {
    return channelClient;
  }

  const recipientCode = await detectRecipientClientCodeFromPdf(buffer);
  if (!recipientCode || recipientCode === channelClient.clientCode.toUpperCase()) {
    return channelClient;
  }

  const [target] = await database
    .select({
      id: client.id,
      code: client.code,
      parserCode: client.parserCode,
    })
    .from(client)
    .where(and(eq(client.isActive, true), eq(client.code, recipientCode)))
    .limit(1);
  if (!target) {
    console.warn(
      `[email-inbound] recipient sniff found "${recipientCode}" for "${fileName}" but no active client with that code — keeping ${channelClient.clientCode}`,
    );
    return channelClient;
  }

  console.log(
    `[email-inbound] Re-routed "${fileName}" by invoice recipient: ${channelClient.clientCode} → ${recipientCode}`,
  );
  errorDetails?.push(
    `נותב מחדש לפי "לכבוד": "${fileName}" → ${recipientCode} (חשבונית שהזכיין הוציא ל-${recipientCode} והגיעה בערוץ משלוחה)`,
  );
  return {
    clientId: target.id,
    clientCode: target.code ?? recipientCode,
    parserCode: target.parserCode ?? target.code ?? recipientCode,
  };
}
