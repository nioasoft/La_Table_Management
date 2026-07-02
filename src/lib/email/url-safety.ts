import { lookup } from "node:dns/promises";

// Max size we'll buffer from a body-supplied PDF link. Guards against a
// "2MB report" URL that actually streams gigabytes.
export const MAX_PDF_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** Is a canonical dotted-quad IPv4 in a private/reserved range? */
function isPrivateOrReservedV4(addr: string): boolean {
  const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return true; // not canonical → treat as unsafe
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  if (octets.some((o) => o > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 || // "this" network / 0.0.0.0
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast + reserved (224.0.0.0/3)
  );
}

/** Is a canonical IPv6 address loopback/link-local/unique-local/IPv4-mapped-private? */
function isPrivateOrReservedV6(addr: string): boolean {
  const host = addr.toLowerCase();
  if (host === "::1" || host === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:aabb:ccdd) → range-check the embedded v4.
  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes(".")) return isPrivateOrReservedV4(tail);
    const parts = tail.split(":");
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16);
      const lo = parseInt(parts[1], 16);
      if (Number.isNaN(hi) || Number.isNaN(lo)) return true;
      const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return isPrivateOrReservedV4(v4);
    }
    return true;
  }
  if (/^f[cd][0-9a-f]*:/.test(host)) return true; // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]*:/.test(host)) return true; // link-local fe80::/10
  return false;
}

/**
 * SSRF guard for generic direct-PDF links scraped from an inbound email body.
 * The host-scoped download patterns (cdn.10bis.co.il, invoice-one.com,
 * files.ezcount.co.il) are already safe; this guards the "anything else public"
 * fallback so a spoofed vendor email can't point us at cloud metadata
 * (169.254.169.254) or an internal service.
 *
 * We resolve the hostname and range-check the CANONICAL resolved IP(s) rather
 * than regex-matching the raw hostname — getaddrinfo normalises every IPv4
 * notation (127.1, 0x7f000001, 2130706433 → 127.0.0.1) and IPv4-mapped IPv6,
 * which a hand-rolled string check misses. Fail closed: unresolvable, or any
 * resolved address private/reserved → reject.
 *
 * ponytail: residual DNS-rebind TOCTOU — fetch does its own lookup after this
 * one, so a hostname could resolve public here and private at fetch-time.
 * Closing that needs a resolve-and-pin fetch; acceptable for this best-effort
 * fallback and out of scope here.
 */
export async function isSafePublicPdfUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!parsed.pathname.toLowerCase().endsWith(".pdf")) return false;

  // URL.hostname wraps IPv6 literals in brackets ("[::1]") — strip them.
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return false; // unresolvable → reject
  }
  if (addresses.length === 0) return false;

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateOrReservedV4(address)) return false;
    if (family === 6 && isPrivateOrReservedV6(address)) return false;
  }
  return true;
}
