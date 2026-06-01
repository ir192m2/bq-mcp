#!/usr/bin/env node
/**
 * BQ questbook graph engine smoke test.
 * Run: node server/test/graph-smoke.mjs
 */
import { stats, listQuestlines, getQuestline, getQuest, searchQuests, getDependencies, getBlockersFull, depth } from "../src/graph/query.js";
import { findPath, detectCycles } from "../src/graph/traversal.js";

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra != null ? `— ${extra}` : ""); }
}

const t0 = Date.now();
console.log("BQ questbook graph engine smoke test\n");

const s = stats();
check("stats returns object", typeof s === "object", JSON.stringify(s));
check("questline_count > 0", s.questline_count > 0, `got ${s.questline_count}`);
check("quest_count > 0", s.quest_count > 0, `got ${s.quest_count}`);
check("prereq_count > 0", s.prereq_count > 0, `got ${s.prereq_count}`);
check("generated_at set", !!s.generated_at, `got ${s.generated_at}`);
check("bridge_player set", !!s.bridge_player, `got ${s.bridge_player}`);

const qls = listQuestlines();
check("listQuestlines returns array", Array.isArray(qls));
check("questline names non-empty", qls.every(q => q.name && q.name.length > 0));

if (qls.length > 0) {
  const first = getQuestline(qls[0].id);
  check("getQuestline returns object", !!first, `id=${qls[0].id}`);
  check("getQuestline has name", !!first?.name);
  check("getQuestline has quests array", Array.isArray(first?.quests));
  check("getQuestline has positions", first?.quests.every(q => typeof q.pos_x === "number" && typeof q.pos_y === "number"));
}

const sample = searchQuests("quest", 5);
check("search 'quest' returns array", Array.isArray(sample));
check("search 'quest' returns > 0 results", sample.length > 0, `got ${sample.length}`);

if (sample.length > 0) {
  const q = getQuest(sample[0].id);
  check("getQuest returns object", !!q);
  check("getQuest has tasks array", Array.isArray(q?.tasks));
  check("getQuest has rewards array", Array.isArray(q?.rewards));
  check("getQuest has prerequisites array", Array.isArray(q?.prerequisites));
  check("getQuest has in_questlines array", Array.isArray(q?.in_questlines));
}

const cycles = detectCycles();
check("detectCycles returns array", Array.isArray(cycles));
console.log(`    found ${cycles.length} cycle(s)`);

const qid = sample[0]?.id;
if (qid) {
  const d = depth(qid);
  check("depth returns number", typeof d === "number", `got ${d} for quest ${qid}`);
  const unlocks = getDependencies(qid, 100);
  check("getDependencies returns object", !!unlocks);
  const blockers = getBlockersFull(qid, 100);
  check("getBlockersFull returns object", !!blockers);
}

if (s.prereq_count > 0 && sample.length >= 2) {
  // Find a quest that has at least one prereq, then test findPath
  const a = searchQuests("a", 50).find(r => r.prereq_count > 0);
  if (a) {
    const q = getQuest(a.id);
    if (q.prerequisites.length > 0) {
      const path = findPath(q.prerequisites[0].id, a.id, 10);
      check("findPath returns array or null", path === null || Array.isArray(path));
      if (path) check("findPath starts with from", path[0] === q.prerequisites[0].id);
      if (path) check("findPath ends with to", path[path.length - 1] === a.id);
    }
  }
}

console.log(`\n${pass} pass, ${fail} fail, total ${Date.now() - t0}ms`);
process.exit(fail === 0 ? 0 : 1);
