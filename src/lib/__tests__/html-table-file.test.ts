import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { looksLikeHtmlTableFile, isExcelWebPageShell } from "../html-table-file";
import { validateFileType } from "../file-validation";
import { processSupplierFile } from "../file-processor";

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

describe("isExcelWebPageShell", () => {
  // The same Yama report after someone opened it in Excel and re-saved it as a
  // web page: 20KB of tab-strip markup, every data row left in a .files folder.
  const shell = readFileSync(resolve(fixturesDir, "excel-web-page-shell.xls"));

  it("recognises the frameset shell", () => {
    expect(isExcelWebPageShell(shell)).toBe(true);
  });

  it("does not fire on the real report or on real spreadsheets", () => {
    expect(
      isExcelWebPageShell(readFileSync(resolve(fixturesDir, "yama-vekadma-sales-report.xls")))
    ).toBe(false);
    expect(
      isExcelWebPageShell(readFileSync(resolve(fixturesDir, "kill-bill-q2-2026.xlsx")))
    ).toBe(false);
  });

  it("fails the upload with the real reason instead of 'file is empty'", async () => {
    const r = await processSupplierFile(shell, null, false, undefined, "YAMA_VEKADMA");

    expect(r.success).toBe(false);
    expect(r.errors[0].code).toBe("EXCEL_WEB_PAGE_SHELL");
    expect(r.errors[0].suggestion).toContain("המקורי");
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
