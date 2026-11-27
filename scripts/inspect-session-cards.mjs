/**
 * Print what one session log recorded for every tool call: the call, and
 * whether its `tool/result` carried a diffs.work card.
 *
 * The plugin's whole claim is "the card the agent's edit produces is ours", and
 * the card lives in the durable `tool/result` event's `meta`. Reading that event
 * is the only way to check the claim without a browser, so this script exists to
 * make the check one command.
 *
 * Usage:
 *   node scripts/inspect-session-cards.mjs <session dir> [--json]
 */
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
if (target === undefined) {
  console.error("usage: node scripts/inspect-session-cards.mjs <session dir> [--json]");
  process.exit(2);
}
const asJson = args.includes("--json");

/** Read and parse a zstd-compressed JSONL session log. */
function readLog(dir) {
  const file = readdirSync(dir).find((name) => name.startsWith("session.v") && name.endsWith(".jsonl.zstd"));
  if (file === undefined) throw new Error(`no session log in ${dir}`);
  const text = execFileSync("zstd", ["-dc", path.join(dir, file)], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const events = readLog(target);
const calls = new Map();
const order = [];
for (const event of events) {
  if (event.type !== "tool/call") continue;
  calls.set(event.data.callId, event.data);
  order.push(event.data.callId);
}

const rows = [];
for (const event of events) {
  if (event.type !== "tool/result") continue;
  const callId = event.data?.message?.toolCallId ?? event.data?.callId;
  // A result may name its call several ways; fall back to the call that has no result yet.
  const call = calls.get(callId) ?? calls.get(order[rows.length]);
  const meta = event.data?.meta;
  const card = meta?.schema === "diffs.work/portable@1" ? meta : undefined;
  rows.push({
    call: call?.name ?? "(unknown)",
    command: String(call?.arguments ?? "").replace(/\s+/g, " ").slice(0, 110),
    isError: event.data?.message?.isError === true || event.data?.error !== undefined,
    error: event.data?.error?.reason ?? event.data?.error?.code ?? null,
    card: card === undefined
      ? null
      : {
        files: (card.files ?? [card]).map((file) => ({
          path: file.path,
          family: file.family,
          added: file.added,
          removed: file.removed,
          summary: file.summary,
        })),
      },
    metaKeys: meta === undefined ? [] : Object.keys(meta),
  });
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const row of rows) {
    const mark = row.card === null ? "  " : "◆ ";
    const err = row.isError ? ` (error${row.error === null ? "" : `: ${String(row.error).slice(0, 80)}`})` : "";
    console.log(`${mark}${row.call}${err}: ${row.command}`);
    if (row.card !== null) {
      for (const file of row.card.files) {
        console.log(`    card → ${file.path} · ${file.family} · +${file.added}/-${file.removed} · ${file.summary}`);
      }
    } else if (row.metaKeys.length > 0) {
      console.log(`    meta: ${row.metaKeys.join(",")}`);
    }
  }
  const cards = rows.filter((row) => row.card !== null).length;
  console.log(`\n${cards}/${rows.length} tool results carried a diffs.work card`);
}