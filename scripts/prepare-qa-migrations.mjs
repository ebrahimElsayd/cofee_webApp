import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve("supabase");
const migrationDirectory = join(source, "migrations");
const files = (await readdir(migrationDirectory))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

if (files.length === 0) throw new Error("No Supabase migrations found");

const destination = await mkdtemp(join(tmpdir(), "coffee-qa-schema-"));
const target = join(destination, "supabase");
await mkdir(join(target, "migrations"), { recursive: true });
await writeFile(join(target, "config.toml"), await readFile(join(source, "config.toml")));

const baseTime = Date.UTC(2026, 8, 22, 0, 0, 0);
const mapping = [];
for (const [index, file] of files.entries()) {
  const timestamp = new Date(baseTime + index * 1000)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const renamed = `${timestamp}_${file}`;
  await writeFile(
    join(target, "migrations", renamed),
    await readFile(join(migrationDirectory, file)),
  );
  mapping.push({ source: file, qa: renamed });
}

await writeFile(join(destination, "migration-map.json"), JSON.stringify(mapping, null, 2));
console.log(destination);
console.log(`Prepared ${mapping.length} QA-only migrations in deterministic order.`);
