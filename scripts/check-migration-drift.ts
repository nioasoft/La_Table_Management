/**
 * Migration drift checker for the Neon production database.
 *
 * Why this exists: `drizzle-kit migrate` decides what to apply by reading a
 * SINGLE row — `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY
 * created_at DESC LIMIT 1` — and then replaying every journal entry whose
 * `when` is greater, all inside ONE transaction. Migrations applied to prod by
 * hand are never recorded there, so drizzle replays them, the first
 * `ADD COLUMN` without IF NOT EXISTS raises "already exists", the whole
 * transaction rolls back, and drizzle-kit exits 1 while printing nothing at
 * all. The new migration silently does not land.
 *
 * This script tells the truth about three separate questions:
 *   1. Which journal entries are missing from drizzle.__drizzle_migrations?
 *   2. Do the objects each migration creates actually exist in prod?
 *   3. Which drizzle/*.sql files are not in the journal at all?
 *
 * Read-only by default. `--fix` records the already-applied journal entries in
 * the tracking table (it never runs migration SQL) so the next real migration
 * is the only thing drizzle has to apply.
 *
 * Usage:
 *   npx tsx scripts/check-migration-drift.ts
 *   npx tsx scripts/check-migration-drift.ts --fix
 *
 * ponytail: object extraction is regex over DDL, not a SQL parser. It covers
 * CREATE TABLE / ADD COLUMN / CREATE TYPE / ALTER TYPE ADD VALUE / CREATE INDEX
 * — which is what these migrations do. Data-only migrations report as
 * "no verifiable objects", never as a pass. Upgrade to a real parser only if
 * migrations start doing something this cannot see.
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { database, pool } from "../src/db";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
}

type ObjectRef =
  | { kind: "table"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "enum"; type: string; value?: string }
  | { kind: "index"; index: string };

/** Strip line comments and split into statements drizzle would execute. */
function statementsOf(rawSql: string): string[] {
  const withoutComments = rawSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutComments
    .split(/-->\s*statement-breakpoint|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Objects a statement creates, and objects it destroys or renames away. */
function objectsOf(statement: string): {
  created: ObjectRef[];
  removed: ObjectRef[];
} {
  const created: ObjectRef[] = [];
  const removed: ObjectRef[] = [];

  const createTable = statement.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(?:public"?\."?)?([a-z_0-9]+)"?/i
  );
  if (createTable) created.push({ kind: "table", table: createTable[1] });

  const alterTable = statement.match(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?"?(?:public"?\."?)?([a-z_0-9]+)"?/i
  );
  if (alterTable) {
    const table = alterTable[1];
    for (const m of statement.matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi
    )) {
      created.push({ kind: "column", table, column: m[1] });
    }
    for (const m of statement.matchAll(
      /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi
    )) {
      removed.push({ kind: "column", table, column: m[1] });
    }
    for (const m of statement.matchAll(
      /RENAME\s+COLUMN\s+"?([a-z_0-9]+)"?/gi
    )) {
      removed.push({ kind: "column", table, column: m[1] });
    }
  }

  const createType = statement.match(
    /CREATE\s+TYPE\s+"?(?:public"?\."?)?([a-z_0-9]+)"?\s+AS\s+ENUM/i
  );
  if (createType) created.push({ kind: "enum", type: createType[1] });

  for (const m of statement.matchAll(
    /ALTER\s+TYPE\s+"?(?:public"?\."?)?([a-z_0-9]+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi
  )) {
    created.push({ kind: "enum", type: m[1], value: m[2] });
  }

  const createIndex = statement.match(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?/i
  );
  if (createIndex) created.push({ kind: "index", index: createIndex[1] });

  const dropTable = statement.match(
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(?:public"?\."?)?([a-z_0-9]+)"?/i
  );
  if (dropTable) removed.push({ kind: "table", table: dropTable[1] });

  const dropIndex = statement.match(
    /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"?([a-z_0-9]+)"?/i
  );
  if (dropIndex) removed.push({ kind: "index", index: dropIndex[1] });

  return { created, removed };
}

function refKey(ref: ObjectRef): string {
  switch (ref.kind) {
    case "table":
      return `table:${ref.table}`;
    case "column":
      return `column:${ref.table}.${ref.column}`;
    case "enum":
      return ref.value ? `enum:${ref.type}='${ref.value}'` : `enum:${ref.type}`;
    case "index":
      return `index:${ref.index}`;
  }
}

/** Everything prod actually has right now, in four cheap queries. */
async function loadLiveSchema() {
  const tables = await database.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `);
  const columns = await database.execute<{
    table_name: string;
    column_name: string;
  }>(sql`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  `);
  const enums = await database.execute<{ typname: string; enumlabel: string }>(sql`
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  `);
  const indexes = await database.execute<{ indexname: string }>(sql`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `);

  return {
    tables: new Set(tables.rows.map((r) => r.table_name)),
    columns: new Set(
      columns.rows.map((r) => `${r.table_name}.${r.column_name}`)
    ),
    enumTypes: new Set(enums.rows.map((r) => r.typname)),
    enumValues: new Set(enums.rows.map((r) => `${r.typname}='${r.enumlabel}'`)),
    indexes: new Set(indexes.rows.map((r) => r.indexname)),
  };
}

type LiveSchema = Awaited<ReturnType<typeof loadLiveSchema>>;

function exists(ref: ObjectRef, live: LiveSchema): boolean {
  switch (ref.kind) {
    case "table":
      return live.tables.has(ref.table);
    case "column":
      return live.columns.has(`${ref.table}.${ref.column}`);
    case "enum":
      return ref.value
        ? live.enumValues.has(`${ref.type}='${ref.value}'`)
        : live.enumTypes.has(ref.type);
    case "index":
      return live.indexes.has(ref.index);
  }
}

async function main() {
  const fix = process.argv.includes("--fix");

  const journal: { entries: JournalEntry[] } = JSON.parse(
    readFileSync(JOURNAL_PATH, "utf8")
  );
  const sqlFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const live = await loadLiveSchema();

  const recorded = await database.execute<{ created_at: string }>(sql`
    SELECT created_at FROM drizzle.__drizzle_migrations
  `);
  const recordedWhen = new Set(recorded.rows.map((r) => Number(r.created_at)));
  const lastRecorded = Math.max(0, ...recordedWhen);

  // An object a LATER migration drops or renames must not be expected to exist.
  const supersededLater = new Set<string>();
  for (const file of sqlFiles) {
    for (const stmt of statementsOf(
      readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    )) {
      for (const ref of objectsOf(stmt).removed) supersededLater.add(refKey(ref));
    }
  }

  console.log("Migration drift report");
  console.log("=".repeat(72));
  console.log(
    `journal entries: ${journal.entries.length}   sql files: ${sqlFiles.length}   tracking rows: ${recordedWhen.size}`
  );
  console.log(
    `drizzle replays every journal entry with when > ${lastRecorded} (${new Date(
      lastRecorded
    ).toISOString().slice(0, 10)})\n`
  );

  const appliedInProd: JournalEntry[] = [];
  const missingObjects: string[] = [];

  for (const entry of journal.entries) {
    const path = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      console.log(`  MISSING FILE  ${entry.tag} — journal entry has no .sql`);
      continue;
    }

    const refs = statementsOf(raw)
      .flatMap((stmt) => objectsOf(stmt).created)
      .filter((ref) => !supersededLater.has(refKey(ref)));

    const absent = refs.filter((ref) => !exists(ref, live));
    const tracked = recordedWhen.has(entry.when);
    const pending = entry.when > lastRecorded;

    let verdict: string;
    if (refs.length === 0) verdict = "no verifiable objects";
    else if (absent.length === 0) verdict = `in prod (${refs.length} objects)`;
    else verdict = `NOT IN PROD: ${absent.map(refKey).join(", ")}`;

    const flags = [
      tracked ? "tracked" : "UNTRACKED",
      pending ? "drizzle would replay" : "",
    ]
      .filter(Boolean)
      .join(", ");

    console.log(`  ${entry.tag.padEnd(42)} ${verdict}`);
    if (!tracked || pending) console.log(`  ${" ".repeat(42)} ^ ${flags}`);

    if (absent.length > 0) {
      missingObjects.push(`${entry.tag}: ${absent.map(refKey).join(", ")}`);
    } else if (!tracked) {
      appliedInProd.push(entry);
    }
  }

  const journalTags = new Set(journal.entries.map((e) => e.tag));
  const orphanFiles = sqlFiles
    .map((f) => f.replace(/\.sql$/, ""))
    .filter((tag) => !journalTags.has(tag));

  console.log("\n" + "-".repeat(72));
  console.log(
    `sql files not in the journal (drizzle can never replay these): ${orphanFiles.length}`
  );
  if (orphanFiles.length > 0) {
    console.log(`  ${orphanFiles.join(", ")}`);
  }

  if (missingObjects.length > 0) {
    console.log("\nOBJECTS MISSING FROM PROD — fix these before recording:");
    for (const line of missingObjects) console.log(`  ${line}`);
  }

  console.log(
    `\nuntracked but verified in prod: ${appliedInProd.length}` +
      (appliedInProd.length > 0
        ? ` (${appliedInProd.map((e) => e.tag).join(", ")})`
        : "")
  );

  if (!fix) {
    if (appliedInProd.length > 0) {
      console.log("\nrun with --fix to record them in drizzle.__drizzle_migrations");
    }
    return;
  }

  if (missingObjects.length > 0) {
    console.error(
      "\nrefusing to --fix while objects are missing from prod: recording them would bury a real gap"
    );
    process.exitCode = 1;
    return;
  }

  for (const entry of appliedInProd) {
    // drizzle hashes the raw file contents; created_at MUST be the journal
    // `when`, because that is the value a future migration is compared against.
    const hash = createHash("sha256")
      .update(readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8"))
      .digest("hex");
    await database.execute(sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when})
    `);
    console.log(`  recorded ${entry.tag}`);
  }

  console.log(`\nrecorded ${appliedInProd.length} entries. \`npm run db:migrate\` is now a no-op.`);
}

main()
  .catch((error) => {
    console.error("check-migration-drift failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
