/**
 * Parity check: the row builder must reproduce an old Excel export exactly.
 * Read-only against the DB. Download old.xlsx from the live site BEFORE the deploy,
 * to a scratch folder; never commit it (the repo is public).
 *
 * Usage: npx dotenv -e .env -- npx tsx scripts/hashavshevet-parity.ts <exportType> '<paramsJson>' <old.xlsx>
 * Example: ... royalties '{"brandId":"<id>","itemType":"royalty","year":2026,"month":6}' ~/scratch/old.xlsx
 * Exit code 1 when there is any difference.
 */
import * as XLSX from "xlsx";
import { compareSheetToRows } from "../src/lib/hashavshevet/parity";
import { EXPORTS } from "../src/lib/hashavshevet/registry";
import { exportParamsSchema } from "../src/schemas/hashavshevet";

async function main(): Promise<number> {
  const [exportType, paramsJson, xlsxPath] = process.argv.slice(2);
  if (!exportType || !paramsJson || !xlsxPath) {
    console.error("Usage: hashavshevet-parity.ts <exportType> '<paramsJson>' <old.xlsx>");
    return 2;
  }
  const parsed = exportParamsSchema.parse({ exportType, params: JSON.parse(paramsJson) });
  const { rows, blockingErrors } = await EXPORTS[parsed.exportType].build(parsed.params);
  for (const message of blockingErrors) console.log(`blocking error: ${message}`);

  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const differences = compareSheetToRows(data, rows);
  for (const line of differences) console.log(line);
  console.log(`${differences.length} differences`);
  return differences.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(2);
  },
);
