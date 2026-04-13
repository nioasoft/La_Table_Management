/**
 * Smoke-test the occasional-clients ingestion by running processTabitUpload()
 * against a real sample Tabit file. Writes to the Neon DB (production).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/test-occasional-tabit.ts <path-to-xlsx>
 */

import fs from "node:fs";
import path from "node:path";
import { processTabitUpload } from "@/lib/client-document-processor";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("usage: test-occasional-tabit.ts <xlsx-path>");
    process.exit(1);
  }
  const absPath = path.resolve(filePath);
  const buffer = fs.readFileSync(absPath);
  const fileName = path.basename(absPath);

  const result = await processTabitUpload({
    buffer,
    fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    source: "manual_upload",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
