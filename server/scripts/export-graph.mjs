#!/usr/bin/env node
/**
 * Export a JSON snapshot of the live BQ bridge (default
 * http://127.0.0.1:18733) into `bq-graph/questbook.json`. The snapshot is
 * consumed by `src/graph/import.js` to build the offline SQLite graph.
 *
 * Output shape (single object):
 * {
 *   generated_at: ISO timestamp,
 *   bridge:       { url, player, quest_count, questline_count },
 *   questlines:   [{ id, name, description, order, quests: [{quest_id,pos_x,pos_y}] }],
 *   quests: {
 *     [id]: {
 *       id, name, description, icon, visibility, frame,
 *       logic_quest, logic_task, repeat_time,
 *       locked_progress, auto_claim, simultaneous, global_share,
 *       prerequisites: [{id, type}],
 *       tasks:         [{id, type, name}],
 *       rewards:       [{id, type, name}],
 *       in_questlines: [{line_id, line_name, pos_x, pos_y}]
 *     }
 *   }
 * }
 *
 * Usage:
 *   node server/scripts/export-graph.mjs [--bridge http://127.0.0.1:18733] \
 *                                        [--out   bq-graph] [--concurrency 8]
 */
import { writeFileSync, existsSync, renameSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(__dirname, "..", "..", "bq-graph");
const DEFAULT_BRIDGE = "http://127.0.0.1:18733";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const BRIDGE = (arg("--bridge", DEFAULT_BRIDGE) || DEFAULT_BRIDGE).replace(/\/+$/, "");
const OUT_DIR = arg("--out", DEFAULT_OUT);
const CONCURRENCY = Number(arg("--concurrency", "8"));

mkdirSync(OUT_DIR, { recursive: true });

async function jget(path) {
  const r = await fetch(`${BRIDGE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

async function runWithConcurrency(items, limit, fn, onEach) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const next = it.next();
      if (next.done) return;
      try { await fn(next.value); } catch (e) { console.error("  worker error:", e.message); }
      if (onEach) onEach();
    }
  }));
}

async function main() {
  const t0 = Date.now();
  console.log(`[export] bridge=${BRIDGE} out=${OUT_DIR} concurrency=${CONCURRENCY}`);

  console.log("[export] health check...");
  const health = await jget("/api/health");
  console.log(`  status=${health.status} quests=${health.quest_count} questlines=${health.questline_count} player=${health.player || "n/a"}`);

  console.log("[export] listing questlines...");
  const qlResp = await jget("/api/questlines");
  const qlList = qlResp.questlines;
  console.log(`  ${qlList.length} questlines`);

  console.log("[export] expanding each questline...");
  const questlineDetails = [];
  const questIdSet = new Set();
  for (const ql of qlList) {
    const detail = await jget(`/api/questlines/${ql.id}`);
    questlineDetails.push({
      id: detail.id,
      name: detail.name,
      description: detail.description,
      order: detail.order,
      quests: (detail.quests || []).map(q => ({ quest_id: q.quest_id, pos_x: q.pos_x, pos_y: q.pos_y })),
    });
    for (const q of detail.quests || []) questIdSet.add(q.quest_id);
    process.stdout.write(`.`);
  }
  console.log(`\n  ${questlineDetails.length} questlines, ${questIdSet.size} unique quest ids`);

  console.log("[export] fetching quest details (parallel)...");
  const questIds = [...questIdSet].sort((a, b) => a - b);
  const quests = {};
  let done = 0;
  const start = Date.now();
  await runWithConcurrency(questIds, CONCURRENCY, async (qid) => {
    const d = await jget(`/api/quests/${qid}`);
    quests[qid] = d;
  }, () => {
    done++;
    if (done % 50 === 0 || done === questIds.length) {
      const rate = done / ((Date.now() - start) / 1000);
      const eta = (questIds.length - done) / rate;
      console.log(`  ${done}/${questIds.length} (${rate.toFixed(1)}/s, ETA ${eta.toFixed(0)}s)`);
    }
  });
  console.log(`  ${Object.keys(quests).length} quests captured`);

  // Backfill in_questlines for each quest (now that we have full data)
  for (const qid in quests) {
    const inLines = [];
    for (const ql of questlineDetails) {
      const m = ql.quests.find(q => q.quest_id === Number(qid));
      if (m) inLines.push({ line_id: ql.id, line_name: ql.name, pos_x: m.pos_x, pos_y: m.pos_y });
    }
    quests[qid].in_questlines = inLines;
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    bridge: health,
    questlines: questlineDetails,
    quests,
  };

  const tmp = join(OUT_DIR, "questbook.json.tmp");
  const final = join(OUT_DIR, "questbook.json");
  console.log(`[export] writing ${tmp}`);
  writeFileSync(tmp, JSON.stringify(snapshot));

  if (existsSync(final)) renameSync(final, final + ".bak");
  renameSync(tmp, final);

  console.log(`[export] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${statSync(final).size.toLocaleString()} bytes  ${final}`);
  console.log(`  ${Object.keys(quests).length} quests, ${questlineDetails.length} questlines`);
  const prereqCount = Object.values(quests).reduce((s, q) => s + (q.prerequisites?.length || 0), 0);
  const taskCount = Object.values(quests).reduce((s, q) => s + (q.tasks?.length || 0), 0);
  const rewardCount = Object.values(quests).reduce((s, q) => s + (q.rewards?.length || 0), 0);
  console.log(`  ${prereqCount} prereqs, ${taskCount} tasks, ${rewardCount} rewards`);
}

main().catch(e => { console.error(e); process.exit(1); });
