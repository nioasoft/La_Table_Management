import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const ENGINE_PATH = join(SOURCE_ROOT, "lib", "royalty.ts");

function productionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : productionTypeScriptFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function containsRoyaltyFormula(source: string): boolean {
  const signals = [
    /subtotal\s*\*\s*\(\s*1\s*\+\s*vat\s*\)/,
    /netBase[^;\n]*(?:tierRate|effectiveRate|marketingRate)[^;\n]*\/\s*100/,
    /royaltyFull\s*-\s*royalty/,
  ];
  return signals.some((signal) => signal.test(source));
}

describe("royalty business formula has one source of truth", () => {
  it("keeps complete royalty arithmetic out of every module except royalty.ts", () => {
    // A second formula path once differed by 0.000001 after numeric(16,6)
    // storage. Any canonical formula signal outside the engine is forbidden.
    const offenders = productionTypeScriptFiles(SOURCE_ROOT)
      .filter((path) => path !== ENGINE_PATH)
      .filter((path) => containsRoyaltyFormula(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));

    expect(offenders).toEqual([]);
  });
});
