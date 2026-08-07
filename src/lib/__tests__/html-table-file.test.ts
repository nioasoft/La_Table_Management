import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { looksLikeHtmlTableFile } from "../html-table-file";
import { validateFileType } from "../file-validation";

const fixturesDir = resolve(
  __dirname,
  "..",
  "custom-parsers",
  "__tests__",
  "fixtures"
);

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("looksLikeHtmlTableFile", () => {
  it("detects the UTF-16LE HTML report that ships as .xls", () => {
    const buffer = readFileSync(
      resolve(fixturesDir, "yama-vekadma-sales-report.xls")
    );
    expect(looksLikeHtmlTableFile(buffer)).toBe(true);
  });

  it("leaves real spreadsheets alone", () => {
    expect(
      looksLikeHtmlTableFile(readFileSync(resolve(fixturesDir, "kill-bill-q2-2026.xlsx")))
    ).toBe(false);
    expect(
      looksLikeHtmlTableFile(readFileSync(resolve(fixturesDir, "arel-arizot-q2-2026.xls")))
    ).toBe(false);
  });

  it("needs a table, not just an angle bracket", () => {
    expect(looksLikeHtmlTableFile(Buffer.from("<html><p>hi</p></html>"))).toBe(false);
    expect(looksLikeHtmlTableFile(Buffer.from("a < b, so what"))).toBe(false);
    expect(looksLikeHtmlTableFile(Buffer.from(""))).toBe(false);
  });
});

describe("validateFileType — HTML-table spreadsheets", () => {
  it("accepts the HTML report under an Excel MIME", async () => {
    const buffer = readFileSync(
      resolve(fixturesDir, "yama-vekadma-sales-report.xls")
    );
    const r = await validateFileType(buffer, XLSX_MIME);
    expect(r.valid).toBe(true);
  });

  it("still rejects it under a non-Excel MIME", async () => {
    const buffer = readFileSync(
      resolve(fixturesDir, "yama-vekadma-sales-report.xls")
    );
    const r = await validateFileType(buffer, "image/png");
    expect(r.valid).toBe(false);
  });
});
