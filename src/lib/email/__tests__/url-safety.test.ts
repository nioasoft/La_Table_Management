import { describe, it, expect } from "vitest";
import { isSafePublicPdfUrl } from "../url-safety";

describe("isSafePublicPdfUrl", () => {
  it("accepts a public https PDF (public IP literal resolves to itself)", async () => {
    // 8.8.8.8 resolves to itself via getaddrinfo without a network query.
    expect(await isSafePublicPdfUrl("https://8.8.8.8/report.pdf")).toBe(true);
  });

  it("rejects http (non-TLS)", async () => {
    expect(await isSafePublicPdfUrl("http://8.8.8.8/report.pdf")).toBe(false);
  });

  it("rejects cloud metadata IP", async () => {
    expect(
      await isSafePublicPdfUrl("https://169.254.169.254/latest/meta-data.pdf")
    ).toBe(false);
  });

  it("rejects private / loopback / internal hosts", async () => {
    for (const url of [
      "https://127.0.0.1/x.pdf",
      "https://10.0.0.5/x.pdf",
      "https://192.168.1.10/x.pdf",
      "https://172.16.0.1/x.pdf",
      "https://localhost/x.pdf",
      "https://svc.internal/x.pdf",
      "https://db.local/x.pdf",
      "https://[::1]/x.pdf",
    ]) {
      expect(await isSafePublicPdfUrl(url), url).toBe(false);
    }
  });

  it("rejects non-canonical IPv4 encodings that resolve to loopback", async () => {
    // Regression: hand-rolled dotted-quad regex missed these; getaddrinfo
    // canonicalizes them all to 127.0.0.1.
    for (const url of [
      "https://2130706433/x.pdf", // decimal
      "https://0x7f000001/x.pdf", // hex
      "https://127.1/x.pdf", // shortform
    ]) {
      expect(await isSafePublicPdfUrl(url), url).toBe(false);
    }
  });

  it("rejects IPv4-mapped IPv6 pointing at a private/metadata target", async () => {
    expect(
      await isSafePublicPdfUrl("https://[::ffff:169.254.169.254]/x.pdf")
    ).toBe(false);
  });

  it("rejects non-pdf paths and malformed URLs", async () => {
    expect(await isSafePublicPdfUrl("https://8.8.8.8/admin")).toBe(false);
    expect(await isSafePublicPdfUrl("not a url")).toBe(false);
  });
});
