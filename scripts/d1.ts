import { spawnSync } from "node:child_process";
import { redactLogText } from "../src/lib/alerts/redact.ts";

export interface D1Result {
  rows: Record<string, unknown>[];
  changes: number;
}

function parseD1(stdout: string): D1Result {
  const trimmed = stdout.trim();
  const start = Math.min(
    ...["[", "{"].map((char) => {
      const index = trimmed.indexOf(char);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }),
  );
  if (!Number.isFinite(start)) throw new Error("D1 did not return JSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start));
  } catch {
    throw new Error("D1 did not return JSON.");
  }
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const rows: Record<string, unknown>[] = [];
  let changes = 0;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as { results?: unknown; meta?: { changes?: unknown } };
    if (Array.isArray(record.results)) {
      for (const row of record.results) {
        if (row && typeof row === "object") rows.push(row as Record<string, unknown>);
      }
    }
    const count = Number(record.meta?.changes ?? 0);
    if (Number.isFinite(count)) changes += count;
  }
  return { rows, changes };
}

/** Remote D1 query. Stderr is redacted before it is written. Stdout is not logged. */
export function d1Execute(root: string, sql: string): D1Result {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "gpufit", "--remote", "--json", "--command", sql], {
    cwd: root,
    encoding: "utf8",
    input: "",
  });
  const stderr = redactLogText(result.stderr ?? "");
  if (stderr.trim()) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
  if (result.error || result.status !== 0) {
    console.error("D1 command failed.");
    throw new Error("D1 command failed.");
  }
  try {
    return parseD1(result.stdout ?? "");
  } catch (error) {
    console.error(redactLogText(error instanceof Error ? error.message : "D1 did not return JSON."));
    throw new Error("D1 command failed.");
  }
}
